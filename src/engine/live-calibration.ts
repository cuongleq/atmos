/**
 * Live calibration application functions.
 * These apply shipped calibrations to live forecasts in the browser.
 */

import { finite, round, meanS, quantile, sdS } from './numeric.js';
import { TransformKind, FORWARD, INVERSE, pseudoMembers, K_MEMBERS } from './transforms.js';
import { VariableSpec, VARIABLES } from './variables.js';
import { CalibrationBundle, predictFromCalibration } from './calibration.js';
import { hourOf, dayOfYear } from './predictors.js';
import { toSpeed, toDir } from './wind.js';
import { regimeKey, conditionOf } from './regime.js';

/**
 * Applies a stored calibration to a live forecast. `series` maps system id to
 * arrays aligned on `times`; `cross` supplies cross-variable columns.
 * Returns point value, calibrated spread and exceedance probabilities.
 */
export function calibrate(opts: {
  times: string[];
  variable: string;
  series: Record<string, Array<number | null>>;
  calib: CalibrationBundle;
  utcOffset?: number;
  cross?: Record<string, Array<number | null>>;
}): Array<any> {
  const { times, variable, series, calib, utcOffset = 0, cross } = opts;
  const vspec = VARIABLES[variable];
  if (!vspec || !calib) return null;
  const forward = FORWARD[vspec.kind], inverse = INVERSE[vspec.kind];
  const ids = calib.modelIds || Object.keys(series);
  const vals = ids.map(id => (series[id] || []).map(v => (finite(v) ? forward(v) : null)));
  const crossCols = (calib.crossVars || []).map(v => {
    const src = (cross && cross[v]) || [];
    return src.map(x => (finite(x) ? forward(x) : null));
  });
  const lo = vspec.kind === 'logit' ? 0 : (vspec.kind === 'log1p' ? 0 : null);
  const hi = vspec.kind === 'logit' ? 100 : null;
  const out = new Array(times.length);
  for (let i = 0; i < times.length; i++) {
    let s = 0, s2 = 0, c = 0;
    const byId = new Array(ids.length).fill(null);
    for (let j = 0; j < vals.length; j++) if (finite(vals[j][i])) { byId[j] = vals[j][i]; s += vals[j][i]!; s2 += vals[j][i]! ** 2; c++; }
    const need = Math.max(2, Math.ceil(ids.length * 0.6));
    if (c < need) { out[i] = null; continue; }
    const mean = s / c;
    const spread = c > 1 ? Math.sqrt(Math.max(0, s2 / c - mean * mean)) : 0;
    const mu = predictFromCalibration(calib, { mean, byId }, spread, hourOf(times, i, utcOffset), dayOfYear(times, i), crossCols.map(col => col[i]));
    if (!finite(mu)) { out[i] = null; continue; }
    const sd = Math.sqrt(Math.max(calib.sigma2.alpha + calib.sigma2.beta * spread * spread, 0));
    const mem = pseudoMembers({ kind: vspec.kind, mu, sd, lo, hi, template: calib.sigma2.template, mult: calib.sigma2.mult });
    const rec = {
      mean: meanS(mem), median: quantile(mem, 0.5),
      p02: quantile(mem, 0.02), p10: quantile(mem, 0.1), p25: quantile(mem, 0.25),
      p75: quantile(mem, 0.75), p90: quantile(mem, 0.9), p98: quantile(mem, 0.98),
      low: mem[0], high: mem[K_MEMBERS - 1], sd, spread, nModels: c,
      sdPhysical: sdS(mem) ?? null,
    };
    if (vspec.thresholds) {
      rec.probs = {};
      for (const th of vspec.thresholds) rec.probs[th] = mem.filter(v => v <= th).length / mem.length;
    }
    out[i] = rec;
  }
  return out;
}

/**
 * Live wind direction, from the shipped u/v calibration bundles.
 */
