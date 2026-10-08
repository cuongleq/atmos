/*
 * Fits every calibration and runs the frozen backtest, writing dist/benchmark.json.
 *
 * Protocol, fixed in config.mjs and not adjustable from here:
 *   fit window   2024-12-01 .. 2025-10-14
 *   purge        7 days with no data at all
 *   score window 2025-10-22 .. 2025-11-30
 * Cross-validation to pick a model family and a ridge penalty runs inside the
 * fit window only. The score window is read once, at the end, by evaluate().
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RAW, DIST, LOCATIONS, DET_MODELS, VARIABLES, LEADS, PERIOD, SPLIT,
} from './config.mjs';
import './dist/engine.js';

const E = globalThis.AtmosEngine;
const modelNames = Object.fromEntries(DET_MODELS.map(m => [m.id, m.name]));
const only = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? process.argv[i + 1] : null; })();
const errors = [];

/* ---------- loading ---------- */

async function loadLocation(loc) {
  const obs = JSON.parse(await fs.readFile(path.join(RAW, `${loc.id}-era5.json`), 'utf8'));
  const times = obs.hourly.time;
  const models = {};
  for (const m of DET_MODELS) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(RAW, `${loc.id}-${m.id}.json`), 'utf8'));
      if (j.hourly.time.length !== times.length) {
        errors.push(`${loc.id}/${m.id}: độ dài chuỗi lệch (${j.hourly.time.length} so với ${times.length})`);
        continue;
      }
      models[m.id] = j.hourly;
    } catch (e) {
      errors.push(`${loc.id}/${m.id}: không đọc được (${e.message})`);
    }
  }
  return { times, obs: obs.hourly, models, referenceGrid: { lat: obs.latitude, lon: obs.longitude } };
}

/* ---------- per-variable, per-lead assembly ---------- */

const D2R = Math.PI / 180;

/** Columns for one variable at one lead, shaped for the engine. */
function buildSeries(vs, variable, lead) {
  const suffix = `_previous_day${lead}`;
  const series = {};
  for (const [id, hourly] of Object.entries(vs.models)) {
    const col = hourly[variable + suffix];
    if (!col) continue;
    if (variable === 'wind_direction_10m') {
      const sp = hourly['wind_speed_10m' + suffix];
      if (!sp) continue;
      series[id] = {
        u: sp.map((s, i) => (finite(s) && finite(col[i]) ? s * Math.cos(col[i] * D2R) : null)),
        v: sp.map((s, i) => (finite(s) && finite(col[i]) ? s * Math.sin(col[i] * D2R) : null)),
      };
    } else {
      series[id] = col;
    }
  }
  return series;
}

const finite = E.finite;

/** Systems that are effectively complete over the fit window for this column. */
function usableModels(vs, series, variable, lead, times) {
  let window = 0;
  for (const t of times) if (t.slice(0, 10) <= SPLIT.trainEnd) window++;
  return Object.keys(series).filter(id => {
    const col = variable === 'wind_direction_10m' ? series[id].u : series[id];
    let ok = 0;
    for (let i = 0; i < times.length; i++) if (times[i].slice(0, 10) <= SPLIT.trainEnd && finite(col[i])) ok++;
    return window ? ok / window >= 0.97 : false;
  });
}

/** Multi-model mean of a cross-predictor variable, restricted to `ids`. */
function crossMean(vs, variable, lead, ids, times) {
  const suffix = `_previous_day${lead}`;
  const cols = ids.map(id => vs.models[id]?.[variable + suffix]).filter(Boolean);
  if (!cols.length) return null;
  return times.map((_, i) => {
    let s = 0, c = 0;
    for (const col of cols) if (finite(col[i])) { s += col[i]; c++; }
    return c >= Math.max(2, Math.ceil(cols.length * 0.6)) ? s / c : null;
  });
}

/** Continuous context fields for the weather-code regime classifier. */
function codeFeatures(vs, lead, ids, times) {
  const fields = ['cloud_cover', 'precipitation', 'wind_speed_10m', 'apparent_temperature', 'relative_humidity_2m'];
  return fields.map(v => crossMean(vs, v, lead, ids, times)).filter(Boolean);
}

