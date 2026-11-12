/**
 * Linear algebra: centred cross-products, ridge/NNLS solvers.
 * Cross-products are built once per fold and reused across the whole ridge path.
 */

import { finite } from './numeric.js';

/** Solve Ax = b via Gaussian elimination with partial pivoting. */
export function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M: number[][] = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Centred cross-products of a design matrix. Predictors are standardised. */
export interface Moments {
  XtX: number[][];
  Xty: number[];
  mu: number[];
  ym: number;
  sd: number[];
  p: number;
  n: number;
  scale: number;
}

export function moments(X: number[][], y: number[]): Moments {
  const n = X.length, p = X[0].length;
  const mu = new Array(p).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mu[j] += X[i][j];
  for (let j = 0; j < p; j++) mu[j] /= n;
  let ym = 0;
  for (let i = 0; i < n; i++) ym += y[i];
  ym /= n;

  const sd = new Array(p).fill(1);
  for (let j = 0; j < p; j++) {
    let v = 0;
    for (let i = 0; i < n; i++) { const d = X[i][j] - mu[j]; v += d * d; }
    const s = Math.sqrt(v / Math.max(1, n - 1));
    sd[j] = s > 1e-12 ? s : 1;
  }

  const XtX: number[][] = [];
  const Xty = new Array(p).fill(0);
  for (let a = 0; a < p; a++) {
    const row = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const za = (X[i][a] - mu[a]) / sd[a];
      for (let c = a; c < p; c++) row[c] += za * ((X[i][c] - mu[c]) / sd[c]);
      Xty[a] += za * (y[i] - ym);
    }
    XtX.push(row);
  }
  for (let a = 0; a < p; a++) for (let c = 0; c < a; c++) XtX[a][c] = XtX[c][a];
  let tr = 0;
  for (let a = 0; a < p; a++) tr += XtX[a][a];
  return { XtX, Xty, mu, ym, sd, p, n, scale: p ? tr / p : 1 };
}

/** Ridge regression on centred moments. */
export function solveRidge(m: Moments, lambda: number): number[] | null {
  const A = m.XtX.map(r => r.slice());
  for (let a = 0; a < m.p; a++) A[a][a] += lambda * (m.scale || 1) + 1e-12;
  const beta = gaussSolve(A, m.Xty);
  return beta && beta.every(finite) ? beta : null;
}

/**
 * Lawson-Hanson non-negative least squares on centred moments.
 * Fit is a genuine non-negative combination of system columns.
 */
export function solveNNLS(m: Moments, lambda: number): number[] | null {
  const p = m.p;
  const A = m.XtX.map(r => r.slice());
  for (let a = 0; a < p; a++) A[a][a] += lambda * (m.scale || 1) + 1e-12;
  const w = new Array(p).fill(0);
  const inSet = new Array(p).fill(false);
  const idx: number[] = [];
  const limit = 4 * p + 10;

  for (let guard = 0; guard < limit; guard++) {
    let t = -1, best = 1e-10;
    for (let a = 0; a < p; a++) {
      if (inSet[a]) continue;
      let g = m.Xty[a];
      for (let c = 0; c < p; c++) g -= A[a][c] * w[c];
      if (g > best) { best = g; t = a; }
    }
    if (t < 0) break;
    inSet[t] = true;

    for (let inner = 0; inner < limit; inner++) {
      idx.length = 0;
      for (let a = 0; a < p; a++) if (inSet[a]) idx.push(a);
      const As = idx.map(a => idx.map(c => A[a][c]));
      const bs = idx.map(a => m.Xty[a]);
      const z = gaussSolve(As, bs);
      if (!z) { inSet[t] = false; break; }
      let alpha = 1;
      for (let s = 0; s < idx.length; s++) {
        if (z[s] <= 0) {
          const denom = w[idx[s]] - z[s];
          alpha = Math.min(alpha, denom > 1e-12 ? w[idx[s]] / denom : 0);
        }
      }
      if (alpha < 1) {
        for (let s = 0; s < idx.length; s++) w[idx[s]] += alpha * (z[s] - w[idx[s]]);
        for (let s = 0; s < idx.length; s++) if (w[idx[s]] <= 1e-12) { w[idx[s]] = 0; inSet[idx[s]] = false; }
      } else {
        for (let s = 0; s < idx.length; s++) w[idx[s]] = z[s];
        break;
      }
    }
  }
  for (let a = 0; a < p; a++) if (w[a] < 0) w[a] = 0;
  return w;
}

/** Linear model with stored centring/scaling for browser inference. */
export interface LinearModel {
  family: string;
  beta: number[];
  b0: number;
  mu: number[];
  sd: number[];
}

export function linearModel(family: string, beta: number[], m: Moments): LinearModel {
  return { family, beta: beta.slice(), b0: m.ym, mu: m.mu.slice(), sd: m.sd.slice() };
}

/** Apply linear model to a row (already in standardised space). */
export function applyLinear(model: LinearModel, row: number[]): number {
  let v = model.b0;
  for (let j = 0; j < model.beta.length; j++) {
    v += model.beta[j] * ((row[j] - model.mu[j]) / model.sd[j]);
  }
  return v;
}

/** Expanding-window blocked cross-validation folds. */
export interface Fold {
  train: number;
  valid: [number, number];
}

export function rollingFolds(n: number, k: number): Fold[] {
  const chunk = Math.floor(n / (k + 2));
  const folds: Fold[] = [];
  for (let f = 0; f < k; f++) {
    const trEnd = chunk * (f + 1);
    const vaStart = trEnd + chunk;
    const vaEnd = Math.min(n, vaStart + chunk);
    if (vaEnd - vaStart < 8) break;
    folds.push({ train: trEnd, valid: [vaStart, vaEnd] });
  }
  return folds;
}

/** sigma^2 = alpha + beta * spread^2, both constrained non-negative. */
export interface Sigma2 {
  alpha: number;
  beta: number;
}

export function sigma2(spreadSq: number[], sq: number[]): Sigma2 {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 0; i < spreadSq.length; i++) {
    const x = spreadSq[i], y = sq[i];
    if (!finite(x) || !finite(y)) continue;
    sx += x; sy += y; sxx += x * x; sxy += x * y; n++;
  }
  if (n < 20) return { alpha: Math.max(0, sy / Math.max(1, n)), beta: 0 };
  const denom = n * sxx - sx * sx;
  let beta = Math.abs(denom) > 1e-14 ? (n * sxy - sx * sy) / denom : 0;
  let alpha = (sy - beta * sx) / n;
  if (beta < 0) { beta = 0; alpha = sy / n; }
  if (alpha < 0) { alpha = 0; beta = 0; }
  return { alpha, beta };
}