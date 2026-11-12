/**
 * Direction model selection: joint u/v fitting with angular error scoring.
 */

import { finite, round, meanS } from './numeric.js';
import { linearModel, rollingFolds, solveRidge, solveNNLS, moments, applyLinear } from './linear-algebra.js';
import { toDir, toSpeed, circularAbs } from './wind.js';
import { Spec, componentPredict } from './predictors.js';
import { LAMBDA_GRID, CV_FOLDS } from './model-selection.js';

export function componentPredict(model: LinearModel | { family: string }, spec: Spec, i: number): number | null {
  if (model.family === 'mean') return spec.mean[i];
  const row = spec.row(i);
  return row ? applyLinear(model as LinearModel, row) : null;
}

/** Build direction candidates (joint u/v families). */
export function directionCandidates(su: Spec, sv: Spec, foldEnd: number): Array<{
  family: string;
  lambda: number | null;
  fit: () => { u: LinearModel | { family: 'mean' }; v: LinearModel | { family: 'mean' } };
} | null> {
  const mu = moments(su.fitRows.slice(0, foldEnd), su.fitY.slice(0, foldEnd));
  const mv = moments(sv.fitRows.slice(0, foldEnd), sv.fitY.slice(0, foldEnd));
  const list = [{ family: 'mean', lambda: null }];
  for (const lam of LAMBDA_GRID) {
    list.push({ family: 'nnls', lambda: lam });
    list.push({ family: 'emos', lambda: lam });
  }
  return list.map(c => {
    if (c.family === 'mean') {
      return { ...c, fit: () => ({ u: { family: 'mean' }, v: { family: 'mean' } }) };
    }
    const fu = c.family === 'nnls' ? solveNNLS(mu, c.lambda!) : solveRidge(mu, c.lambda!);
    const fv = c.family === 'nnls' ? solveNNLS(mv, c.lambda!) : solveRidge(mv, c.lambda!);
    if (!fu || !fv) return null;
    return {
      ...c,
      fit: () => ({
        u: linearModel(c.family, fu, mu),
        v: linearModel(c.family, fv, mv),
      }),
    };
  }).filter(Boolean) as Array<{
  family: string;
  lambda: number | null;
  fit: () => { u: LinearModel | { family: 'mean' }; v: LinearModel | { family: 'mean' } };
}>;
}

