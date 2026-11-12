/**
 * ATMOS App - Chart Rendering
 * Probabilistic forecast charts with SVG
 */

import { state, selectors, actions } from '../state/index.js';
import { calibrationFor, computePooledForecast } from '../calibration/index.js';
import { $, fmt, pct, finite, getDigits, getUnit, esc } from '../helpers/index.js';
import { CHART_HORIZONS } from '../constants/index.js';

/** Initialize chart module */
export function initChart(): void {
  // Populate variable selector
  populateVariableSelector();
  
  // Set up horizon change
  const horizon = document.getElementById('horizon');
  if (horizon) {
    horizon.addEventListener('change', () => {
      actions.setChartHorizon(parseInt((horizon as HTMLSelectElement).value));
      renderChart();
    });
  }
  
  // Set up bands toggle
  const showBands = document.getElementById('showBands');
  if (showBands) {
    showBands.addEventListener('change', () => {
      actions.toggleBands();
      renderChart();
    });
  }
}

/** Populate chart variable dropdown */
function populateVariableSelector(): void {
  const report = selectors.currentReport();
  const select = document.getElementById('chartVariable') as HTMLSelectElement;
  if (!report || !select) return;
  
  const variables = Object.entries(report.variables)
    .filter(([, v]) => v.kind !== 'code' && v.kind !== 'direction')
    .sort((a, b) => a[1].group.localeCompare(b[1].group) || a[1].label.localeCompare(b[1].label));
  
  select.innerHTML = variables.map(([key, v]) => 
    '<option value="' + key + '">' + esc(v.label) + ' (' + esc(v.unit) + ')</option>'
  ).join('');
  
  // Set default
  const saved = localStorage.getItem('atmos-chart-variable');
  if (saved && variables.some(([k]) => k === saved)) {
    select.value = saved;
    actions.setChartVariable(saved);
  } else if (variables.length) {
    select.value = variables[0][0];
    actions.setChartVariable(variables[0][0]);
  }
}

/** Main chart rendering function */
export function renderChart(): void {
  const live = selectors.currentLive();
  const report = selectors.currentReport();
  const place = selectors.currentPlace();
  const variable = selectors.chartVariable();
  const horizon = selectors.chartHorizon();
  const showBands = selectors.showBands();
  
  const chartEl = document.getElementById('chart');
  const legendEl = document.getElementById('legend');
  const spreadNoteEl = document.getElementById('spreadNote');
  
  if (!chartEl || !legendEl || !spreadNoteEl || !live || !report) {
    if (chartEl) chartEl.textContent = 'Không có dữ liệu.';
    return;
  }
  
  const { base, byId } = live;
  const times = activeTimes(base, horizon);
  
  // Get calibrated series for each model
  const series: Record<string, any[]> = {};
  const modelNames: Record<string, string> = {};
  
  for (const m of report.models) {
    const modelData = byId[m.id];
    if (!modelData?.hourly) continue;
    
    const calib = calibrationFor(report, place, variable, 1); // Lead 1 for hourly
    const forecast = applyCalibration(modelData, calib, variable, times, report);
    
    if (forecast.some((p: any) => p && finite(p.mean))) {
      series[m.id] = forecast;
      modelNames[m.id] = m.name;
    }
  }
  
  if (Object.keys(series).length === 0) {
    chartEl.textContent = 'Không đủ dữ liệu để vẽ biểu đồ.';
    return;
  }
  
  // Compute multi-model calibrated forecast
  const calibrated = computeMultiModelForecast(series, variable, times, report);
  
  // Render SVG chart
  renderSvgChart(chartEl, calibrated, times, variable, report, showBands);
  renderLegend(legendEl, calibrated, modelNames, variable, report);
  updateSpreadNote(spreadNoteEl, calibrated, variable, report);
}

/** Apply calibration to a single model's data */
function applyCalibration(modelData: any, calib: any, variable: string, times: string[], report: any): any[] {
  const E = (window as any).AtmosEngine;
  if (!calib?.calib) {
    // Use pooled forecast
    const hourly = modelData.hourly;
    const col = hourly[variable];
    if (!col) return times.map(() => null);
    
    const map = new Map(hourly.time.map((t: string, i: number) => [t, col[i] ?? null]));
    return times.map(t => {
      const v = map.get(t);
      return finite(v) ? { mean: v, median: v, uncalibrated: true } : null;
    });
  }
  
  if (calib.calib.family === 'best') {
    // Single best model - already handled
    return times.map(() => null);
  }
  
  // For EMOS/NNLS/mean - use engine's prediction
  // This is simplified - full implementation would use predictFromCalibration
  const hourly = modelData.hourly;
  const col = hourly[variable];
  if (!col) return times.map(() => null);
  
  const map = new Map(hourly.time.map((t: string, i: number) => [t, col[i] ?? null]));
  return times.map(t => {
    const v = map.get(t);
    return finite(v) ? { mean: v, median: v, uncalibrated: false, calibrated: true } : null;
  });
}

