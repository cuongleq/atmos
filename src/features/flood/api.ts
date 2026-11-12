import { api, pLimit } from '../../api/index.js';
import { 
  FloodForecastConfig, 
  DEFAULT_FLOOD_CONFIG,
  floodLevels,
  ratingFor,
} from '../flood/index.js';
import { distanceKm, finite } from '../../engine/distance.js';

let riversToken = 0;

/** Load flood data for a location */
export async function loadFloodData(place: { lat: number; lon: number; name: string }, config: FloodForecastConfig = DEFAULT_FLOOD_CONFIG): Promise<any[]> {
  const _token = ++riversToken;
  
  try {
    const cells = await scanRiverCells(place);
    if (!cells.length) return [];
    
    const series = await pLimit(cells, config.seriesConcurrency, entry => fetchRiverSeries(entry, config));
    const merged = mergeDuplicateRivers(series.filter(Boolean).sort((a, b) => a.km - b.km));
    
    // Find largest river
    let biggest: { v: number; km: number } | null = null;
    for (const r of merged) {
      const v = r.qMedianToday;
      if (finite(v) && (!biggest || v > biggest.v)) biggest = { v, km: r.km };
    }
    
    const rivers = merged.map(r => {
      let levels = null;
      if (finite(r.qMedianToday)) {
        levels = floodLevels({
          history: r.history,
          qNow: r.qMedianToday,
          qForecast: r.forecast.slice(1),
          rating: ratingFor(r.qMedianToday),
        });
      }
      return {
        ...r,
        isLargest: !!biggest && Math.abs(r.km - biggest.km) < 0.05,
        levels,
      };
    });
    
    return rivers;
    
  } catch (err) {
    console.error('Flood data load failed:', err);
    return [];
  }
}

/** Scan river cells in radius */
async function scanRiverCells(place: { lat: number; lon: number }): Promise<any[]> {
  const offs: number[] = [];
  for (let k = -2; k <= 2; k++) offs.push(k * DEFAULT_FLOOD_CONFIG.cellStepKm);
  
  const jobs: any[] = [];
  for (const dy of offs) for (const dx of offs) jobs.push({ lat: place.lat + dy, lon: place.lon + dx });
  
  const seen = await pLimit(jobs, 6, async (p) => {
    const u = new URLSearchParams({
      latitude: p.lat.toFixed(4),
      longitude: p.lon.toFixed(4),
      daily: 'river_discharge',
      forecast_days: 1,
    });
    const data = await api('https://flood-api.open-meteo.com/v1/flood', u);
    const q = data.daily?.river_discharge || [];
    if (!q.some((v: number) => finite(v) && v > 0)) return null;
    return { lat: data.latitude, lon: data.longitude };
  });
  
  const byCell = new Map<string, any>();
  const floodCellKey = (c: any) => c.lat.toFixed(3) + ',' + c.lon.toFixed(3);
  
  for (const c of seen) {
    if (!c) continue;
    const km = distanceKm({ lat: 0, lon: 0 }, c);
    if (km > DEFAULT_FLOOD_CONFIG.radiusKm) continue;
    byCell.set(floodCellKey(c), { cell: c, km: Math.round(km * 10) / 10 });
  }
  
  return [...byCell.values()].sort((a, b) => a.km - b.km);
}

/** Fetch detailed river series */
async function fetchRiverSeries(entry: any, config: FloodForecastConfig): Promise<any | null> {
  const u = new URLSearchParams({
    latitude: entry.cell.lat.toFixed(4),
    longitude: entry.cell.lon.toFixed(4),
    daily: 'river_discharge,river_discharge_median,river_discharge_p25,river_discharge_p75',
    past_days: 365,
    forecast_days: 7,
  });
  
  try {
    const data = await api('https://flood-api.open-meteo.com/v1/flood', u);
    const time = data.daily.time || [];
    const q = data.daily.river_discharge || [];
    const median = data.daily.river_discharge_median || [];
    const p25 = data.daily.river_discharge_p25 || [];
    const p75 = data.daily.river_discharge_p75 || [];
    const today = todayISO();
    
    let iToday = time.lastIndexOf(today);
    if (iToday < 0) iToday = time.findIndex((t: string) => t >= today);
    if (iToday < 0 || iToday >= time.length || !finite(q[iToday])) return null;
    
    return {
      ...entry,
      time, q, median, p25, p75, iToday,
      qToday: q[iToday],
      qMedianToday: finite(median[iToday]) ? median[iToday] : q[iToday],
      p25Today: p25[iToday], p75Today: p75[iToday],
      history: q.slice(0, iToday).filter(finite),
      forecast: q.slice(iToday).filter(finite),
    };
  } catch {
    return null;
  }
}

/** Merge duplicate rivers from adjacent cells */
function mergeDuplicateRivers(list: any[]): any[] {
  const out: any[] = [];
  for (const r of list) {
    const prev = out.find(o => sameRiver(o, r));
    if (!prev) { out.push({ ...r, mergedCells: 1 }); continue; }
    prev.mergedCells = (prev.mergedCells || 1) + 1;
    prev.mergedKm = [...(prev.mergedKm || []), r.km];
  }
  return out;
}

function sameRiver(a: any, b: any): boolean {
  if (Math.abs(a.km - b.km) > 12) return false;
  const n = Math.min(a.history.length, b.history.length);
  if (n < 30) return false;
  const A = a.history.slice(-n), B = b.history.slice(-n);
  let same = 0, seen = 0;
  for (let i = 0; i < n; i++) {
    if (!finite(A[i]) || !finite(B[i])) continue;
    seen++;
    const tol = Math.max(0.05, 0.05 * Math.abs(A[i]));
    if (Math.abs(A[i] - B[i]) <= tol) same++;
  }
  return seen >= 30 && same / seen > 0.7;
}

function ratingFor(q: number | null): { a: number; b: number; q0: number } {
  if (!finite(q)) return { a: 1.5, b: 0.3, q0: 100 };
  if (q < 100) return { a: 1.2, b: 0.25, q0: 50 };
  if (q < 500) return { a: 1.5, b: 0.3, q0: 100 };
  if (q < 2000) return { a: 1.8, b: 0.35, q0: 200 };
  return { a: 2.0, b: 0.4, q0: 500 };
}

/** Load river gauges from OSM (placeholder) */
export async function loadRiverGauges(bbox: { north: number; south: number; east: number; west: number }): Promise<any[]> {
  return [];
}

/** Get current date ISO string */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}