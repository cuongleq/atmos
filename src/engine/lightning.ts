/**
 * Lightning risk index: convective energy index and verification.
 */

import { finite, round, clamp, meanS, quantile } from './numeric.js';

export const CAPE_REF = 2500;
export const LI_LO = -6, LI_HI = 4;
export const CIN_MAX = 200;

export interface LightningIndexOpts {
  cape: number | null;
  liftedIndex: number | null;
  convectiveInhibition: number | null;
}

export interface LightningIndexResult {
  risk: number;
  ingredients: string[];
  partial: boolean;
}

/** Convective energy index: geometric mean of normalised CAPE, LI, CIN. */
export function lightningIndex(o: LightningIndexOpts | null): LightningIndexResult | null {
  if (!o) return null;
  const parts: Record<string, number> = {};

  if (finite(o.cape)) {
    parts.cape = clamp(Math.sqrt(Math.max(0, o.cape!)) / Math.sqrt(CAPE_REF), 0, 1);
  }
  if (finite(o.liftedIndex)) {
    parts.li = clamp((LI_HI - o.liftedIndex!) / (LI_HI - LI_LO), 0, 1);
  }
  if (finite(o.convectiveInhibition)) {
    parts.cin = clamp(1 - Math.max(0, o.convectiveInhibition!) / CIN_MAX, 0.15, 1);
  }

  const W = { cape: 0.60, li: 0.25, cin: 0.15 };
  let sum = 0, wsum = 0;
  for (const k of ['cape', 'li', 'cin'] as const) {
    if (!finite(parts[k])) continue;
    sum += W[k] * Math.log(parts[k]);
    wsum += W[k];
  }
  if (!wsum) return null;
  const ingredients = ['cape', 'li', 'cin'].filter(k => finite(parts[k]));
  return {
    risk: clamp(Math.exp(sum / wsum), 0, 1),
    ingredients,
    partial: ingredients.length < 3,
  };
}

