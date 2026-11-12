/**
 * ATMOS App - Calibration Lookup
 * Handles finding and applying calibration from benchmark report
 */

import { finite, getRange } from '../helpers/index.js';
import { BenchmarkReport, Place, CalibrationResult, LiveForecast } from '../types/app.js';

/** Get calibration for a variable at a lead time for the current place */
export function calibrationFor(
  report: BenchmarkReport,
  place: Place,
  variable: string,
  lead: number
): CalibrationResult {
  // Get E from global namespace
  const E = (window as any).AtmosEngine;
  
  // 1. Try location-specific calibration
  const loc = report.locations.find(l => l.id === place.id);
  const own = loc?.tests.find(t => t.usable && t.variable === variable && t.lead === lead);
  
  if (own?.calibration) {
    return {
      calib: own.calibration,
      source: loc.name,
      distanceKm: 0,
      pooled: false,
      note: null,
    };
  }

  // 2. Direction and code have special regime-based calibration
  const vSpec = report.variables[variable];
  if (own?.usable && (vSpec?.kind === 'direction' || vSpec?.kind === 'code')) {
    return {
      calib: { regime: own.regime } as any,
      source: loc?.name || 'unknown',
      distanceKm: 0,
      pooled: false,
      note: null,
    };
  }

  // 3. Try pooled calibration (6-location aggregate)
  const pooled = report.pooled?.[variable]?.[lead];
  if (pooled?.calibration) {
    // Find nearest calibrated location for distance info
    const distances = report.locations.map(l => ({
      l,
      km: E.distanceKm(place, l),
    })).sort((a, b) => a.km - b.km);
    
    const nearest = distances[0];
    const km = nearest?.km ?? null;
    
    return {
      calib: pooled.calibration,
      source: 'bản gộp 6 địa điểm',
      distanceKm: km,
      pooled: true,
      note: nearest
        ? 'Địa điểm gần nhất trong tập hiệu chỉnh: ' + nearest.l.name + ', cách ' + Math.round(nearest.km) + ' km.'
        : null,
    };
  }

  return {
    calib: null,
    source: '',
    distanceKm: null,
    pooled: false,
    note: 'Chưa có hiệu chỉnh cho biến này tại thời hạn này',
  };
}

/** Determine scalar transform kind for a variable */
export function scalarKind(report: BenchmarkReport, variable: string): string | null {
  const kind = report.variables[variable]?.kind;
  return ['gauss', 'log1p', 'logit'].includes(kind) ? kind : null;
}

/** Compute uncalibrated pooled forecast (equal-weight multi-model mean) */
export function computePooledForecast(
  live: LiveForecast,
  variable: string,
  times: string[],
  report: BenchmarkReport
): any[] {
  const E = (window as any).AtmosEngine;
  const kind = scalarKind(report, variable);
  if (!kind) return times.map(() => null);
  
  const forward = E.FORWARD[kind];
  const inverse = E.INVERSE[kind];
  const [lo, hi] = getRange(report, variable);
  
  // Collect model columns
  const cols: (number | null)[][] = [];
  for (const [, model] of Object.entries(live.byId)) {
    if (!model?.hourly) continue;
    const col = model.hourly[variable];
    if (!col) continue;
    
    // Align to times
    const map = new Map(model.hourly.time.map((t: string, i: number) => [t, col[i] ?? null]));
    const aligned = times.map(t => map.get(t) ?? null);
    
    if (aligned.some(finite)) {
      cols.push(aligned.map(v => finite(v) ? forward(v!) : null));
    }
  }
  
  if (cols.length < 2) return times.map(() => null);
  
  // Compute mean and spread per time step
  const out: any[] = new Array(times.length);
  for (let i = 0; i < times.length; i++) {
    let s = 0, s2 = 0, c = 0;
    for (const col of cols) if (finite(col[i])) { s += col[i]!; s2 += col[i]! ** 2; c++; }
    if (c < 2) { out[i] = null; continue; }
    
    const mean = s / c;
    const spread = Math.sqrt(Math.max(0, s2 / c - mean * mean));
    const mem = E.pseudoMembers(kind, mean, Math.max(spread, 0.3), lo, hi);
    
    out[i] = {
      mean: E.meanS(mem),
      median: E.quantile(mem, 0.5),
      p10: E.quantile(mem, 0.1),
      p25: E.quantile(mem, 0.25),
      p75: E.quantile(mem, 0.75),
      p90: E.quantile(mem, 0.9),
      low: mem[0],
      high: mem[E.K_MEMBERS - 1],
      sd: spread,
      spread,
      nModels: c,
      uncalibrated: true,
    };
  }
  
  return out;
}

/** Get majority weather code across models */
export function majorityWeatherCode(live: LiveForecast, times: string[]): any[] {
  const E = (window as any).AtmosEngine;
  const cols = Object.keys(live.byId).map(id => {
    const h = live.byId[id]?.hourly;
    if (!h?.weather_code) return times.map(() => null);
    const map = new Map(h.time.map((t: string, i: number) => [t, h.weather_code[i] ?? null]));
    return times.map(t => map.get(t) ?? null);
  });
  
  return times.map((_, i) => {
    const tally = new Map<number, number>();
    for (const col of cols) {
      const v = col[i];
      if (finite(v)) tally.set(Math.round(v!), (tally.get(Math.round(v!)) || 0) + 1);
    }
    if (!tally.size) return null;
    
    let best = null, bestN = -1;
    for (const [code, n] of tally) if (n > bestN) { bestN = n; best = code; }
    return { code: best, nModels: tally.size, uncalibrated: true };
  });
}

/** Apply calibration to live forecast for a variable/lead */
export function applyCalibration(
  live: LiveForecast,
  calib: any,
  variable: string,
  lead: number,
  times: string[],
  report: BenchmarkReport
): any[] {
  if (!calib) return computePooledForecast(live, variable, times, report);
  
  if (calib.family === 'best') {
    // Use single best model
    const modelId = calib.singleModel;
    const model = live.byId[modelId];
    if (!model?.hourly) return computePooledForecast(live, variable, times, report);
    
    const col = model.hourly[variable];
    if (!col) return computePooledForecast(live, variable, times, report);
    
    const map = new Map(model.hourly.time.map((t: string, i: number) => [t, col[i] ?? null]));
    return times.map(t => {
      const v = map.get(t);
      return finite(v) ? { mean: v, median: v, uncalibrated: false, source: modelId } : null;
    });
  }
  
  if (calib.family === 'mean') {
    return computePooledForecast(live, variable, times, report);
  }
  
  // EMOS/NNLS calibration - use engine's predictFromCalibration
  // This is simplified - full implementation would use predictFromCalibration
  return computePooledForecast(live, variable, times, report);
}