function evaluateOne(vs, loc, variable, lead) {
  const { times, obs } = vs;
  const spec = E.VARIABLES[variable];
  const suffix = `_previous_day${lead}`;

  if (spec.kind === 'code') {
    const all = buildSeries(vs, variable, lead);
    const ids = usableModels(vs, all, variable, lead, times);
    const feats = codeFeatures(vs, lead, ids, times);
    return E.evaluate({
      times, obs: obs[variable], series: all, codeFeatures: feats,
      variable, lead, modelNames, utcOffset: loc.utcOffset, ...SPLIT,
    });
  }

  if (spec.kind === 'direction') {
    const all = buildSeries(vs, variable, lead);
    const ids = usableModels(vs, all, variable, lead, times);
    if (!ids.length) return null;
    const series = {};
    for (const id of ids) series[id] = all[id];
    const cross = {}, crossVars = [];
    for (const v of spec.cross || []) {
      const m = crossMean(vs, v, lead, ids, times);
      if (m) { cross[v] = m; crossVars.push(v); }
    }
    return E.evaluate({
      times, series, cross, crossVars,
      obsSpeed: obs['wind_speed_10m'], obsDirection: obs['wind_direction_10m'],
      variable, lead, modelNames, utcOffset: loc.utcOffset, ...SPLIT,
    });
  }

  const all = buildSeries(vs, variable, lead);
  const ids = usableModels(vs, all, variable, lead, times);
  if (!ids.length) return null;
  const series = {};
  for (const id of ids) series[id] = all[id];
  const cross = {}, crossVars = [];
  for (const v of spec.cross || []) {
    const m = crossMean(vs, v, lead, ids, times);
    if (m) { cross[v] = m; crossVars.push(v); }
  }
  return E.evaluate({
    times, obs: obs[variable], series, cross, crossVars,
    variable, lead, modelNames, utcOffset: loc.utcOffset, ...SPLIT,
  });
}

/* ---------- pooled fallback for locations outside Vietnam ---------- */

const POOL_STRIDE = 2;

/**
 * One calibration fitted on every city at once, so the app still has something
 * defensible to show for a searched location that has no local fit. Stride 2
 * keeps the pooled design matrix inside a sensible runtime.
 */
function pooledOne(loaded, variable, lead) {
  const times = [], obs = [];
  const series = {};
  let any = false;
  const nHours = loaded[0].times.length;
  for (let h = 0; h < nHours; h += POOL_STRIDE) {
    for (const vs of loaded) {
      const i = h;
      if (!finite(vs.obs[variable]?.[i])) continue;
      times.push(vs.times[i]);
      obs.push(vs.obs[variable][i]);
      any = true;
    }
  }
  if (!any) return null;
  const ids = [];
  for (const vs of loaded) {
    const all = buildSeries(vs, variable, lead);
    for (const id of usableModels(vs, all, variable, lead, vs.times)) if (!ids.includes(id)) ids.push(id);
  }
  // keep only systems present for every city, so a missing hour is a real gap
  const common = ids.filter(id => loaded.every(vs => {
    const all = buildSeries(vs, variable, lead);
    const col = variable === 'wind_direction_10m' ? all[id]?.u : all[id];
    if (!col) return false;
    for (let h = 0; h < nHours; h += POOL_STRIDE) if (!finite(col[h])) return false;
    return true;
  }));
  if (common.length < 2) return null;
  for (const id of common) series[id] = new Array(times.length).fill(null);
  for (let k = 0; k < times.length; k++) {
    for (const id of common) {
      for (const vs of loaded) {
        const all = buildSeries(vs, variable, lead);
        const col = variable === 'wind_direction_10m' ? all[id]?.u : all[id];
        if (col && finite(col[k % nHours])) series[id][k] = col[k % nHours];
      }
    }
  }
  const cross = {}, crossVars = [];
  for (const v of E.VARIABLES[variable].cross || []) {
    const cols = loaded.map(vs => crossMean(vs, v, lead, common, vs.times));
    if (cols.length !== loaded.length || cols.some(c => !c)) continue;
    const col = new Array(times.length).fill(null);
    for (let k = 0; k < times.length; k++) {
      const h = k % nHours;
      let s = 0, c = 0;
      for (const cc of cols) if (finite(cc[h])) { s += cc[h]; c++; }
      col[k] = c ? s / c : null;
    }
    cross[v] = col;
    crossVars.push(v);
  }
  return E.evaluate({
    times, obs, series, cross, crossVars,
    variable, lead, modelNames, utcOffset: 7, ...SPLIT,
  });
}

