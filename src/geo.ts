/**
 * Geometry utilities for meteorological calculations.
 * Pure functions, no dependencies, works in Node and browser.
 */

/** Earth radius in kilometers (WGS84 mean radius). */
export const EARTH_RADIUS_KM = 6371.0088;

/**
 * Haversine distance between two lat/lon points in kilometers.
 * Numerically stable for small distances.
 */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Initial bearing (forward azimuth) from point A to point B in degrees [0, 360).
 * Used for wind direction, storm track, trajectory calculations.
 */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const toDeg = (rad: number) => rad * 180 / Math.PI;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = toDeg(Math.atan2(y, x));
  return (θ + 360) % 360;
}

/**
 * Destination point given start point, bearing (degrees), and distance (km).
 * Returns [lat, lon].
 */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKm: number
): [number, number] {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const toDeg = (rad: number) => rad * 180 / Math.PI;

  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const θ = toRad(bearingDeg);
  const δ = distanceKm / EARTH_RADIUS_KM;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );

  return [toDeg(φ2), toDeg(λ2)];
}

/**
 * Find nearest point on a polyline (track) to a given point.
 * Returns { km: distance, hoursAgo: interpolated index, lat, lon }.
 */
export interface TrackPoint {
  lat: number;
  lon: number;
  hoursAgo: number;
}

export interface NearestOnTrackResult {
  km: number;
  hoursAgo: number;
  lat: number;
  lon: number;
}

export function nearestOnTrack(
  point: { lat: number; lon: number },
  track: TrackPoint[]
): NearestOnTrackResult | null {
  if (track.length < 2) {
    return null;
  }

  let minKm = Infinity;
  let best: NearestOnTrackResult | null = null;

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i]!;
    const b = track[i + 1]!;

    // Project point onto segment a-b
    const segLat = b.lat - a.lat;
    const segLon = b.lon - a.lon;
    const segLen2 = segLat ** 2 + segLon ** 2;

    if (segLen2 === 0) {
      continue;
    }

    const t = Math.max(0, Math.min(1, (
      (point.lat - a.lat) * segLat + (point.lon - a.lon) * segLon
    ) / segLen2));

    const projLat = a.lat + t * segLat;
    const projLon = a.lon + t * segLon;
    const km = distanceKm(point.lat, point.lon, projLat, projLon);

    if (km < minKm) {
      minKm = km;
      const hoursAgo = a.hoursAgo + t * (b.hoursAgo - a.hoursAgo);
      best = { km, hoursAgo, lat: projLat, lon: projLon };
    }
  }

  return best;
}

/**
 * Vietnamese airport METAR stations.
 * Used for ground truth verification.
 */
export interface Airport {
  icao: string;
  name: string;
  lat: number;
  lon: number;
}

export const VIETNAM_AIRPORTS: Airport[] = [
  { icao: 'VVNB', name: 'Nội Bài', lat: 21.2212, lon: 105.8072 },
  { icao: 'VVTS', name: 'Tân Sơn Nhất', lat: 10.8188, lon: 106.6519 },
  { icao: 'VVDN', name: 'Đà Nẵng', lat: 16.0439, lon: 108.1994 },
  { icao: 'VVDL', name: 'Liên Khương (Đà Lạt)', lat: 11.7508, lon: 108.3703 },
  { icao: 'VVCT', name: 'Cần Thơ', lat: 10.0844, lon: 105.7119 },
  { icao: 'VVCR', name: 'Cam Ranh (Nha Trang)', lat: 11.9981, lon: 109.2194 },
  { icao: 'VVPB', name: 'Phú Bài (Huế)', lat: 16.4017, lon: 107.7028 },
  { icao: 'VVCI', name: 'Cát Bi (Hải Phòng)', lat: 20.8194, lon: 106.7264 },
  { icao: 'VVVH', name: 'Vinh', lat: 18.7364, lon: 105.6711 },
  { icao: 'VVBM', name: 'Buôn Ma Thuột', lat: 12.6681, lon: 108.1200 },
  { icao: 'VVPQ', name: 'Phú Quốc', lat: 10.1658, lon: 103.9961 },
  { icao: 'VVPC', name: 'Phù Cát (Quy Nhơn)', lat: 13.9550, lon: 109.0433 },
  { icao: 'VVUI', name: 'Đồng Hới', lat: 17.5147, lon: 106.5906 },
  { icao: 'VVCA', name: 'Chu Lai (Quảng Nam)', lat: 15.4061, lon: 108.7061 },
  { icao: 'VVCS', name: 'Côn Đảo', lat: 8.7322, lon: 106.6292 },
  { icao: 'VVVK', name: 'Rạch Giá', lat: 9.9592, lon: 105.1344 },
  { icao: 'VVCM', name: 'Cà Mau', lat: 9.1764, lon: 105.1767 },
  { icao: 'VVTX', name: 'Tuy Hòa', lat: 13.0378, lon: 109.3278 },
  { icao: 'VVDB', name: 'Điện Biên Phủ', lat: 21.3975, lon: 103.0078 },
  { icao: 'VVVD', name: 'Vân Đồn', lat: 21.1167, lon: 107.4167 },
  { icao: 'VVTH', name: 'Thọ Xuân (Thanh Hóa)', lat: 19.9022, lon: 105.4678 },
];

/**
 * Find nearest airport within maxRadiusKm.
 */
export function findNearestAirport(
  lat: number,
  lon: number,
  maxRadiusKm = 100
): Airport | null {
  let nearest: Airport | null = null;
  let minDist = Infinity;

  for (const apt of VIETNAM_AIRPORTS) {
    const d = distanceKm(lat, lon, apt.lat, apt.lon);
    if (d < minDist && d <= maxRadiusKm) {
      minDist = d;
      nearest = apt;
    }
  }

  return nearest;
}

/**
 * Thickness of atmospheric layer between two pressure levels (geopotential height difference).
 * Returns thickness in meters.
 */
export function thickness(zUpper: number | null, zLower: number | null): number | null {
  if (zUpper === null || zLower === null || !Number.isFinite(zUpper) || !Number.isFinite(zLower)) {
    return null;
  }
  return zUpper - zLower;
}

/**
 * Convert wind speed (km/h) and direction (degrees, meteorological convention: from)
 * to u/v components (m/s, positive = eastward/northward).
 * Returns { u, v } in m/s or null if inputs invalid.
 */
export function toUms(
  speedKmh: number | null,
  directionDeg: number | null
): { u: number | null; v: number | null } {
  if (speedKmh === null || directionDeg === null || !Number.isFinite(speedKmh) || !Number.isFinite(directionDeg)) {
    return { u: null, v: null };
  }
  const speedMs = speedKmh / 3.6;
  const rad = (directionDeg * Math.PI) / 180;
  // Meteorological convention: wind FROM directionDeg
  // u positive = eastward, v positive = northward
  return {
    u: -speedMs * Math.sin(rad),
    v: -speedMs * Math.cos(rad),
  };
}

/**
 * Convert u/v components (m/s) back to speed (km/h) and direction (degrees, from).
 */
export function fromUms(u: number, v: number): { speedKmh: number; directionDeg: number } {
  const speedMs = Math.hypot(u, v);
  let dir = (Math.atan2(-u, -v) * 180) / Math.PI;
  if (dir < 0) {
    dir += 360;
  }
  return { speedKmh: speedMs * 3.6, directionDeg: dir };
}