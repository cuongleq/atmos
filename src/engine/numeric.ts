/**
 * Numeric core: basic math utilities used throughout the engine.
 * Pure functions, no dependencies.
 */

export const EPS = 1e-9;

export function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function round(v: number | null | undefined, d: number): number | null {
  if (!finite(v)) return v;
  const p = Math.pow(10, d);
  return Math.round(v! * p) / p;
}

/** Mean of finite values, null if none. */
export function meanS(a: Array<number | null | undefined>): number | null {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (finite(a[i])) { s += a[i]!; n++; }
  return n ? s / n : null;
}

/** Sample variance of finite values, null if < 2. */
export function varS(a: Array<number | null | undefined>): number | null {
  const m = meanS(a);
  if (m === null) return null;
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (finite(a[i])) { s += (a[i]! - m) ** 2; n++; }
  return n > 1 ? s / (n - 1) : 0;
}

export function sdS(a: Array<number | null | undefined>): number | null {
  const v = varS(a);
  return v === null ? null : Math.sqrt(v);
}

/** Linear-interpolation quantile over finite values. */
export function quantile(a: Array<number | null | undefined>, q: number): number | null {
  const f = a.filter(finite).sort((x, y) => x - y);
  if (!f.length) return null;
  if (f.length === 1) return f[0];
  const p = clamp(q, 0, 1) * (f.length - 1);
  const lo = Math.floor(p), hi = Math.ceil(p);
  return f[lo] + (p - lo) * (f[hi] - f[lo]);
}

/** Error function approximation (Abramowitz & Stegun 7.1.26). */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

export const ncdf = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));
export const pdf = (z: number): number => 0.3989422804014327 * Math.exp(-0.5 * z * z);

/** Acklam's inverse standard-normal CDF, absolute error < 1.15e-9. */
export function ncdfInv(p: number): number {
  if (!finite(p)) return NaN;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const tailNum = (c: number[], q: number) => ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5];
  const tailDen = (d: number[], q: number) => (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1;
  const cenNum = (a: number[], r: number) => ((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5];
  const cenDen = (b: number[], r: number) => ((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return tailNum(C, q) / tailDen(D, q);
  }
  if (p <= 1 - 0.02425) {
    const q = p - 0.5, r = q * q;
    return q * cenNum(A, r) / cenDen(B, r);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -tailNum(C, q) / tailDen(D, q);
}

/** Deterministic PRNG (xorshift*) for reproducible bootstrap. */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}