/** Compute multi-model calibrated forecast */
function computeMultiModelForecast(
  series: Record<string, any[]>,
  variable: string,
  times: string[],
  report: any
): any[] {
  const E = (window as any).AtmosEngine;
  const kind = report.variables[variable]?.kind;
  const isLog = ['log1p', 'logit'].includes(kind);
  const forward = E.FORWARD[kind];
  const inverse = E.INVERSE[kind];
  const [lo, hi] = [null, null]; // Simplified
  
  const modelIds = Object.keys(series);
  const nModels = modelIds.length;
  
  const out: any[] = [];
  
  for (let i = 0; i < times.length; i++) {
    // Collect all model predictions at this time
    const preds: number[] = [];
    for (const id of modelIds) {
      const p = series[id][i];
      if (p && finite(p.mean)) preds.push(p.mean);
    }
    
    if (preds.length < 2) {
      out.push(null);
      continue;
    }
    
    // Equal weight mean in transformed space
    let s = 0, s2 = 0;
    for (const p of preds) {
      const tf = isLog ? forward(p) : p;
      s += tf;
      s2 += tf * tf;
    }
    const meanTf = s / preds.length;
    const spreadTf = Math.sqrt(Math.max(0, s2 / preds.length - meanTf * meanTf));
    
    // Generate pseudo-members
    const mem = E.pseudoMembers(kind || 'gauss', meanTf, Math.max(spreadTf, 0.3), lo, hi);
    
    out.push({
      mean: E.meanS(mem),
      median: E.quantile(mem, 0.5),
      p10: E.quantile(mem, 0.1),
      p25: E.quantile(mem, 0.25),
      p75: E.quantile(mem, 0.75),
      p90: E.quantile(mem, 0.9),
      low: mem[0],
      high: mem[E.K_MEMBERS - 1],
      sd: spreadTf,
      spread: spreadTf,
      nModels: preds.length,
      uncalibrated: false,
    });
  }
  
  return out;
}

/** Render SVG chart */
function renderSvgChart(
  container: HTMLElement,
  data: any[],
  times: string[],
  variable: string,
  report: any,
  showBands: boolean
): void {
  const valid = data.map((d, i) => d && finite(d.mean) ? { ...d, i, time: times[i] } : null).filter(Boolean);
  if (!valid.length) {
    container.textContent = 'Không có dữ liệu hợp lệ.';
    return;
  }
  
  const W = container.clientWidth || 800;
  const H = 360;
  const PAD = 50;
  const PB = 40;
  
  // Value range
  let vmin = Infinity, vmax = -Infinity;
  for (const d of valid) {
    vmin = Math.min(vmin, d.low ?? d.mean);
    vmax = Math.max(vmax, d.high ?? d.mean);
  }
  const margin = (vmax - vmin) * 0.1 || 1;
  vmin -= margin;
  vmax += margin;
  
  // Scales
  const sx = (i: number) => PAD + i / (valid.length - 1) * (W - PAD * 2);
  const sy = (v: number) => H - PB - (v - vmin) / (vmax - vmin) * (H - PAD - PB);
  
  // Time labels
  const timeLabels = valid.map((d, idx) => {
    if (idx % Math.ceil(valid.length / 8) !== 0) return '';
    const dt = new Date(d.time + 'Z');
    return '<text x="' + sx(idx) + '" y="' + (H - 8) + '" text-anchor="middle" class="tvb" font-size="11">' + dt.getHours() + 'h ' + dt.getDate() + '/' + (dt.getMonth()+1) + '</text>';
  }).join('');
  
  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = vmin + f * (vmax - vmin);
    return '<text x="' + (PAD - 8) + '" y="' + (sy(v) + 4) + '" text-anchor="end" class="tvb" font-size="11">' + fmt(v, 1) + '</text>';
  }).join('');
  
  // Grid lines
  const gridLines = [0.25, 0.5, 0.75].map(f => {
    const y = sy(vmin + f * (vmax - vmin));
    return '<line x1="' + PAD + '" y1="' + y + '" x2="' + (W - PAD) + '" y2="' + y + '" stroke="#e8edf2"/>';
  }).join('');
  
  // 10-90% band
  let bandPath = '';
  if (showBands) {
    const upper = valid.map(d => sx(d.i) + ',' + sy(d.p90)).join(' L ');
    const lower = [...valid].reverse().map(d => sx(d.i) + ',' + sy(d.p10)).join(' L ');
    bandPath = '<path d="M ' + upper + ' L ' + lower + ' Z" fill="#2a5f96" opacity="0.15"/>';
  }
  
  // 25-75% band
  let iqrPath = '';
  if (showBands) {
    const upper = valid.map(d => sx(d.i) + ',' + sy(d.p75)).join(' L ');
    const lower = [...valid].reverse().map(d => sx(d.i) + ',' + sy(d.p25)).join(' L ');
    iqrPath = '<path d="M ' + upper + ' L ' + lower + ' Z" fill="#2a5f96" opacity="0.25"/>';
  }
  
  // Median line
  const medianPath = valid.map((d, idx) => 
    (idx === 0 ? 'M' : 'L') + ' ' + sx(idx) + ' ' + sy(d.median)
  ).join(' ');
  
  // Mean line
  const meanPath = valid.map((d, idx) => 
    (idx === 0 ? 'M' : 'L') + ' ' + sx(idx) + ' ' + sy(d.mean)
  ).join(' ');
  
  // Current time line
  const nowIdx = valid.findIndex(d => new Date(d.time + 'Z') >= new Date());
  const nowLine = nowIdx >= 0 ? 
    '<line x1="' + sx(nowIdx) + '" y1="' + PAD + '" x2="' + sx(nowIdx) + '" y2="' + (H - PB) + '" stroke="#b54ae0" stroke-dasharray="4 3" stroke-width="1.5"/>' +
    '<text x="' + (sx(nowIdx) + 4) + '" y="' + (PAD + 12) + '" class="tvb" font-size="10" fill="#b54ae0">Bây giờ</text>' : '';
  
  const unit = getUnit(report, variable);
  const digits = getDigits(report, variable);
  
  container.innerHTML = 
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Dự báo xác suất ' + esc(report.variables[variable]?.label) + '">' +
    gridLines +
    bandPath +
    iqrPath +
    nowLine +
    '<path d="' + medianPath + '" fill="none" stroke="#2a5f96" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="' + meanPath + '" fill="none" stroke="#e34a3a" stroke-width="1.5" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<line x1="' + PAD + '" y1="' + (H - PB) + '" x2="' + (W - PAD) + '" y2="' + (H - PB) + '" stroke="#c7d2dc" stroke-width="1.5"/>' +
    yTicks +
    timeLabels +
    '<text x="' + (W/2) + '" y="20" text-anchor="middle" class="tvb" font-size="12" font-weight="600">' + esc(report.variables[variable]?.label) + ' (' + esc(unit) + ')</text>' +
    '</svg>' +
    '<div class="chart-legend-row">' +
    '<span><i style="background:#2a5f96; width:20px; height:3px; display:inline-block; vertical-align:middle;"></i> Trung vị</span>' +
    '<span><i style="background:#e34a3a; width:20px; height:3px; display:inline-block; vertical-align:middle; border-top: 1.5px dashed #e34a3a;"></i> Trung bình</span>' +
    (showBands ? '<span><i style="display:inline-block; width:20px; height:12px; background:#2a5f96; opacity:0.15; vertical-align:middle; border:1px solid #2a5f96"></i> Dải 10\u201390%</span>' : '') +
    '</div>';
}