export function calibrateDirection(opts: {
  times: string[];
  seriesU: Record<string, Array<number | null>>;
  seriesV: Record<string, Array<number | null>>;
  calibration: { u: CalibrationBundle; v: CalibrationBundle };
  utcOffset?: number;
}): Array<any> {
  const { times, seriesU, seriesV, calibration, utcOffset = 0 } = opts;
  if (!calibration?.u || !calibration?.v) return null;
  if (calibration.u.family === 'mean' && calibration.v.family === 'mean') {
    // handled below via the mu === mean branch; no beta required
  }
  const ids = calibration.u.modelIds || Object.keys(seriesU);
  const applyComponent = (which: 'u' | 'v') => {
    const c = calibration[which];
    const src = which === 'u' ? seriesU : seriesV;
    const out = new Array(times.length).fill(null);
    const cols = ids.map(id => src[id] || []);
    const need = Math.max(2, Math.ceil(ids.length * 0.6));
    for (let i = 0; i < times.length; i++) {
      let s = 0, s2 = 0, n = 0;
      for (const col of cols) if (finite(col[i])) { s += col[i]!; s2 += col[i]! ** 2; n++; }
      if (n < need) continue;
      const mean = s / n;
      const spread = Math.sqrt(Math.max(0, s2 / n - mean * mean));
      let mu;
      if (c.family === 'mean' || !c.beta) {
        mu = mean;
      } else {
        const row = [mean, spread];
        for (const col of cols) row.push(finite(col[i]) ? col[i]! : mean);
        for (let j = 0; j < (c.crossVars || []).length; j++) row.push(finite(c.crossMean?.[j]) ? c.crossMean[j]! : 0);
        row.push(Math.sin(2 * Math.PI * hourOf(times, i, utcOffset) / 24));
        row.push(Math.cos(2 * Math.PI * hourOf(times, i, utcOffset) / 24));
        row.push(Math.sin(2 * Math.PI * dayOfYear(times, i) / 365.25));
        row.push(Math.cos(2 * Math.PI * dayOfYear(times, i) / 365.25));
        mu = c.intercept!;
        const SDC = c.scale || c.beta!.map(() => 1);
        for (let j = 0; j < c.beta!.length; j++) mu += c.beta![j] * ((row[j] - c.centre![j]) / SDC[j]);
      }
      if (finite(mu)) out[i] = { mu, nModels: n };
    }
    return out;
  };
  const cu = applyComponent('u'), cv = applyComponent('v');
  const out = new Array(times.length).fill(null);
  for (let i = 0; i < times.length; i++) {
    if (!cu[i] || !cv[i]) continue;
    out[i] = {
      mean: toSpeed(cu[i].mu, cv[i].mu), median: toSpeed(cu[i].mu, cv[i].mu),
      dir: toDir(cu[i].mu, cv[i].mu), nModels: cu[i].nModels,
    };
  }
  return out;
}

/**
 * Live WMO code, by applying the shipped regime lookup.
 */
export function calibrateCode(opts: {
  times: string[];
  series: Record<string, Record<string, Array<number | null>>>;
  regime: {
    fields: string[];
    modelIds?: string[];
    edges: number[][];
    minSupport: number;
    cells: Array<{ key: string; code: number; support: number; purity: number }>;
  };
}): Array<any> {
  const { times, series, regime } = opts;
  if (!regime?.cells?.length) return null;
  const ids = (regime.modelIds || Object.keys(series)).filter(id => series[id]);
  const fields = regime.fields || [
    'cloud_cover', 'precipitation', 'wind_speed_10m', 'apparent_temperature', 'relative_humidity_2m',
  ];
  const lookup = new Map(regime.cells.map(c => [c.key, c.code]));
  const need = 1;
  const out = new Array(times.length).fill(null);
  for (let i = 0; i < times.length; i++) {
    const row: number[] = [];
    let n = 0;
    for (const f of fields) {
      let s = 0, c = 0;
      for (const id of ids) {
        const val = series[id]?.[f]?.[i];
        if (finite(val)) { s += val; c++; }
      }
      if (c < need) { row.length = 0; break; }
      row.push(s / c);
      n = c;
    }
    if (row.length !== fields.length) continue;
    const key = regimeKey(row, regime.edges);
    if (key === null) continue;
    const code = lookup.get(key);
    if (code === undefined) continue;
    out[i] = { code, nModels: n, condition: conditionOf(code) };
  }
  return out;
}