/**
 * Wind utilities: speed/direction conversion, barbs, circular distance.
 */

import { finite, round, clamp } from './numeric.js';

/** Speed (km/h) from u/v components (m/s). */
export function toSpeed(u: number, v: number): number {
  return Math.hypot(u, v) * 3.6;
}

/** Direction (degrees, from) from u/v components (m/s). */
export function toDir(u: number, v: number): number {
  return (Math.atan2(v, u) * 180 / Math.PI + 360) % 360;
}

/** Smallest angle between two bearings in 0..180. Zero means identical. */
export function circularAbs(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** Wind barbs: line length and head count encode speed, rotation shows direction. */
export interface WindBarb {
  level: number;
  half: number;
  full: number;
  dirDeg: number;
  speedKmh: number;
}

export function windBarb(speedKmh: number | null, dirDeg: number | null): WindBarb | null {
  if (!finite(speedKmh) || !finite(dirDeg)) return null;
  const level = Math.min(5, Math.floor(speedKmh! / 10));
  const half = Math.floor(level / 2), full = level % 2;
  return { level, half, full, dirDeg: round(clamp(((dirDeg! % 360) + 360) % 360, 0, 360), 1), speedKmh: round(speedKmh!, 1) };
}