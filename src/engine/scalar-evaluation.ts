/**
 * Scalar variable evaluation (temperature, precipitation, wind speed, etc.)
 */

import { finite, round, meanS, quantile } from './numeric.js';
import { TransformKind, FORWARD, INVERSE, pseudoMembers, residualTemplate, jacobian, crpsMembers, K_MEMBERS, Z_NODES } from './transforms.js';
import { sigma2 } from './linear-algebra.js';
import { Spec, buildCrossFill, makeSpec } from './predictors.js';
import { selectModel } from './model-selection.js';
import { pointScores, eventScores, probScores, probEnsembleScores, pairedBootstrap } from './scores.js';
import { dailyAccumulation } from './daily-accumulation.js';
import { calibrationBundle } from './calibration.js';
import { VariableSpec } from './variables.js';

export function evaluateScalar(opts: {
  times: string[];
  obs: Array<number | null>;
  series: Record<string, Array<number | null>>;
  variable: string;
  lead: number;
  trainEnd: string;
  testStart: string;
  purgeDays: number;
  utcOffset: number;
  modelNames: Record<string, string>;
  crossVars: string[];
  cross: Record<string, Array<number | null>>;
  vspec: VariableSpec;
  base: any;
  usable: string[];
  trainIdx: number[];
  testIdx: number[];
}): any {
  const { times, obs, series, variable, lead, trainEnd, testStart, purgeDays, utcOffset, modelNames, crossVars, cross, vspec, base, usable, trainIdx, testIdx } = opts;
  const forward = FORWARD[vspec.kind], inverse = INVERSE[vspec.kind];
  const { cols, fill } = buildCrossFill(times, crossVars, cross, trainIdx);
  const sub = Object.fromEntries(usable.map(id => [id, series[id]]));
  const spec = makeSpec({ times, obs, series: sub, modelIds: usable, cross: cols, crossFill: fill, utcOffset, forward, kind: vspec.kind });
  const sel = selectModel(spec, trainIdx, inverse, forward);
  if (!sel) return { ...base, usable: false, note: 'không tạo được bộ dự báo' };

  const predict = (i: number) => {
    if (sel.model.family === 'mean') return spec.mean[i];
    if (sel.model.family === 'best') return spec.vals[usable.indexOf((sel.model as any).singleModel)][i];
    const row = spec.row(i);
    return row ? applyLinear(sel.model as any, row) : null;
  };

  const spreadSq: number[] = [], sq: number[] = [];
  for (const i of trainIdx) {
    const p = predict(i);
    if (!finite(p)) continue;
    spreadSq.push(spec.spread[i] ** 2);
    sq.push((p - forward(obs[i]!)) ** 2);
  }
  const sg = sigma2(spreadSq, sq);

  const sdOf = (i: number) => Math.sqrt(Math.max(sg.alpha + sg.beta * spec.spread[i] ** 2, 0));
  const zResid: number[] = [];
  for (const i of trainIdx) {
    const p = predict(i);
    if (!finite(p)) continue;
    const e = inverse(p!) - obs[i]!;
    const s = sdOf(i) * jacobian(vspec.kind, p!);
    if (finite(e) && s > 1e-6) zResid.push(e / s);
  }

  const zAbs = zResid.map(v => Math.abs(v));
  let obsZeros = 0, obsSeen = 0;
  for (const i of trainIdx) {
    const v = obs[i];
    if (!finite(v)) continue;
    obsSeen++;
    if (v <= 0) obsZeros++;
  }
  const asymmetric = obsSeen > 0 && obsZeros / obsSeen > 0.5;
  const template = residualTemplate(zResid, !asymmetric);

  const zSorted = zResid.filter(finite).sort((a, b) => a - b);
  const bandCover = (k: number) => {
    if (zSorted.length < 200) return null;
    const base = template || Z_NODES;
    const nodes = base.map(v => v * k).sort((a, b) => a - b);
    const loZ = nodes[Math.floor(0.1 * K_MEMBERS)];
    const hiZ = nodes[Math.ceil(0.9 * K_MEMBERS) - 1];
    const q25 = nodes[Math.floor(0.25 * K_MEMBERS)];
    const q75 = nodes[Math.ceil(0.75 * K_MEMBERS) - 1];
    const above = (v: number) => {
      let a = 0, b = zSorted.length;
      while (a < b) { const m = (a + b) >> 1; if (zSorted[m] < v) a = m + 1; else b = m; }
      return a;
    };
    return {
      wide: (above(hiZ) - above(loZ)) / zSorted.length,
      mid: (above(q75) - above(q25)) / zSorted.length,
    };
  };
  let mult = 1;
  if (template) {
    const score = (k: number) => {
      const c = bandCover(k);
      return c === null ? null : Math.min(c.wide / 0.8, c.mid / 0.5);
    };
    let lo = 0.25, hi = 6;
    const wide = score(hi);
    if (wide !== null && wide >= 1) {
      for (let it = 0; it < 26; it++) {
        const mid = Math.sqrt(lo * hi);
        const c = score(mid);
        if (c !== null && c >= 1) hi = mid; else lo = mid;
      }
      mult = hi;
    } else if (wide !== null) {
      mult = 6;
    }
  }
  sg.template = template;
  sg.mult = mult;
  const lo = vspec.kind === 'logit' ? 0 : (vspec.kind === 'log1p' ? 0 : null);
  const hi = vspec.kind === 'logit' ? 100 : null;

  const memberSets = testIdx.map(i => {
    const p = predict(i);
    return finite(p) ? pseudoMembers({ kind: vspec.kind, mu: p, sd: sdOf(i), lo, hi, template, mult }) : null;
  });
  const medians = memberSets.map(m => (m ? quantile(m, 0.5) : null));
  const means = memberSets.map(m => (m ? meanS(m) : null));
  const testObs = testIdx.map(i => obs[i]);
  const equalMean = testIdx.map(i => spec.mean[i]);
  const persistOffset = 24 * lead;
  const persistence = testIdx.map((i, k) => (k - persistOffset >= 0 ? obs[testIdx[k - persistOffset]] : null));

  const sqEqual = equalMean.map((v, k) => (finite(v) ? (v - testObs[k]) ** 2 : null));
  const sqModel = means.map((v, k) => (finite(v) ? (v - testObs[k]) ** 2 : null));
  const sqBest = testIdx.map(i => {
    const j = usable.indexOf(sel.bestSingle.id);
    const v = j >= 0 ? series[usable[j]][i] : null;
    return finite(v) ? (v - obs[i]) ** 2 : null;
  });

  const thresholds = vspec.thresholds || [];
  const events: Record<string, any> = {};
  for (const th of thresholds) {
    const probs = memberSets.map(m => (m ? m.filter(v => v <= th).length / m.length : null));
    const clim = trainIdx.length ? trainIdx.filter(i => obs[i] >= th).length / trainIdx.length : null;
    events[th] = {
      median: eventScores(medians, testObs, th),
      equalMean: eventScores(equalMean, testObs, th),
      probability: probScores(probs, testObs, th, clim),
    };
  }

  return {
    ...base, usable: true,
    selected: {
      family: sel.family, lambda: sel.winner.lambda,
      cvRmse: round(sel.winner.cvRmse, 5), cvN: sel.winner.cvN,
      cvStandardError: round(sel.cvStandardError, 5),
      cvGap: round(sel.cvGap, 5),
      withinOneSE: sel.cvGap <= sel.cvStandardError + 1e-12,
      bestCvFamily: sel.table[0].family,
      bestCvRmse: round(sel.table[0].cvRmse, 5),
    },
    candidates: sel.table.map(c => ({
      family: c.family, lambda: c.lambda,
      cvRmse: round(c.cvRmse, 5), cvN: c.cvN,
      cvGap: round(c.gap!, 5), cvGapSe: round(c.gapSe!, 5),
      chosen: c.family === sel.winner.family && c.lambda === sel.winner.lambda,
      fitted: c.family === sel.family && c.lambda === sel.winner.lambda,
    })),
    calibration: calibrationBundle(sel, spec, usable, crossVars, fill.map(f => forward(f)), sg, vspec.kind),
    bestSingle: { id: sel.bestSingle.id, name: modelNames[sel.bestSingle.id] || null, test: pointScores(testIdx.map(i => { const j = usable.indexOf(sel.bestSingle.id); return j >= 0 ? series[usable[j]][i] : null; }), testObs) },
    models: usable.map(id => ({ id, name: modelNames[id] || id, ...pointScores(testIdx.map(i => series[id][i]), testObs) })),
    equalMean: pointScores(equalMean, testObs),
    persistence: pointScores(persistence, testObs),
    median: pointScores(medians, testObs),
    mean: pointScores(means, testObs),
    probabilistic: probEnsembleScores(memberSets, testObs),
    events,
    daily: vspec.accum ? dailyAccumulation(spec, predict, testIdx, obs, inverse) : null,
    bootstrap: {
      vsEqualMean: pairedBootstrap(sqEqual, sqModel, 48, 800, 20250101 + lead),
      vsBestSingle: pairedBootstrap(sqBest, sqModel, 48, 800, 777 + lead),
    },
  };
}

import { applyLinear } from './linear-algebra.js';