/** Spearman rank correlation. */
export function spearman(a: Array<number | null>, b: Array<number | null>): number | null {
  const pairs: [number, number][] = [];
  for (let i = 0; i < a.length; i++) {
    if (finite(a[i]) && finite(b[i])) pairs.push([a[i]!, b[i]!]);
  }
  const n = pairs.length;
  if (n < 5) return null;
  const rank = (vals: number[]) => {
    const idx = vals.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(vals.length);
    for (let i = 0; i < n;) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(pairs.map(p => p[0]));
  const rb = rank(pairs.map(p => p[1]));
  const ma = meanS(ra), mb = meanS(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma, y = rb[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? clamp(num / Math.sqrt(da * db), -1, 1) : null;
}

/** Binary verification of lightning index against ERA5 precipitation. */
export interface LightningVerifyOpts {
  rows: Array<{ risk: number | null; obs: number | null }>;
  threshold: number;
}

export interface LightningVerifyResult {
  n: number;
  threshold: number;
  events: number;
  baseRate: number;
  warnAt: number;
  warnings: number;
  brier: number;
  bss: number;
  logLoss: number;
  hitRate: number | null;
  falseAlarmRate: number | null;
  precision: number | null;
  meanProb: number;
  spearman: number;
  reliability: Array<{ p: number; n: number; obs: number }>;
  insufficient?: boolean;
}

export function lightningVerify(rows: Array<{ risk: number | null; obs: number | null }> | LightningVerifyOpts, threshold?: number): LightningVerifyResult {
  // Support both calling conventions: lightningVerify(rows, threshold) or lightningVerify({ rows, threshold })
  const th = threshold ?? (rows as LightningVerifyOpts).threshold ?? 5;
  const rowsArr = Array.isArray(rows) ? rows : (rows as LightningVerifyOpts).rows;
  const clean = rowsArr.filter(r => finite(r.risk) && finite(r.obs));
  if (clean.length < 50) return { n: clean.length, threshold: th, events: 0, baseRate: 0, warnAt: 0, warnings: 0, brier: 0, bss: 0, logLoss: 0, hitRate: null, falseAlarmRate: null, precision: null, meanProb: 0, spearman: 0, reliability: [], insufficient: true };

  let base = 0, n = 0;
  for (const r of clean) { n++; if (r.obs! >= th) base++; }
  const baseRate = base / n;
  const warnAt = Math.min(0.95, baseRate);

  let hit = 0, fa = 0, miss = 0, sumSq = 0, sumLog = 0, sumRisk = 0;
  const bucket = Array.from({ length: 10 }, () => ({ n: 0, ev: 0 }));
  for (const r of clean) {
    const ev = r.obs! >= th ? 1 : 0;
    const p = clamp(r.risk!, 1e-6, 1 - 1e-6);
    sumRisk += p;
    sumSq += (p - ev) ** 2;
    sumLog += ev ? Math.log(p) : Math.log(1 - p);
    const warn = p >= warnAt ? 1 : 0;
    if (ev && warn) hit++;
    else if (ev) miss++;
    else if (warn) fa++;
    const b = Math.min(9, Math.max(0, Math.floor(p * 10)));
    bucket[b].n++; bucket[b].ev += ev;
  }
  const brier = sumSq / n;
  const bss = baseRate > 0 && baseRate < 1 ? 1 - brier / (baseRate * (1 - baseRate)) : 0;
  const warnN = hit + fa;
  return {
    n, threshold: th, events: base, baseRate: round(baseRate, 5),
    warnAt: round(warnAt, 5), warnings: warnN,
    brier: round(brier, 6), bss: round(bss, 4),
    logLoss: round(-sumLog / n, 5),
    hitRate: base ? round(hit / base, 4) : null,
    falseAlarmRate: warnN ? round(fa / warnN, 4) : null,
    precision: warnN ? round(hit / warnN, 4) : null,
    meanProb: round(sumRisk / n, 5),
    spearman: round(spearman(clean.map(r => r.risk!), clean.map(r => r.obs!)), 4),
    reliability: bucket.map((b, i) => b.n ? { p: round((i + 0.5) / 10, 1), n: b.n, obs: round(b.ev / b.n, 5) } : null).filter(Boolean) as Array<{ p: number; n: number; obs: number }>,
  };
}

/** Risk bands from local percentiles. */
export interface LightningBands {
  p50: number;
  p80: number;
  p95: number;
  p99: number;
  max: number;
  n: number;
}

export function lightningBands(values: number[]): LightningBands | null {
  const v = values.filter(finite);
  if (v.length < 200) return null;
  return {
    p50: round(quantile(v, 0.5), 4),
    p80: round(quantile(v, 0.8), 4),
    p95: round(quantile(v, 0.95), 4),
    p99: round(quantile(v, 0.99), 4),
    max: round(Math.max(...v), 4),
    n: v.length,
  };
}

export const LIGHTNING_LEVELS = [
  { id: 'low', name: 'Thấp', note: 'dưới trung vị của 12 tháng tại địa điểm này' },
  { id: 'p50', name: 'Trung bình', note: 'từ trung vị trở lên' },
  { id: 'p80', name: 'Khá', note: 'vượt 80% số giờ trong 12 tháng' },
  { id: 'p95', name: 'Cao', note: 'vượt 95% số giờ trong 12 tháng' },
  { id: 'p99', name: 'Rất cao', note: 'vượt 99% số giờ trong 12 tháng' },
];

/** Alert level from local percentile bands. */
export function lightningLevel(risk: number | null, bands: LightningBands | null): string | null {
  if (!finite(risk) || !bands) return null;
  if (risk! >= bands.p99) return 'p99';
  if (risk! >= bands.p95) return 'p95';
  if (risk! >= bands.p80) return 'p80';
  if (risk! >= bands.p50) return 'p50';
  return 'low';
}