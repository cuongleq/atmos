/**
 * Weather regime classification: coarse binning for WMO code lookup.
 */

import { finite, round, clamp } from './numeric.js';

/** Coarse bin edges for five context fields in physical units. */
export const REGIME_EDGES: number[][] = [
  [20, 50, 80, 95],                 // cloud cover %
  [0.05, 0.5, 2, 5, 10],            // precipitation mm/h
  [5, 12, 20, 32],                  // wind speed km/h
  [10, 20, 26, 32],                 // apparent temperature °C
  [45, 65, 80, 92],                 // relative humidity %
];
export const REGIME_MIN_SUPPORT = 12;

/** Quantise a context vector into a lookup key, or null if a field is missing. */
export function regimeKey(row: number[], edges = REGIME_EDGES): string | null {
  let key = '';
  for (let j = 0; j < edges.length; j++) {
    const v = row[j];
    if (!finite(v)) return null;
    let b = 0;
    while (b < edges[j].length && v >= edges[j][b]) b++;
    key += b;
  }
  return key;
}

/** Group WMO codes into broad condition categories. */
export function condGroup(c: number): number {
  if (c === 0) return 0;
  if (c <= 3) return 1;
  if (c <= 48) return 2;
  if (c <= 57) return 3;
  if (c <= 67) return 4;
  if (c <= 77) return 5;
  if (c <= 82) return 6;
  if (c <= 86) return 7;
  return 8;
}

export const CONDITIONS = [
  'Trời quang', 'Có mây', 'Sương mù', 'Mưa phùn', 'Có mưa', 'Có tuyết', 'Mưa rào', 'Tuyết rào', 'Có dông',
];

export function conditionOf(c: number | null | undefined): string {
  return (finite(c) && c >= 0 && c <= 99) ? CONDITIONS[condGroup(Math.round(c!))] : 'Chưa có thông tin';
}