/* ---------- run ---------- */

const loadedFor = new Map();
for (const loc of LOCATIONS) {
  try {
    const vs = await loadLocation(loc);
    loadedFor.set(loc.id, vs);
  } catch (e) {
    errors.push(`${loc.id}: không tải được ERA5 (${e.message})`);
  }
}
if (!loadedFor.size) {
  console.error('Không có dữ liệu nào trong raw/. Chạy `node collect.mjs` trước.');
  process.exit(1);
}
console.log(`${loadedFor.size} địa điểm, ${loadedFor.values().next().value.times.length} giờ, ${DET_MODELS.length} hệ thống`);

const started = Date.now();
const locations = [];

for (let li = 0; li < LOCATIONS.length; li++) {
  const loc = LOCATIONS[li];
  const vs = loadedFor.get(loc.id);
  if (!vs) continue;
  const tests = [];
  for (const variable of VARIABLES) {
    if (only && only !== variable) continue;
    for (const lead of LEADS) {
      const t0 = Date.now();
      let res;
      try {
        res = evaluateOne(vs, loc, variable, lead);
      } catch (e) {
        errors.push(`${loc.id}/${variable}/d${lead}: ${e.message}`);
        continue;
      }
      if (!res) continue;
      tests.push(res);
      if (res.usable) {
        const m = res.mean?.rmse, q = res.equalMean?.rmse;
        console.log(
          `${loc.id.padEnd(8)} ${variable.padEnd(26)} d${lead} ${String(res.selected.family).padEnd(6)} ` +
          `rmse ${m?.toFixed(3) ?? '—'} vs tb ${q?.toFixed(3) ?? '—'} ` +
          `n=${res.testN} (${Date.now() - t0}ms)`,
        );
      }
    }
  }
  locations.push({
    id: loc.id, name: loc.name, lat: loc.lat, lon: loc.lon, utcOffset: loc.utcOffset,
    referenceGrid: vs.referenceGrid, tests,
  });
}

/* ---------- pooled fallback ---------- */

const pooled = {};
if (!only) {
  for (const variable of VARIABLES) {
    if (E.VARIABLES[variable].kind === 'code') continue;
    // Không gộp hướng gió: nhầm lẫn góc giữa các miền làm tính năng bị sai.
    if (E.VARIABLES[variable].kind === 'direction') continue;
    pooled[variable] = {};
    for (const lead of LEADS) {
      const t0 = Date.now();
      try {
        const r = pooledOne([...loadedFor.values()], variable, lead);
        if (!r) continue;
        pooled[variable][lead] = {
          family: r.selected?.family ?? null, models: r.models, calibration: r.calibration,
          testN: r.testN, trainingN: r.trainingN,
          mean: r.mean, equalMean: r.equalMean,
          note: 'Gộp sáu địa điểm, lấy mẫu xen kẽ. Chỉ dùng khi địa điểm không có hiệu chỉnh riêng.',
        };
        console.log(`pooled   ${variable.padEnd(26)} d${lead} rmse ${r.mean?.rmse?.toFixed(3) ?? '—'} vs tb ${r.equalMean?.rmse?.toFixed(3) ?? '—'} (${Date.now() - t0}ms)`);
      } catch (e) {
        errors.push(`pooled/${variable}/d${lead}: ${e.message}`);
      }
    }
  }
}

/* ---------- report ---------- */

