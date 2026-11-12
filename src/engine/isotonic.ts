/**
 * Isotonic regression (pool-adjacent-violators) for calibration.
 */

import { finite, round, meanS } from './numeric.js';

export interface IsotonicCalibration {
  knots: number[];
  values: number[];
  n: number;
  baseRate: number;
  bins: number;
}

/** Pool-adjacent-violators: merge adjacent bins when rate is not monotonic. */
function pav(y: number[], w: number[]): { val: number[]; wt: number[]; lo: number[]; hi: number[] } {
  const val: number[] = [], wt: number[] = [], lo: number[] = [], hi: number[] = [];
  for (let i = 0; i < y.length; i++) {
    val.push(y[i]); wt.push(w[i]); lo.push(i); hi.push(i);
    while (val.length >= 2) {
      const n = val.length;
      if (!(val[n - 2] / wt[n - 2] > val[n - 1] / wt[n - 1])) break;
      const l2 = lo.pop()!, h2 = hi.pop()!;
      const l1 = lo.pop()!;
      val[n - 2] += val[n - 1];
      wt[n - 2] += wt[n - 1];
      val.pop(); wt.pop();
      lo.push(l1); hi.push(h2);
    }
  }
  return { val, wt, lo, hi };
}

/** Fit isotonic calibration on raw scores. */
export function isotonicCalibrate(x: number[], y: Array<number | null | undefined>, maxBins = 20, minPerBin = 120): IsotonicCalibration | null {
  const n = x.length;
  if (n < 500) return null;
  let pos = 0;
  for (let i = 0; i < n; i++) if (y[i]) pos++;
  const baseRate = pos / n;
  if (!(baseRate > 0) || baseRate >= 1) return null;

  const sorted = [...x].sort((a, b) => a - b);
  const knots: number[] = [];
  for (let b = 0; b <= maxBins; b++) knots.push(sorted[Math.min(n - 1, Math.floor((b / maxBins) * n))]);
  const uniq = [...new Set(knots)].sort((a, b) => a - b);

  const mid: number[] = [], ry: number[] = [], rw: number[] = [];
  for (let b = 0; b < uniq.length - 1; b++) {
    const lo = uniq[b], hi = uniq[b + 1];
    if (!(hi > lo)) continue;
    let s = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (x[i] >= lo && x[i] < hi) { s += y[i] ? 1 : 0; k++; }
    }
    if (k < minPerBin) continue;
    mid.push((lo + hi) / 2); ry.push(s); rw.push(k);
  }
  if (!mid.length) return null;
  const { val, wt, lo, hi } = pav(ry, rw);
  const blockKnots = lo.map((a, i) => (mid[a] + mid[hi[i]]) / 2);
  return {
    knots: blockKnots,
    values: val.map((v, i) => Math.max(1e-6, Math.min(1 - 1e-6, v / (wt[i] || 1)))),
    n, baseRate: round(baseRate, 5), bins: mid.length,
  };
}

/** Apply stored isotonic calibration via linear interpolation on knots. */
export function applyIsotonic(cal: IsotonicCalibration | null, values: Array<number | null | undefined>): Array<number | null> {
  if (!cal) return values.map(() => null);
  return values.map(v => {
    if (!finite(v)) return null;
    const k = cal.knots;
    if (v! <= k[0]) return cal.values[0];
    if (v! >= k[k.length - 1]) return cal.values[cal.values.length - 1];
    let lo = 0, hi = k.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (k[m] <= v!) lo = m; else hi = m; }
    const t = (v! - k[lo]) / (k[hi] - k[lo] || 1);
    return cal.values[lo] + (cal.values[hi] - cal.values[lo]) * t;
  });
}