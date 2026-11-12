/**
 * Hydrology: river discharge risk, flood levels, nominal stage-discharge.
 */

import { finite, round, clamp, meanS, quantile } from './numeric.js';
import { distanceKm } from './distance.js';

/** River discharge risk from GloFAS percentiles. */
export interface RiverRiskOpts {
  q: number | null;
  qP25: number | null;
  qP75: number | null;
  recent: number | null;
}

export interface RiverRiskResult {
  q: number | null;
  p25: number | null;
  p75: number | null;
  vsRecent: number | null;
  exceed: number | null;
  recent: number | null;
}

export function riverRisk(opts: RiverRiskOpts): RiverRiskResult | null {
  const { q, qP25, qP75, recent } = opts;
  if (!finite(q)) return null;
  const band = finite(qP25) && finite(qP75) ? { p25: qP25!, p75: qP75! } : null;
  let vsRecent: number | null = null;
  if (finite(recent) && recent! > 0) vsRecent = (q! - recent!) / recent!;
  let exceed: number | null = null;
  if (band && finite(recent) && recent! > 0 && band.p25 > 0 && band.p75 > band.p25) {
    const f = (Math.log(recent!) - Math.log(band.p25)) / (Math.log(band.p75) - Math.log(band.p25));
    exceed = round(clamp(1 - clamp(f, 0, 1), 0, 1), 2);
  }
  const rising = finite(vsRecent) ? vsRecent : null;
  return {
    q: round(q!, 1), p25: band ? round(band.p25, 1) : null, p75: band ? round(band.p75, 1) : null,
    vsRecent: round(rising!, 3), exceed, recent: round(recent!, 1),
  };
}

/** Flood alarm levels from discharge history percentiles. */
export const FLOOD_BANDS = [
  { at: 0.90, level: 0, key: 'canh_bao', label: 'Cảnh báo', tone: 'low' },
  { at: 0.95, level: 1, key: 'bd1', label: 'Báo động 1', tone: 'mid' },
  { at: 0.98, level: 2, key: 'bd2', label: 'Báo động 2', tone: 'high' },
  { at: 0.995, level: 3, key: 'bd3', label: 'Báo động 3', tone: 'severe' },
] as const;

export interface FloodLevelThreshold {
  at: number;
  level: number;
  key: string;
  label: string;
  tone: string;
  q: number | null;
  days: number;
  h: number | null;
}

export interface FloodLevelsResult {
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  thresholds: FloodLevelThreshold[];
  qNow: number | null;
  percent: number | null;
  rankFromTop: number | null;
  now: FloodLevelThreshold | null;
  peakQ: number | null;
  peakInDays: number | null;
  peakBand: FloodLevelThreshold | null;
}

function quantileSorted(s: number[], p: number): number | null {
  if (!s.length) return null;
  return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)];
}

export interface FloodLevelsOpts {
  history: Array<number | null>;
  qNow: number | null;
  qForecast: Array<number | null>;
  rating?: { a: number; b: number; q0: number } | null;
}

export function floodLevels(opts: FloodLevelsOpts): FloodLevelsResult | null {
  const { history, qNow, qForecast, rating } = opts;
  const s = (history || []).filter(v => finite(v) && v! >= 0).sort((a, b) => a - b);
  if (s.length < 30) return null;
  const thresholds = FLOOD_BANDS.map(b => {
    const q = quantileSorted(s, b.at);
    return {
      ...b,
      q: q !== null ? round(q, 1) : null,
      days: Math.max(1, s.length - Math.round(b.at * (s.length - 1))),
      h: rating ? nominalStage(q!, rating.a, rating.b, rating.q0) : null,
    };
  });
  let below = 0;
  if (finite(qNow)) {
    for (const v of s) { if (v <= qNow!) below++; else break; }
  }
  const bandOf = (v: number | null): FloodLevelThreshold | null => {
    if (!finite(v)) return null;
    let hit: FloodLevelThreshold | null = null;
    for (const b of thresholds) if (v! >= b.q!) hit = b;
    return hit;
  };
  const fc = (qForecast || []).filter(v => finite(v));
  let peak: number | null = null, peakIn: number | null = null;
  for (let i = 0; i < fc.length; i++) if (peak === null || fc[i]! > peak) { peak = fc[i]!; peakIn = i; }
  return {
    n: s.length,
    min: round(s[0], 1), max: round(s[s.length - 1], 1),
    mean: round(meanS(s), 1), p50: round(quantileSorted(s, 0.5), 1),
    thresholds,
    qNow: finite(qNow) ? round(qNow!, 1) : null,
    percent: finite(qNow) ? round(below / s.length, 3) : null,
    rankFromTop: finite(qNow) ? s.length - below : null,
    now: bandOf(qNow),
    peakQ: peak === null ? null : round(peak, 1),
    peakInDays: peakIn,
    peakBand: bandOf(peak),
  };
}

/** Nominal water level in metres from discharge (power law H = a * (Q/q0)^b). */
export function nominalStage(q: number | null, a: number | null, b: number | null, q0 = 100): number | null {
  if (!finite(q) || !finite(a) || !finite(b) || !b) return null;
  if (q! <= 0) return 0;
  return round(a! * Math.pow(q! / q0, b!), 2);
}

/** Inverse: stage in metres back to discharge. */
export function stageToQ(H: number | null, a: number | null, b: number | null, q0 = 100): number | null {
  if (!finite(H) || !finite(a) || !finite(b) || !b) return null;
  if (H! <= 0) return 0;
  return round(q0 * Math.pow(H! / a!, 1 / b!), 1);
}