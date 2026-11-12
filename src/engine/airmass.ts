/**
 * Air mass diagnostics: thickness, trajectory, classification, frontal passage.
 */

import { finite, round, clamp } from './numeric.js';
import { distanceKm } from './distance.js';

/** 500-850 hPa thickness in metres. */
export function thickness(z500: number | null, z850: number | null): number | null {
  if (!finite(z500) || !finite(z850)) return null;
  return z500 - z850;
}

/** Wind components in m/s from speed (km/h) and direction it blows FROM. */
export function toUms(speedKmh: number | null, dirDeg: number | null): { u: number | null; v: number | null } {
  if (!finite(speedKmh) || !finite(dirDeg)) return { u: null, v: null };
  const s = speedKmh / 3.6, r = dirDeg * Math.PI / 180;
  return { u: -s * Math.sin(r), v: -s * Math.cos(r) };
}

/** Move lat/lon by east-north displacement in km. */
export function offsetLatLon(lat: number, lon: number, dxKm: number, dyKm: number): { lat: number; lon: number } {
  const dLat = dyKm / 111.32;
  const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
  const dLon = dxKm / (111.32 * cos);
  return { lat: lat + dLat, lon: lon + dLon };
}

/** Forward/backward air-mass trajectory by integrating 850 hPa wind. */
export interface TrajectoryOpts {
  lat: number;
  lon: number;
  u: Array<number | null>;
  v: Array<number | null>;
  hours?: number;
  stepKm?: number;
  sign?: 1 | -1;
}

export function trajectory(opts: TrajectoryOpts): Array<{ lat: number; lon: number; hoursAgo: number; speedKmh: number | null }> {
  const { lat, lon, u, v, hours = 24, stepKm = 25, sign = 1 } = opts;
  const n = Math.max(1, Math.round(hours));
  const legs: Array<{ lat: number; lon: number; hoursAgo: number; speedKmh: number | null }> = [{ lat, lon, hoursAgo: 0, speedKmh: null }];
  let cur = { lat, lon };
  for (let h = 1; h <= n; h++) {
    const i = Math.min(u.length, v.length) - h;
    if (i < 0) break;
    if (!finite(u[i]) || !finite(v[i])) break;
    const speed = Math.hypot(u[i]!, v[i]!);
    if (speed < 0.1) break;
    const scale = (stepKm * sign) / speed;
    cur = offsetLatLon(cur.lat, cur.lon, u[i]! * scale, v[i]! * scale);
    legs.push({ lat: cur.lat, lon: cur.lon, hoursAgo: sign > 0 ? -h : h, speedKmh: speed * 3.6 });
  }
  return legs;
}

/** Compass bearing in degrees from point a to point b. */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const dLon = (b.lon - a.lon) * r, lat1 = a.lat * r, lat2 = b.lat * r;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/** Minimum distance from point to polyline (great-circle steps). */
export interface NearestOnTrackResult {
  km: number;
  point: { lat: number; lon: number };
  legIndex: number;
  frac: number;
  hoursAgo: number;
}

export function nearestOnTrack(pt: { lat: number; lon: number }, legs: Array<{ lat: number; lon: number; hoursAgo: number }>): NearestOnTrackResult | null {
  let best: NearestOnTrackResult | null = null;
  for (let i = 0; i + 1 < legs.length; i++) {
    const a = legs[i], b = legs[i + 1];
    if (!a || !b) continue;
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const p = { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
      const km = distanceKm(pt, p);
      if (!best || km < best.km) {
        best = { km, point: p, legIndex: i, frac: f, hoursAgo: a.hoursAgo + (b.hoursAgo - a.hoursAgo) * f };
      }
    }
  }
  return best;
}

/** Classify air mass at a point into Vietnamese-language tag. */
export interface AirMassResult {
  tag: string;
  tone: 'cold' | 'warm' | 'cool' | 'mild' | 'neutral';
  dT: number | null;
  dThick: number | null;
  t850: number | null;
  advection: 'Bắc' | 'Đông' | 'Nam' | 'Tây' | null;
  moisture: 'Ẩm' | 'Khô' | 'Ẩm vừa' | null;
  rh850: number | null;
}

export interface AirMassOpts {
  t850: number | null;
  t850Baseline: number | null;
  thick: number | null;
  thickBaseline: number | null;
  rh850: number | null;
  source: number | null;
}

