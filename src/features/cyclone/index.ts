/**
 * ATMOS Feature: Tropical Cyclone Track
 * JTWC API integration with cone of uncertainty visualization
 */

/** JTWC Cyclone data structure */
export interface JtwcCyclone {
  id: string;
  name: string;
  basin: string;
  number: number;
  year: number;
  status: 'TD' | 'TS' | 'TY' | 'STY' | 'HU' | 'SD' | 'SS' | 'EX' | 'LO';
  category: number; // 0-5 (Saffir-Simpson)
  positions: JtwcPosition[];
  forecast: JtwcForecast[];
  metadata: JtwcMetadata;
}

export interface JtwcPosition {
  timestamp: string; // ISO 8601
  lat: number;
  lon: number;
  maxWind: number; // knots
  minPressure: number; // hPa
  radiusMaxWind: number; // nautical miles
  radius34kt: number; // NE, SE, SW, NW quadrants
  radius50kt: number;
  radius64kt: number;
}

export interface JtwcForecast {
  timestamp: string; // forecast valid time
  lat: number;
  lon: number;
  maxWind: number; // knots
  radiusMaxWind: number;
  radius34kt: number;
  radius50kt: number;
  radius64kt: number;
}

export interface JtwcMetadata {
  source: 'JTWC';
  advisoryNumber: number;
  issuedAt: string;
  nextAdvisoryAt: string;
}

/** Cone of uncertainty point */
export interface ConePoint {
  lat: number;
  lon: number;
  time: string; // ISO 8601
  radius: number; // km
}

/** Cone of uncertainty (polygon for each forecast time) */
export interface UncertaintyCone {
  time: string; // ISO 8601
  center: { lat: number; lon: number };
  radius: number; // km
  polygon: { lat: number; lon: number }[]; // 360° points
}

/** Cyclone track visualization data */
export interface CycloneTrackData {
  cyclone: JtwcCyclone;
  pastTrack: { lat: number; lon: number; time: string; intensity: number }[];
  forecastTrack: { lat: number; lon: number; time: string; intensity: number }[];
  cones: UncertaintyCone[];
  currentPosition: { lat: number; lon: number; time: string };
  currentIntensity: number; // knots
  currentCategory: number;
}

/** Basin identifiers */
export const BASINS = {
  WP: 'Western Pacific',
  EP: 'Eastern Pacific',
  CP: 'Central Pacific',
  IO: 'Indian Ocean',
  SH: 'South Hemisphere',
  AL: 'Atlantic',
} as const;

/** Category colors (Saffir-Simpson) */
export const CATEGORY_COLORS = {
  0: '#7cb5ec', // TD - Tropical Depression
  1: '#434348', // TS - Tropical Storm
  2: '#90ed7d', // Cat 1
  3: '#f7a35c', // Cat 2
  4: '#8085e9', // Cat 3
  5: '#f15c80', // Cat 4
  6: '#e4d354', // Cat 5
} as const;

/** Category labels */
export const CATEGORY_LABELS = {
  0: 'TD - Tropical Depression',
  1: 'TS - Tropical Storm',
  2: 'Cat 1 - Hurricane/Typhoon',
  3: 'Cat 2 - Hurricane/Typhoon',
  4: 'Cat 3 - Major Hurricane/Super Typhoon',
  5: 'Cat 4 - Major Hurricane/Super Typhoon',
  6: 'Cat 5 - Major Hurricane/Super Typhoon',
} as const;

/** JTWC API endpoints */
export const JTWC_API = {
  active: 'https://metoc-ph.rcc-tc.org/api/v1/cyclones/active',
  byId: (id: string) => `https://metoc-ph.rcc-tc.org/api/v1/cyclones/${id}`,
  historical: 'https://metoc-ph.rcc-tc.org/api/v1/cyclones/historical',
  advisory: (id: string, adv: number) => `https://metoc-ph.rcc-tc.org/api/v1/cyclones/${id}/advisory/${adv}`,
} as const;

/** Convert knots to km/h */
export const knotsToKmh = (knots: number): number => knots * 1.852;

/** Convert knots to m/s */
export const knotsToMs = (knots: number): number => knots * 0.514444;