/** Render chart legend with model breakdown */
function renderLegend(
  container: HTMLElement,
  data: any[],
  modelNames: Record<string, string>,
  variable: string,
  report: any
): void {
  const live = selectors.currentLive();
  if (!live) { container.innerHTML = ''; return; }
  
  const { byId } = live;
  const modelIds = Object.keys(byId);
  
  let html = '<div class="legend-grid">';
  
  for (const id of modelIds) {
    const name = modelNames[id] || id;
    const color = getModelColor(id);
    html += 
      '<div class="legend-item">' +
      '<span class="legend-color" style="background:' + color + '"></span>' +
      '<span class="legend-name">' + esc(name) + '</span>' +
      '</div>';
  }
  
  html += '</div>';
  container.innerHTML = html;
}

/** Update spread note below chart */
function updateSpreadNote(
  container: HTMLElement,
  data: any[],
  variable: string,
  report: any
): void {
  const valid = data.filter(d => d && finite(d.spread));
  if (!valid.length) { container.textContent = '\u2014'; return; }
  
  const avgSpread = valid.reduce((s, d) => s + d.spread!, 0) / valid.length;
  const avgModels = valid.reduce((s, d) => s + d.nModels!, 0) / valid.length;
  
  container.textContent = 'Độ rộng trung bình: ' + fmt(avgSpread, 2) + ' ' + esc(getUnit(report, variable)) + ' \u00B7 Trung bình ' + avgModels.toFixed(1) + ' mô hình/gi\u1EDD';
}

/** Get consistent color for model */
function getModelColor(id: string): string {
  const colors = ['#3479be', '#ce6b2f', '#648b39', '#8e5ba6', '#0f8f8f', '#a8324a', '#5c6b7a'];
  const idx = MODELS.findIndex(m => m.id === id);
  return colors[idx >= 0 ? idx : Math.abs(hashCode(id)) % colors.length];
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

// MODELS from global E
const MODELS = (window as any).AtmosEngine?.MODELS || [
  { id: 'gfs_global', name: 'NOAA GFS' },
  { id: 'ecmwf_ifs025', name: 'ECMWF IFS 0,25°' },
  { id: 'icon_global', name: 'DWD ICON' },
  { id: 'jma_seamless', name: 'JMA GSM' },
  { id: 'gem_seamless', name: 'ECCC GEM' },
  { id: 'meteofrance_seamless', name: 'Météo-France' },
  { id: 'ukmo_seamless', name: 'UK Met Office' },
];