export function airMass(opts: AirMassOpts): AirMassResult | null {
  const { t850, t850Baseline, thick, thickBaseline, rh850, source } = opts;
  if (!finite(t850)) return null;
  const dT = finite(t850Baseline) ? t850 - t850Baseline : null;
  const dThick = (finite(thick) && finite(thickBaseline)) ? thick - thickBaseline : null;

  let tag = 'Ôn hòa', tone: AirMassResult['tone'] = 'neutral';
  if (finite(dT) && finite(dThick)) {
    if (dT <= -3 && dThick <= -60) { tag = 'Khối lạnh'; tone = 'cold'; }
    else if (dT >= 3 && dThick >= 60) { tag = 'Khối nóng'; tone = 'warm'; }
    else if (dT <= -1.5) { tag = 'Hơi lạnh'; tone = 'cool'; }
    else if (dT >= 1.5) { tag = 'Hơi nóng'; tone = 'mild'; }
  } else if (finite(dT)) {
    if (dT <= -3) { tag = 'Khối lạnh'; tone = 'cold'; }
    else if (dT >= 3) { tag = 'Khối nóng'; tone = 'warm'; }
    else if (dT <= -1.5) { tag = 'Hơi lạnh'; tone = 'cool'; }
    else if (dT >= 1.5) { tag = 'Hơi nóng'; tone = 'mild'; }
  }

  let advection: AirMassResult['advection'] = null;
  if (finite(source)) {
    advection = (source >= 315 || source < 45) ? 'Bắc' : (source >= 45 && source < 135) ? 'Đông' : (source >= 135 && source < 225) ? 'Nam' : 'Tây';
  }
  const moisture = finite(rh850)
    ? (rh850! >= 85 ? 'Ẩm' : rh850! <= 45 ? 'Khô' : 'Ẩm vừa')
    : null;
  return { tag, tone, dT: round(dT, 1), dThick: round(dThick, 1), t850: round(t850, 1), advection, moisture, rh850: round(rh850, 0) };
}

/** Detect frontal passage from 850 hPa series. */
export interface FrontalResult {
  kind: 'Mặt lạnh' | 'Mặt ấm';
  leadHours: number;
  windShift: number;
  dT: number;
}

export function frontalPassage(opts: { dir850: Array<number | null>; t850: Array<number | null>; hoursBack?: number }): FrontalResult | null {
  const { dir850, t850, hoursBack = 12 } = opts;
  const n = Math.min(dir850.length, t850.length);
  if (n < hoursBack + 2) return null;
  const i0 = n - 1, i1 = n - 1 - hoursBack;
  const dir0 = dir850[i0], dir1 = dir850[i1];
  const t0 = t850[i0], t1 = t850[i1];
  if (!finite(dir0) || !finite(dir1) || !finite(t0) || !finite(t1)) return null;
  const shift = ((dir0! - dir1! + 540) % 360) - 180;
  const dT = t0! - t1!;
  if (shift >= 20 && dT <= -1) return { kind: 'Mặt lạnh', leadHours: hoursBack, windShift: round(shift, 0)!, dT: round(dT, 1)! };
  if (shift <= -20 && dT >= 1) return { kind: 'Mặt ấm', leadHours: hoursBack, windShift: round(shift, 0)!, dT: round(dT, 1)! };
  return null;
}

/** Air mass grid for mapping. */
export interface AirMassGridResult {
  cells: Array<{ lat: number; lon: number; km: number }>;
  mean: { t850: number | null; thick: number | null } | null;
  grid: number;
}

export function airMassGrid(opts: { lat: number; lon: number; radiusKm?: number; stepKm?: number; values: Array<{ t850: number | null; z500: number | null; z850: number | null; rh850: number | null; windDeg: number | null }> }): AirMassGridResult {
  const { lat, lon, radiusKm = 700, stepKm = 200, values } = opts;
  if (!Array.isArray(values) || !values.length) return { cells: [], mean: null, grid: 0 };
  const tAll: number[] = [], thAll: number[] = [];
  for (const v of values) {
    if (finite(v.t850)) tAll.push(v.t850!);
    const th = thickness(v.z500, v.z850);
    if (finite(th)) thAll.push(th!);
  }
  const tMean = meanS(tAll), thMean = meanS(thAll);
  const cells: Array<{ lat: number; lon: number; km: number }> = [];
  const n = Math.ceil(radiusKm / stepKm);
  for (let iy = -n; iy <= n; iy++) {
    for (let ix = -n; ix <= n; ix++) {
      const dx = ix * stepKm, dy = iy * stepKm;
      if (Math.hypot(dx, dy) > radiusKm) continue;
      const p = offsetLatLon(lat, lon, dx, dy);
      cells.push({ lat: round(p.lat, 3)!, lon: round(p.lon, 3)!, km: round(Math.hypot(dx, dy), 0)! });
    }
  }
  return { cells, mean: { t850: round(tMean, 2), thick: round(thMean, 1) }, grid: values.length };
}

export function classifyCell(cell: any, mean: { t850: number | null; thick: number | null }, windDeg: number | null) {
  const tag = airMass({
    t850: cell.t850, t850Baseline: mean.t850,
    thick: cell.thick, thickBaseline: mean.thick,
    rh850: cell.rh850, source: windDeg,
  });
  return tag ? { ...cell, ...tag, tone: tag.tone } : cell;
}

import { meanS } from './numeric.js';