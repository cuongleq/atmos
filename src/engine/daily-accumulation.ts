/**
 * Rolling 24-hour accumulation for precipitation variables.
 */

import { finite, meanS, round } from './numeric.js';
import { Spec } from './predictors.js';

export function dailyAccumulation(
  spec: Spec,
  predict: (i: number) => number | null,
  testIdx: number[],
  obs: Array<number | null>,
  inverse: (x: number) => number
): any {
  const days = new Map<string, { pred: Array<number | null>; obs: Array<number | null> }>();
  for (let k = 0; k < testIdx.length; k++) {
    const i = testIdx[k];
    const day = spec.times[i].slice(0, 10);
    if (!days.has(day)) days.set(day, { pred: [], obs: [] });
    const p = predict(i);
    const rec = days.get(day)!;
    rec.pred.push(finite(p) ? inverse(p!) : null);
    rec.obs.push(obs[i]);
  }
  const rows: Array<{ day: string; pred: number; obs: number }> = [];
  for (const [day, r] of days) {
    const p = r.pred.filter(finite), o = r.obs.filter(finite);
    if (p.length < 20 || o.length < 20) continue;
    rows.push({ day, pred: p.reduce((s, v) => s + v, 0), obs: o.reduce((s, v) => s + v, 0) });
  }
  if (rows.length < 5) return null;
  const events: Record<string, any> = {};
  for (const th of [10, 25, 50, 100]) events[th] = eventScores(rows.map(r => r.pred), rows.map(r => r.obs), th);
  return {
    days: rows.length,
    meanPred: round(meanS(rows.map(r => r.pred)), 1), meanObs: round(meanS(rows.map(r => r.obs)), 1),
    bias: round(meanS(rows.map(r => r.pred - r.obs)), 1),
    ...pointScores(rows.map(r => r.pred), rows.map(r => r.obs)), events,
  };
}

import { pointScores, eventScores } from './scores.js';