/** Select best u/v pair via blocked CV on angular error. */
export function selectDirectionPair(su: Spec, sv: Spec): {
  model: { u: LinearModel | { family: 'mean' }; v: LinearModel | { family: 'mean' } };
  winner: { family: string; lambda: number | null; cvAngle: number; cvN: number; fv: number[]; gap?: number; gapSe?: number };
  table: Array<{ family: string; lambda: number | null; cvAngle: number; cvN: number; fv: number[]; gap?: number; gapSe?: number }>;
} | null {
  if (!su.ok || !sv.ok) return null;
  const foldSE = new Map<string, Array<[number, number]>>();
  const folds = rollingFolds(su.fitIdx.length, CV_FOLDS);
  for (let f = 0; f < folds.length; f++) {
    const trEnd = folds[f].train;
    if (trEnd < Math.max(su.p, sv.p) * 12) continue;
    const cands = directionCandidates(su, sv, trEnd);
    const [vaStart, vaEnd] = folds[f].valid;
    for (let t = vaStart; t < vaEnd; t++) {
      const i = su.fitIdx[t];
      if (!finite(su.truthDir[i])) continue;
      if (!su.row(i) || !sv.row(i)) continue;
      for (const c of cands) {
        const fitted = c.fit();
        const mu = componentPredict(fitted.u, su, i);
        const mv = componentPredict(fitted.v, sv, i);
        if (!finite(mu) || !finite(mv)) continue;
        const err = circularAbs(toDir(mu!, mv!), su.truthDir[i]);
        const key = c.family + ':' + c.lambda;
        if (!foldSE.has(key)) foldSE.set(key, []);
        const arr = foldSE.get(key)!;
        if (arr.length <= f) arr.push([0, 0]);
        arr[f][0] += err;
        arr[f][1] += 1;
      }
    }
  }
  const table: Array<{ family: string; lambda: number | null; cvAngle: number; cvN: number; fv: number[]; gap?: number; gapSe?: number }> = [];
  for (const [key, per] of foldSE) {
    let sum = 0, n = 0;
    const fv: number[] = [];
    for (const [s, c] of per) {
      if (c < 8) continue;
      sum += s; n += c;
      fv.push(s / c);
    }
    if (n < 40 || fv.length < 2) continue;
    const j = key.indexOf(':');
    table.push({
      family: key.slice(0, j),
      lambda: key.slice(j + 1) === 'null' ? null : Number(key.slice(j + 1)),
      cvAngle: sum / n, cvN: n, fv,
    });
  }
  if (!table.length) return null;
  table.sort((a, b) => a.cvAngle - b.cvAngle || (b.lambda ?? 0) - (a.lambda ?? 0));

  const COMPLEXITY = { mean: 0, best: 1, nnls: 2, emos: 3 };
  const top = table[0];
  for (const c of table) {
    const diffs: number[] = [];
    for (let f = 0; f < top.fv.length; f++) {
      if (!c.fv[f] || !top.fv[f]) continue;
      diffs.push(c.fv[f] - top.fv[f]);
    }
    if (diffs.length < 2) { c.gap = 0; c.gapSe = Infinity; continue; }
    const m = diffs.reduce((s, v) => s + v, 0) / diffs.length;
    c.gap = m;
    c.gapSe = Math.sqrt(diffs.reduce((s, v) => s + (v - m) ** 2, 0) / (diffs.length - 1) / diffs.length);
  }
  const eligible = table.filter(c => c.gap! <= c.gapSe! + 1e-12);
  eligible.sort((a, b) => (COMPLEXITY[a.family] - COMPLEXITY[b.family])
    || ((b.lambda ?? 0) - (a.lambda ?? 0)) || (a.cvAngle - b.cvAngle));
  const winner = eligible[0] || top;

  const all = directionCandidates(su, sv, su.fitRows.length)
    .find(c => c.family === winner.family && c.lambda === winner.lambda);
  const model = all ? all.fit() : { u: { family: 'mean' }, v: { family: 'mean' } };
  return { model, winner, table };
}

/** Assemble fitting matrices for u/v components. */
export function directionSpecs(
  times: string[],
  series: Record<string, { u: Array<number | null>; v: Array<number | null> }>,
  usable: string[],
  crossVars: string[],
  cols: Array<Array<number | null>>,
  fill: number[],
  utcOffset: number | undefined,
  uObs: Array<number | null>,
  vObs: Array<number | null>,
  truthDir: Array<number | null>,
  trainIdx: number[]
) {
  const subU = Object.fromEntries(usable.map(id => [id, series[id].u]));
  const subV = Object.fromEntries(usable.map(id => [id, series[id].v]));
  const mk = (target: Array<number | null>, sub: Record<string, Array<number | null>>) => makeSpec({
    times, obs: target, series: sub, modelIds: usable, cross: cols, crossFill: fill,
    utcOffset, forward: x => x, kind: 'gauss' as const,
  });
  const raw = { su: mk(uObs, subU), sv: mk(vObs, subV), truthDir };
  for (const key of ['su', 'sv'] as const) {
    const spec = raw[key];
    spec.truthDir = truthDir;
    spec.fitRows = []; spec.fitY = []; spec.fitIdx = []; spec.ok = true;
    for (const i of trainIdx) {
      const y = spec.obs[i];
      const row = spec.row(i);
      if (!finite(y) || !finite(truthDir[i]) || !row) continue;
      spec.fitRows.push(row); spec.fitY.push(y); spec.fitIdx.push(i);
    }
    if (spec.fitRows.length < spec.p * 12) spec.ok = false;
  }
  return raw;
}

import { moments } from './linear-algebra.js';
import { makeSpec } from './predictors.js';