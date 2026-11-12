/**
 * Predictor construction: design matrix, harmonics, cross-variables.
 */

import { finite, round } from './numeric.js';
import { TransformKind, FORWARD } from './transforms.js';
import { Moments, moments } from './linear-algebra.js';

export const HARMONIC = 4; // sin/cos of local hour and day of year
export const LAMBDA_GRID = [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3, 1, 3];
export const CV_FOLDS = 8;

export function hourOf(times: string[], i: number, utcOffset?: number): number {
  const h = Number(times[i].slice(11, 13));
  return (((h + (utcOffset || 0)) % 24) + 24) % 24;
}

export function dayOfYear(times: string[], i: number): number {
  const d = Date.UTC(+times[i].slice(0, 4), +times[i].slice(5, 7) - 1, +times[i].slice(8, 10));
  return Math.round((d - Date.UTC(+times[i].slice(0, 4), 0, 1)) / 86400000);
}

export interface Spec {
  n: number;
  times: string[];
  obs: Array<number | null>;
  modelIds: string[];
  vals: Array<Array<number | null>>;
  mean: Array<number | null>;
  spread: number[];
  hour: number[];
  doy: number[];
  forward: (x: number) => number;
  kind: TransformKind;
  nModels: number;
  nCross: number;
  p: number;
  crossCols: Array<Array<number | null>>;
  row: (i: number) => number[] | null;
}

/** Build cross-fill values (mean over training window) for missing cross-predictors. */
export function buildCrossFill(
  times: string[], crossVars: string[], cross: Record<string, Array<number | null>>, trainIdx: number[]
): { cols: Array<Array<number | null>>; fill: number[] } {
  if (!crossVars.length) return { cols: [], fill: [] };
  const cols = crossVars.map(v => cross[v]);
  const fill = cols.map((col) => {
    let s = 0, c = 0;
    for (const i of trainIdx) if (finite(col[i])) { s += col[i]!; c++; }
    return c ? s / c : 0;
  });
  return { cols, fill };
}

/** Build the full specification for fitting. */
export function makeSpec(opts: {
  times: string[];
  obs: Array<number | null>;
  series: Record<string, Array<number | null>>;
  modelIds: string[];
  cross: Array<Array<number | null>>;
  crossFill: number[];
  utcOffset: number | undefined;
  forward: (x: number) => number;
  kind: TransformKind;
}): Spec {
  const { times, obs, series, modelIds, cross, crossFill, utcOffset, forward, kind } = opts;
  const n = times.length;
  const vals = modelIds.map(id => series[id].map(v => finite(v) ? forward(v) : null));
  const mean = new Array<Array<number | null>>(n).fill(null).map(() => null);
  const spread = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0, s2 = 0, c = 0;
    for (let j = 0; j < vals.length; j++) if (finite(vals[j][i])) { s += vals[j][i]!; s2 += vals[j][i]! ** 2; c++; }
    mean[i] = c ? s / c : null;
    spread[i] = c > 1 ? Math.sqrt(Math.max(0, s2 / c - mean[i]! ** 2)) : 0;
  }
  const hour = new Array(n), doy = new Array(n);
  for (let i = 0; i < n; i++) { hour[i] = hourOf(times, i, utcOffset); doy[i] = dayOfYear(times, i); }
  const nCross = cross.length;
  const spec: Spec = {
    n, times, obs, modelIds, vals, mean, spread, hour, doy, forward, kind,
    nModels: modelIds.length, nCross,
    p: 2 + modelIds.length + nCross + HARMONIC,
    crossCols: [],
    row: () => null, // placeholder, filled below
  };
  for (let j = 0; j < nCross; j++) {
    spec.crossCols.push(cross[j].map(v => (finite(v) ? forward(v) : (crossFill[j] !== undefined ? crossFill[j] : null))));
  }
  spec.row = (i: number) => {
    if (!finite(spec.mean[i])) return null;
    const row = new Array(spec.p);
    row[0] = spec.mean[i]!; row[1] = spec.spread[i];
    let k = 2;
    for (let j = 0; j < spec.nModels; j++) { row[k] = spec.vals[j][i]; k++; }
    for (let j = 0; j < nCross; j++) { row[k] = spec.crossCols[j][i]; k++; }
    row[k++] = Math.sin(2 * Math.PI * spec.hour[i] / 24);
    row[k++] = Math.cos(2 * Math.PI * spec.hour[i] / 24);
    row[k++] = Math.sin(2 * Math.PI * spec.doy[i] / 365.25);
    row[k++] = Math.cos(2 * Math.PI * spec.doy[i] / 365.25);
    for (let j = 0; j < spec.p; j++) if (!finite(row[j])) return null;
    return row;
  };
  return spec;
}

/** Best single system on given rows, scored in physical units. */
export function bestSingle(spec: Spec, idx: number[], inverse: (x: number) => number): { id: string | null; rmse: number | null } {
  let bestId: string | null = null, bestRmse = Infinity;
  for (let j = 0; j < spec.nModels; j++) {
    let se = 0, c = 0;
    for (const i of idx) {
      const v = spec.vals[j][i];
      if (!finite(v) || !finite(spec.obs[i])) continue;
      se += (inverse(v!) - spec.obs[i]!) ** 2; c++;
    }
    if (c > 20 && se / c < bestRmse) { bestRmse = se / c; bestId = spec.modelIds[j]; }
  }
  return { id: bestId, rmse: finite(bestRmse) ? Math.sqrt(bestRmse) : null };
}