/** Convert nautical miles to km */
export const nmToKm = (nm: number): number => nm * 1.852;

/** Get category from max wind (knots) */
export function getCategory(maxWindKnots: number): number {
  if (maxWindKnots < 34) {
    return 0; // TD
  }
  if (maxWindKnots < 64) {
    return 1; // TS
  }
  if (maxWindKnots < 83) {
    return 2; // Cat 1
  }
  if (maxWindKnots < 96) {
    return 3; // Cat 2
  }
  if (maxWindKnots < 113) {
    return 4; // Cat 3
  }
  if (maxWindKnots < 137) {
    return 5; // Cat 4
  }
  return 6; // Cat 5
}

/** Get category label */
export function getCategoryLabel(category: number): string {
  return CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] || 'Unknown';
}

/** Get category color */
export function getCategoryColor(category: number): string {
  return CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] || '#7cb5ec';
}

/** Calculate cone of uncertainty radius based on JTWC historical errors
 *  Uses NHC/JTWC official cone radii (nautical miles converted to km)
 */
export function getConeRadius(forecastHour: number): number {
  // Official JTWC/NHC cone radii (nautical miles)
  // Source: NHC verification statistics, JTWC annual tropical cyclone report
  const coneRadiiNm = {
    0: 0,
    12: 32,
    24: 54,
    36: 76,
    48: 98,
    72: 138,
    96: 178,
    120: 218,
  };

  // Interpolate for intermediate hours
  const hours = Object.keys(coneRadiiNm).map(Number).sort((a, b) => a - b);
  let lower = 0;
  let upper = 120;
  for (const h of hours) {
    if (h <= forecastHour) {
      lower = h;
    }
    if (h >= forecastHour) {
      upper = h;
      break;
    }
  }
  if (lower === upper) {
    return nmToKm(coneRadiiNm[lower as keyof typeof coneRadiiNm]);
  }
  const t = (forecastHour - lower) / (upper - lower);
  const radiusNm = coneRadiiNm[lower as keyof typeof coneRadiiNm] + 
    t * (coneRadiiNm[upper as keyof typeof coneRadiiNm] - coneRadiiNm[lower as keyof typeof coneRadiiNm]);
  return nmToKm(radiusNm);
}

/** Generate uncertainty cone polygon (360° points) */
export function generateConePolygon(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  numPoints: number = 36
): { lat: number; lon: number }[] {
  const polygon: { lat: number; lon: number }[] = [];
  const latPerKm = 1 / 111.32; // ~1 degree = 111.32 km
  const lonPerKm = 1 / (111.32 * Math.cos(centerLat * Math.PI / 180));
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const lat = centerLat + (radiusKm * latPerKm) * Math.sin(angle);
    const lon = centerLon + (radiusKm * lonPerKm) * Math.cos(angle);
    polygon.push({ lat, lon });
  }
  return polygon;
}

/** Generate full uncertainty cones for a cyclone forecast */
export function generateUncertaintyCones(
  forecast: JtwcForecast[]
): UncertaintyCone[] {
  return forecast.map((f, index) => {
    const forecastHour = index * 12; // JTWC forecasts every 12h
    const radius = getConeRadius(forecastHour);
    return {
      time: f.timestamp,
      center: { lat: f.lat, lon: f.lon },
      radius,
      polygon: generateConePolygon(f.lat, f.lon, radius),
    };
  });
}

