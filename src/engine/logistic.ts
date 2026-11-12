/**
 * Logistic regression calibration (single variable).
 */

import { finite, round, meanS } from './numeric.js';

export interface LogisticCalibration {
  a: number;
  b: number;
  n: number;
  baseRate: number;
  sdX: number;
  meanX: number;
}

function logistic(a: number, b: number, x: number): number {
  const z = Math.max(-35, Math.min(35, a + b * x));
  return 1 / (1 + Math.exp(-z));
}

/** Single-variable logistic regression via gradient descent with adaptive step. */
export function logisticFit(x: number[], y: Array<number | null | undefined>): LogisticCalibration | null {
  const n = x.length;
  if (n < 200) return null;
  let pos = 0, sx = 0;
  for (let i = 0; i < n; i++) { if (y[i]) pos++; sx += x[i]; }
  const rate = pos / n;
  if (!(rate > 0) || rate >= 1) return null;
  let mx = sx / n, varX = 0;
  for (let i = 0; i < n; i++) varX += (x[i] - mx) ** 2;
  varX /= n;
  if (!(varX > 1e-12)) return null;
  const z = new Array(n);
  for (let i = 0; i < n; i++) z[i] = (x[i] - mx) / Math.sqrt(varX);

  let a = Math.log(rate / (1 - rate)), b = 0;
  let lr = 2;
  for (let it = 0; it < 4000; it++) {
    let ga = 0, gb = 0;
    for (let i = 0; i < n; i++) {
      const p = logistic(a, b, z[i]);
      const r = (y[i] ? 1 : 0) - p;
      ga += r; gb += r * z[i];
    }
    ga /= n; gb /= n;
    const na = a + lr * ga, nb = b + lr * gb;
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const p = logistic(na, nb, z[i]);
      ll += Math.log(Math.max(y[i] ? p : 1 - p, 1e-12));
    }
    let ll0 = 0;
    for (let i = 0; i < n; i++) {
      const p = logistic(a, b, z[i]);
      ll0 += Math.log(Math.max(y[i] ? p : 1 - p, 1e-12));
    }
    if (!(ll > ll0)) { lr *= 0.5; if (lr < 1e-6) break; continue; }
    const da = Math.abs(na - a) + Math.abs(nb - b);
    a = na; b = nb;
    lr = Math.min(4, lr * 1.15);
    if (da < 1e-9) break;
  }
  if (!finite(a) || !finite(b)) return null;
  return { a: round(a, 6), b: round(b, 6), n, baseRate: round(rate, 5), sdX: round(Math.sqrt(varX), 6), meanX: round(mx, 6) };
}

/** Apply stored logistic calibration to raw scores. */
export function applyCalibration(cal: LogisticCalibration | null, values: Array<number | null | undefined>): Array<number | null> {
  if (!cal) return values.map(() => null);
  const sd = cal.sdX || 1, mx = cal.meanX || 0;
  return values.map(v => finite(v) ? logistic(cal.a, cal.b, (v! - mx) / sd) : null);
}