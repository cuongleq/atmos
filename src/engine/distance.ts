/**
 * Great-circle distance and utilities.
 */

import { finite } from './numeric.js';

export const EARTH_RADIUS_KM = 6371;

/** Haversine distance between two lat/lon points in kilometers. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = EARTH_RADIUS_KM, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}