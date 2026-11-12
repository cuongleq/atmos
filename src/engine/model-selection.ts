/**
 * Model selection: fit candidates, blocked CV, one-standard-error rule.
 */

import { finite, meanS, round } from './numeric.js';
import { Moments, moments, linearModel, rollingFolds, solveRidge, solveNNLS } from './linear-algebra.js';
import { Spec } from './predictors.js';

export interface Candidate {
  family: string;
  lambda: number | null;
  cvRmse: number;
  cvN: number;
  fv: number[];
  gap?: number;
  gapSe?: number;
  chosen?: boolean;
  fitted?: boolean;
}

export interface SelectionResult {
  model: LinearModel | { family: 'best'; singleModel: string } | { family: 'mean'; modelIds: string[] };
  winner: Candidate;
  table: Candidate[];
  family: string;
  fitRows: number;
  bestSingle: { id: string | null; rmse: number | null };
  cvStandardError: number;
  cvThreshold: number;
  cvGap: number;
}

/** Fit every candidate family and select via one-standard-error rule on paired fold differences. */
export function selectModel(
  spec: Spec,
  trainIdx: number[],
  inverse: (x: number) => number,
  forward: (x: number) => number
): SelectionResult | null {
  const yAll = trainIdx.map(i => forward(spec.obs[i]));
  const rowsAll = trainIdx.map(i => spec.row(i));
  const keep: number[] = [];
  for (let t = 0; t < trainIdx.length; t++) if (rowsAll[t] && finite(yAll[t])) keep.push(t);
  if (keep.length < spec.p * 12) return null;
  const fitIdx = keep.map(t => trainIdx[t]);
  const fitRows = keep.map(t => rowsAll[t]!);
  const fitY = keep.map(t => yAll[t]);
  const mAll = moments(fitRows, fitY);

  const foldSE = new Map<string, Array<[number, number]>>();
  const folds = rollingFolds(fitIdx.length, CV_FOLDS);
  for (let f = 0; f < folds.length; f++) {
    const trEnd = folds[f].train;
    if (trEnd < spec.p * 12) continue;
    const m = moments(fitRows.slice(0, trEnd), fitY.slice(0, trEnd));
    const trIdx = fitIdx.slice(0, trEnd);
    const best = bestSingle(spec, trIdx, inverse);
    const cands: Array<{ key: string; predict: (i: number) => number | null }> = [{ key: 'mean:-', predict: i => spec.mean[i] }];
    if (best.id !== null) cands.push({ key: 'best:-', predict: i => spec.vals[spec.modelIds.indexOf(best.id)][i] });

    if (spec.modelIds.length >= 2) {
      for (const lam of LAMBDA_GRID) {
        const w = solveNNLS(m, lam);
        if (w) {
          const mo = linearModel('nnls', w, m);
          cands.push({ key: `nnls:${lam}`, predict: i => applyLinear(mo, spec.row(i)!) });
        }
        const b = solveRidge(m, lam);
        if (b) {
          const mo = linearModel('emos', b, m);
          cands.push({ key: `emos:${lam}`, predict: i => applyLinear(mo, spec.row(i)!) });
        }
      }
    }

    for (let t = folds[f].valid[0]; t < folds[f].valid[1]; t++) {
      const i = fitIdx[t], target = spec.obs[i];
      if (!finite(target)) continue;
      if (!spec.row(i)) continue;
      for (const c of cands) {
        const p = c.predict(i);
        if (!finite(p)) continue;
        if (!foldSE.has(c.key)) foldSE.set(c.key, []);
        const arr = foldSE.get(c.key)!;
        if (arr.length <= f) arr.push([0, 0]);
        arr[f][0] += (inverse(p!) - target) ** 2;
        arr[f][1] += 1;
      }
    }
  }

  const table: Candidate[] = [];
  for (const [key, per] of foldSE) {
    let se = 0, n = 0;
    const rmses: number[] = [];
    for (const [s, c] of per) {
      if (c < 8) continue;
      se += s; n += c;
      rmses.push(Math.sqrt(s / c));
    }
    if (n < 40 || rmses.length < 2) continue;
    const j = key.indexOf(':');
    const lambda = key.slice(j + 1) === '-' ? null : Number(key.slice(j + 1));
    table.push({
      family: key.slice(0, j), lambda,
      cvRmse: Math.sqrt(se / n), cvN: n, fv: rmses,
    });
  }
  if (!table.length) return null;
  table.sort((a, b) => a.cvRmse - b.cvRmse || (b.lambda ?? 0) - (a.lambda ?? 0));

  const COMPLEXITY = { mean: 0, best: 1, nnls: 2, emos: 3 };
  const top = table[0];
  for (const c of table) {
    const diffs: number[] = [];
    for (let f = 0; f < top.fv.length; f++) {
      if (!c.fv[f] || !top.fv[f]) continue;
      diffs.push(c.fv[f] - top.fv[f]);
    }
    if (diffs.length < 2) { c.gap = 0; c.gapSe = Infinity; continue; }
    const mu = diffs.reduce((s, v) => s + v, 0) / diffs.length;
    const variance = diffs.reduce((s, v) => s + (v - mu) ** 2, 0) / (diffs.length - 1);
    c.gap = mu;
    c.gapSe = Math.sqrt(variance / diffs.length);
  }
  const eligible = table.filter(c => c.gap! <= c.gapSe! + 1e-12);
  eligible.sort((a, b) => (COMPLEXITY[a.family] - COMPLEXITY[b.family])
    || ((b.lambda ?? 0) - (a.lambda ?? 0))
    || (a.cvRmse - b.cvRmse));
  const winner = eligible[0] || top;
  const bestOnAll = bestSingle(spec, fitIdx, inverse);

  let model: LinearModel | { family: 'best'; singleModel: string } | { family: 'mean'; modelIds: string[] };
  if (winner.family === 'emos' && spec.modelIds.length >= 2) {
    const b = solveRidge(mAll, winner.lambda!);
    if (b) model = linearModel('emos', b, mAll);
    else model = { family: 'mean', modelIds: spec.modelIds };
  } else if (winner.family === 'nnls' && spec.modelIds.length >= 2) {
    model = linearModel('nnls', solveNNLS(mAll, winner.lambda!)!, mAll);
  } else if (winner.family === 'best' && bestOnAll.id !== null) {
    model = { family: 'best', singleModel: bestOnAll.id };
  } else {
    model = { family: 'mean', modelIds: spec.modelIds };
  }
  const family = model.family;

  return {
    model, winner, table, family, fitRows: fitIdx.length, bestSingle: bestOnAll,
    cvStandardError: winner.gapSe ?? 0,
    cvThreshold: top.cvRmse + (winner.gap ?? 0),
    cvGap: winner.gap ?? 0,
  };
}

import { LAMBDA_GRID, CV_FOLDS, bestSingle } from './predictors.js';
import { applyLinear } from './linear-algebra.js';

export { LAMBDA_GRID, CV_FOLDS };