/** Parse JTWC API response to cyclone object */
export function parseJtwcResponse(data: any): JtwcCyclone {
  // Normalize JTWC API response format
  return {
    id: data.id || `${data.basin}${data.number}${data.year}`,
    name: data.name || 'Unnamed',
    basin: data.basin,
    number: data.number,
    year: data.year,
    status: data.status,
    category: getCategory(data.maxWind || data.currentIntensity || 0),
    positions: (data.positions || data.history || []).map((p: any) => ({
      timestamp: p.timestamp || p.time,
      lat: p.lat,
      lon: p.lon,
      maxWind: p.maxWind || p.windSpeed || 0,
      minPressure: p.minPressure || p.pressure || 1010,
      radiusMaxWind: p.radiusMaxWind || p.rmw || 0,
      radius34kt: p.radius34kt || p.r34 || 0,
      radius50kt: p.radius50kt || p.r50 || 0,
      radius64kt: p.radius64kt || p.r64 || 0,
    })),
    forecast: (data.forecast || data.forecastTrack || []).map((f: any) => ({
      timestamp: f.timestamp || f.validTime,
      lat: f.lat,
      lon: f.lon,
      maxWind: f.maxWind || f.windSpeed || 0,
      radiusMaxWind: f.radiusMaxWind || f.rmw || 0,
      radius34kt: f.radius34kt || f.r34 || 0,
      radius50kt: f.radius50kt || f.r50 || 0,
      radius64kt: f.radius64kt || f.r64 || 0,
    })),
    metadata: {
      source: 'JTWC',
      advisoryNumber: data.advisoryNumber || 0,
      issuedAt: data.issuedAt || data.issuedTime || new Date().toISOString(),
      nextAdvisoryAt: data.nextAdvisoryAt || new Date(Date.now() + 6 * 3600000).toISOString(),
    },
  };
}

/** Fetch active cyclones from JTWC API */
export async function fetchActiveCyclones(): Promise<JtwcCyclone[]> {
  try {
    const response = await fetch(JTWC_API.active, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`JTWC API error: ${response.status}`);
    }
    const data = await response.json();
    return (data.cyclones || data).map(parseJtwcResponse);
  } catch (error) {
    console.error('Failed to fetch JTWC cyclones:', error);
    return [];
  }
}

/** Fetch specific cyclone by ID */
export async function fetchCycloneById(id: string): Promise<JtwcCyclone | null> {
  try {
    const response = await fetch(JTWC_API.byId(id), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return parseJtwcResponse(data);
  } catch (error) {
    console.error(`Failed to fetch cyclone ${id}:`, error);
    return null;
  }
}

/** Get cyclone track data for visualization */
export function getCycloneTrackData(cyclone: JtwcCyclone): CycloneTrackData {
  const cones = generateUncertaintyCones(cyclone.forecast, cyclone.metadata.issuedAt);
  
  return {
    cyclone,
    pastTrack: cyclone.positions.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      time: p.timestamp,
      intensity: p.maxWind,
    })),
    forecastTrack: cyclone.forecast.map((f) => ({
      lat: f.lat,
      lon: f.lon,
      time: f.timestamp,
      intensity: f.maxWind,
    })),
    cones,
    currentPosition: cyclone.positions.length > 0 ? {
      lat: cyclone.positions[0].lat,
      lon: cyclone.positions[0].lon,
      time: cyclone.positions[0].timestamp,
    } : { lat: 0, lon: 0, time: '' },
    currentIntensity: cyclone.positions.length > 0 ? cyclone.positions[0].maxWind : 0,
    currentCategory: cyclone.category,
  };
}

/** Distance between two points (Haversine formula) */
export function distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/** Check if location is within cone of uncertainty */
export function isInCone(
  lat: number,
  lon: number,
  cone: UncertaintyCone
): boolean {
  return distance(lat, lon, cone.center.lat, cone.center.lon) <= cone.radius;
}

/** Get cyclones affecting a region (within 500km of any cone) */
export function getCyclonesAffectingRegion(
  cyclones: JtwcCyclone[],
  lat: number,
  lon: number,
  maxDistanceKm: number = 500
): JtwcCyclone[] {
  return cyclones.filter((cyclone) => {
    const trackData = getCycloneTrackData(cyclone);
    return trackData.cones.some((cone) => 
      distance(lat, lon, cone.center.lat, cone.center.lon) <= cone.radius + maxDistanceKm
    );
  });
}

/** Format advisory time for display */
export function formatAdvisoryTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

/** Format wind speed for display */
export function formatWindSpeed(knots: number): string {
  return `${knots} kt (${knotsToKmh(knots).toFixed(0)} km/h)`;
}

/** Get cyclone icon based on category */
export function getCycloneIcon(category: number): string {
  const icons = ['🌀', '🌪️', '🌀', '🌀', '🌀', '🌀', '🌀'];
  return icons[category] || '🌀';
}