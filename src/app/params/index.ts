/**
 * ATMOS App - Parameter Grid
 * Renders 64 variables in a compact grid
 */

import { selectors } from '../state/index.js';
import { calibrationFor, computePooledForecast, majorityWeatherCode } from '../calibration/index.js';
import { 
  $, 
  fmt, 
  pct, 
  finite, 
  getDigits, 
  getUnit, 
  getRange,
  weatherFamily,
  esc 
} from '../helpers/index.js';
import { LIVE_VARS } from '../constants/index.js';

// Get E from global namespace (set by engine bundle)
const E = (window as any).AtmosEngine;

/** Render parameter grid */
export function renderParams(): void {
  const live = selectors.currentLive();
  const report = selectors.currentReport();
  const place = selectors.currentPlace();
  
  const container = document.getElementById('paramGrid');
  if (!container || !live || !report) return;
  
  const { base, byId } = live;
  const times = activeTimes(base);
  
  // Variable groups for organization
  const groups = {
    'Nhiệt độ': ['temperature_2m', 'apparent_temperature', 'dew_point_2m'],
    'Độ ẩm & Mưa': ['relative_humidity_2m', 'precipitation', 'rain', 'snowfall'],
    'Áp suất': ['surface_pressure', 'pressure_msl'],
    'Gió': ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'],
    'Mây & Bức xạ': ['cloud_cover', 'shortwave_radiation', 'et0_fao_evapotranspiration'],
    'Thời tiết': ['weather_code'],
  };
  
  let html = '';
  
  for (const [groupName, variables] of Object.entries(groups)) {
    const validVars = variables.filter(v => report.variables[v]);
    if (!validVars.length) continue;
    
    html += '<div class="param-group"><h4>' + groupName + '</h4><div class="param-grid-inner">';
    
    for (const variable of validVars) {
      const vSpec = report.variables[variable];
      const calib = calibrationFor(report, place, variable, 1);
      
      // Get current value (first forecast hour)
      let currentVal: any = null;
      if (calib.calib) {
        // Would use calibrated value
        currentVal = getCurrentCalibrated(base, byId, variable, times, calib, report);
      } else {
        currentVal = getCurrentPooled(base, byId, variable, times, report);
      }
      
      const valStr = currentVal && finite(currentVal.mean) ? fmt(currentVal.mean, getDigits(report, variable)) : '\u2014';
      const unit = getUnit(report, variable);
      const p10 = currentVal && finite(currentVal.p10) ? fmt(currentVal.p10, getDigits(report, variable)) : '\u2014';
      const p90 = currentVal && finite(currentVal.p90) ? fmt(currentVal.p90, getDigits(report, variable)) : '\u2014';
      
      const isPooled = calib.pooled;
      const source = calib.source;
      
      html += 
        '<div class="param-card' + (isPooled ? ' pooled' : '') + '" title="' + esc(source) + (calib.note ? ': ' + calib.note : '') + '">' +
        '<div class="param-name">' + esc(vSpec.short || vSpec.label) + '</div>' +
        '<div class="param-value">' + valStr + ' <span class="param-unit">' + esc(unit) + '</span></div>' +
        '<div class="param-range">' + p10 + ' \u2013 ' + p90 + '</div>' +
        (isPooled ? '<span class="pooled-badge">Gộp</span>' : '') +
        '</div>';
    }
    
    html += '</div></div>';
  }
  
  container.innerHTML = html;
}

/** Get current calibrated value for a variable */
function getCurrentCalibrated(
  base: any, 
  byId: Record<string, any>, 
  variable: string, 
  times: string[],
  calib: any,
  report: any
): any {
  if (!calib.calib) return null;
  
  // For now, return pooled as calibration application is complex
  return getCurrentPooled(base, byId, variable, times, report);
}

/** Get current pooled (multi-model mean) value */
function getCurrentPooled(
  base: any,
  byId: Record<string, any>,
  variable: string,
  times: string[],
  report: any
): any {
  const kind = report.variables[variable]?.kind;
  if (!kind || !['gauss', 'log1p', 'logit'].includes(kind)) return null;
  
  const forward = E.FORWARD[kind];
  const inverse = E.INVERSE[kind];
  const [lo, hi] = getRange(report, variable);
  
  const cols: (number | null)[][] = [];
  for (const modelData of Object.values(byId)) {
    const hourly = modelData?.hourly;
    if (!hourly) continue;
    
    const col = hourly[variable];
    if (!col) continue;
    
    const map = new Map(hourly.time.map((t: string, i: number) => [t, col[i] ?? null]));
    const aligned = times.map(t => map.get(t) ?? null);
    
    if (aligned.some(finite)) {
      cols.push(aligned.map(v => finite(v) ? forward(v!) : null));
    }
  }
  
  if (cols.length < 2) return null;
  
  // First time step
  let s = 0, s2 = 0, c = 0;
  for (const col of cols) if (finite(col[0])) { s += col[0]!; s2 += col[0]! ** 2; c++; }
  if (c < 2) return null;
  
  const mean = s / c;
  const spread = Math.sqrt(Math.max(0, s2 / c - mean * mean));
  const mem = E.pseudoMembers(kind, mean, Math.max(spread, 0.3), lo, hi);
  
  return {
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

/** Get active forecast times */
function activeTimes(base: any): string[] {
  const h = base.hourly;
  const now = base.current?.time || h.time[0];
  const key = now.slice(0, 13) + ':00';
  let idx = h.time.findIndex((t: string) => t >= key);
  if (idx < 0) idx = 0;
  return h.time.slice(idx, idx + 48); // Next 48 hours for params
}