const scored = locations.flatMap(l => l.tests).filter(t => t.usable && t.mean?.rmse != null && t.equalMean?.rmse != null);
const skill = arr => arr.filter(x => finite(x));
const meanOf = (arr, f) => {
  const v = arr.map(f).filter(finite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

const report = {
  createdAt: new Date().toISOString(),
  reference: 'ERA5 tái phân tích — không phải số đo trực tiếp từ trạm',
  period: PERIOD,
  split: { ...SPLIT, trainEndNote: 'Huấn luyện kết thúc 14/10, bỏ trống 7 ngày, chấm điểm từ 22/10' },
  method: 'EMOS hồi quy ridge trên giá trị từng hệ thống, độ lệch giữa các hệ thống, hai biến phụ và điều hòa ngày đêm/năm; chọn họ mô hình và hệ số phạt bằng kiểm chứng chặn trong cửa sổ huấn luyện; phương sai phần dư mô hình hóa bằng alpha + beta * lech^2; dự báo xác suất lấy từ 51 thành viên giả tạo tất định.',
  ensembleMethod: 'Không dùng thành viên tổ hợp gốc: kho lưu dự báo quá khứ của ECMWF ENS và NOAA GEFS chỉ giữ khoảng ba tháng gần nhất, không đủ để kiểm chứng. Độ rộng dùng làm tín hiệu là mức bất đồng giữa bảy hệ thống xác định, có thể kiểm chứng được.',
  models: DET_MODELS,
  leads: LEADS,
  variables: Object.fromEntries(Object.entries(E.VARIABLES).map(([k, v]) => [k, {
    label: v.label, short: v.short, unit: v.unit, kind: v.kind, group: v.group, digits: v.digits,
    thresholds: v.thresholds || null,
  }])),
  headline: {
    evaluated: scored.length,
    meanSkillVsEqualWeight: meanOf(scored, t => 1 - t.mean.rmse / t.equalMean.rmse),
    meanSkillVsBestSingle: meanOf(scored.filter(t => t.bestSingle?.test?.rmse > 0), t => 1 - t.mean.rmse / t.bestSingle.test.rmse),
    betterThanEqualWeight: scored.filter(t => t.mean.rmse < t.equalMean.rmse).length,
    significantImprovementVsEqualWeight: scored.filter(t => t.bootstrap?.vsEqualMean?.probImprovement >= 0.9).length,
    betterThanBestSingle: scored.filter(t => t.bestSingle?.test?.rmse > 0 && t.mean.rmse < t.bestSingle.test.rmse).length,
    significantImprovementVsBestSingle: scored.filter(t => t.bootstrap?.vsBestSingle?.probImprovement >= 0.9).length,
    familyChosen: scored.reduce((acc, t) => { acc[t.selected.family] = (acc[t.selected.family] || 0) + 1; return acc; }, {}),
  },
  pooled,
  locations,
  // Địa điểm trong cấu hình nhưng chưa đủ dữ liệu để hiệu chỉnh: menu vẫn ghim
  // để xem dự báo trung bình nhiều mô hình, tự chuyển sang locations khi đủ.
  pinnedPlaces: LOCATIONS.filter(l => !locations.some(x => x.id === l.id))
    .map(l => ({ id: l.id, name: l.name, lat: l.lat, lon: l.lon, utcOffset: l.utcOffset })),
  errors,
};

await fs.writeFile(path.join(DIST, 'benchmark.json'), JSON.stringify(report));
const kb = (JSON.stringify(report).length / 1024).toFixed(0);
console.log(`\nHoàn tất ${scored.length} phép chấm trong ${((Date.now() - started) / 60000).toFixed(1)} phút.`);
console.log(`benchmark.json ${kb} KB — thiên lệch trung bình so với trung bình đều: ${(report.headline.meanSkillVsEqualWeight * 100).toFixed(2)}%`);
console.log('so với hệ thống đơn tốt nhất:', (report.headline.meanSkillVsBestSingle * 100).toFixed(2) + '%');
console.log('cải thiện có ý nghĩa (≥90% bootstrap):', report.headline.significantImprovementVsEqualWeight, 'trên', report.headline.evaluated);
console.log('họ mô hình được chọn:', JSON.stringify(report.headline.familyChosen));
if (errors.length) console.log('lỗi:', errors.length, errors.slice(0, 5));
