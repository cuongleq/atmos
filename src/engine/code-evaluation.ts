/**
 * WMO weather code evaluation (nearest-regime classifier).
 */

import { finite, round, meanS, sdS } from './numeric.js';
import { regimeKey, REGIME_EDGES, REGIME_MIN_SUPPORT, condGroup, CONDITIONS, conditionOf } from './regime.js';
import { Spec, makeSpec } from './predictors.js';
import { VariableSpec } from './variables.js';

export function evaluateCode(opts: {
  times: string[];
  obs: Array<number | null>;
  codeFeatures: Array<Array<number | null>>;
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
  const { times, obs, codeFeatures, variable, lead, trainEnd, testStart, purgeDays, utcOffset, modelNames, crossVars, cross, vspec, base, usable, trainIdx, testIdx } = opts;

  const feats = codeFeatures;
  if (!feats || !feats.length) return { ...base, usable: false, note: 'thiếu trường liên tục cho bộ phân loại mã thời tiết' };
  const n = times.length;
  const Z = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!feats.every(f => finite(f[i]))) continue;
    Z[i] = feats.map(f => f[i]);
  }
  const fitRows = trainIdx.filter(i => Z[i] && finite(obs[i]));
  if (fitRows.length < 400) return { ...base, usable: false, note: 'không đủ mẫu để phân loại mã thời tiết' };
  const mu = feats.map((_, j) => meanS(fitRows.map(i => Z[i]![j])));
  const sg = feats.map((_, j) => sdS(fitRows.map(i => Z[i]![j])) || 1);
  const bank = fitRows.slice(-2400).map(i => ({ x: Z[i]!.map((v, j) => (v - mu[j]) / sg[j]), c: obs[i]! }));
  const K = 45;
  const predict = (x: number[]): number | null => {
    const dist = new Array(bank.length);
    for (let b = 0; b < bank.length; b++) {
      let s = 0;
      for (let j = 0; j < x.length; j++) { const d = x[j] - bank[b].x[j]; s += d * d; }
      dist[b] = s;
    }
    const idx = dist.map((d, b) => [d, b]).sort((a, b) => a[0] - b[0]).slice(0, K);
    const tally = new Map<number, number>();
    for (const [, b] of idx) {
      const c = bank[b].c;
      tally.set(c, (tally.get(c) || 0) + 1 / (Math.sqrt(dist[b]) + 0.05));
    }
    let best: number | null = null, bestW = -1;
    for (const [c, w] of tally) if (w > bestW) { bestW = w; best = c; }
    return best;
  };
  const pred: number[] = [], truth: number[] = [];
  const predAt = new Map<number, number>();
  for (const i of testIdx) {
    if (!Z[i] || !finite(obs[i])) continue;
    const p = predict(Z[i]!.map((v, j) => (v - mu[j]) / sg[j]));
    pred.push(p!); predAt.set(i, p!); truth.push(obs[i]!);
  }
  let exact = 0, group = 0;
  for (let k = 0; k < pred.length; k++) {
    if (pred[k] === truth[k]) { exact++; group++; }
    else if (condGroup(pred[k]) === condGroup(truth[k])) group++;
  }

  const regime: Record<string, { total: number; codes: Record<number, number> }> = {};
  for (const i of fitRows) {
    const key = regimeKey(Z[i]!, REGIME_EDGES);
    if (!key) continue;
    const e = regime[key] || (regime[key] = { total: 0, codes: {} });
    e.total++;
    e.codes[obs[i]!] = (e.codes[obs[i]!] || 0) + 1;
  }
  const table: Array<{ key: string; code: number; support: number; purity: number }> = [];
  for (const key of Object.keys(regime)) {
    const e = regime[key];
    if (e.total < REGIME_MIN_SUPPORT) continue;
    let best: number | null = null, bestN = -1;
    for (const c of Object.keys(e.codes)) {
      const n = e.codes[+c];
      if (n > bestN) { bestN = n; best = +c; }
    }
    table.push({ key, code: best!, support: e.total, purity: bestN / e.total });
  }
  let lkExact = 0, lkGroup = 0, lkN = 0;
  let knnExact = 0, knnGroup = 0;
  const fullTable: Record<string, number> = {};
  for (const row of table) fullTable[row.key] = row.code;
  let scorable = 0;
  for (const i of testIdx) {
    if (!Z[i] || !finite(obs[i])) continue;
    scorable++;
    const key = regimeKey(Z[i]!, REGIME_EDGES);
    if (!key || !(key in fullTable)) continue;
    lkN++;
    if (fullTable[key] === obs[i]) { lkExact++; lkGroup++; }
    else if (condGroup(fullTable[key]) === condGroup(obs[i]!)) lkGroup++;
    const kp = predAt.get(i);
    if (kp === obs[i]) { knnExact++; knnGroup++; }
    else if (condGroup(kp!) === condGroup(obs[i]!)) knnGroup++;
  }
  table.sort((a, b) => a.key.localeCompare(b.key));

  return {
    ...base, usable: true,
    method: 'Phân loại theo vùng không gần nhất trên 5 trường liên tục: phủ mây, mưa, gió, cảm giác nhiệt, độ ẩm. Không hồi quy trực tiếp lên mã WMO.',
    selected: { family: 'knn', lambda: null, cvRmse: null, cvN: fitRows.length },
    testN: pred.length,
    accuracy: pred.length ? exact / pred.length : null,
    accuracyGroup: pred.length ? group / pred.length : null,
    baseRate: truth.length ? new Set(truth).size / truth.length : null,
    regime: {
      fields: ['cloud_cover', 'precipitation', 'wind_speed_10m', 'apparent_temperature', 'relative_humidity_2m'],
      modelIds: usable && usable.length ? usable.slice() : null,
      edges: REGIME_EDGES.map(e => e.slice()),
      minSupport: REGIME_MIN_SUPPORT,
      cells: table,
      lookupN: lkN,
      coverage: scorable ? lkN / scorable : null,
      accuracy: lkN ? lkExact / lkN : null,
      accuracyGroup: lkN ? lkGroup / lkN : null,
      knnAccuracySameRows: lkN ? knnExact / lkN : null,
      knnAccuracyGroupSameRows: lkN ? knnGroup / lkN : null,
    },
  };
}