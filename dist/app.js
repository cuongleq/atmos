/*
 * ATMOS front end.
 *
 * The browser never invents calibration. It pulls the seven deterministic
 * systems for a point, hands them to AtmosEngine.calibrate() together with the
 * coefficients the offline backtest produced, and renders the resulting
 * predictive distribution. If no calibration exists for the chosen location the
 * interface says so and falls back to a plain multi-model mean.
 */
'use strict';
const E = AtmosEngine;
const $ = id => document.getElementById(id);
const report = JSON.parse($('benchmark-data').textContent);
let NCHMF = { collectedAt: null, categories: [] };
try { NCHMF = JSON.parse($('nchmf-data').textContent); } catch (e) { /* stub khi build thiếu */ }
const MODELS = report.models;
const COLORS = ['#3479be', '#ce6b2f', '#648b39', '#8e5ba6', '#0f8f8f', '#a8324a', '#5c6b7a'];
// Used only when a report predates the regime payload, so the code classifier
// still has context fields to average.
// Used only when a report predates the regime payload, so the code classifier
// still has context fields to average. It must watch the same five fields the
// backtest fitted, or the browser lookup and the verified fit disagree.
const CODE_FALLBACK_FIELDS = ['cloud_cover', 'precipitation', 'wind_speed_10m', 'apparent_temperature', 'relative_humidity_2m'];
const VAR_LIST = Object.keys(report.variables);

let live = null, place = { ...report.locations[0] }, requestId = 0;
// Per-variable calibrated series for the current forecast, reused by the charts,
// the parameter grid and the CSV export so all three agree exactly.
const calCache = new Map();

/* ---------- small helpers ---------- */

const fmt = (v, n = 1) => (E.finite(v)
  ? v.toLocaleString('vi-VN', { minimumFractionDigits: n, maximumFractionDigits: n })
  : '—');
const pct = (v, n = 0) => (E.finite(v) ? fmt(v * 100, n) + ' %' : '—');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = v => (report.variables[v] ? report.variables[v].digits : 1);
const unit = v => (report.variables[v] ? report.variables[v].unit : '');
const range = v => {
  const s = report.variables[v];
  return s && s.kind === 'logit' ? [0, 100] : (s && s.kind === 'log1p' ? [0, null] : [null, null]);
};

function notice(id, text, type = '') {
  const n = $(id);
  n.textContent = text;
  n.className = 'notice ' + type;
}
function condition(code) { return E.conditionOf(code); }
const BEARINGS = ['B', 'BBL', 'ĐB', 'Đ', 'ĐN', 'N', 'NTN', 'TN', 'TTN', 'T', 'TTB', 'TB', 'BTB', 'BT', 'BTN', 'BNB', 'B'];
function bearing(deg) {
  if (!E.finite(deg)) return '—';
  return `${Math.round(deg)}° ${BEARINGS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]}`;
}
function weatherFamily(code) {
  const g = E.condGroup(code);
  return { 0: '☀', 1: '⛅', 2: '🌫', 3: '🌦', 4: '🌧', 5: '❄', 6: '🌦', 7: '❄', 8: '⛈' }[g] || '—';
}

async function api(base, params) {
  const r = await fetch(base + '?' + new URLSearchParams(params), { signal: AbortSignal.timeout(45000) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.reason || 'Nguồn dữ liệu trả về lỗi ' + r.status);
  return j;
}

/* ---------- calibration lookup ---------- */

/**
 * A calibration is only valid within the window it was fitted on, so anything
 * older falls back to the pooled six-location model and is labelled as such.
 */
function calibrationFor(variable, lead) {
  const loc = report.locations.find(l => l.id === place.id);
  const own = loc?.tests.find(t => t.usable && t.variable === variable && t.lead === lead);
  if (own?.calibration) return { calib: own.calibration, source: loc.name, distanceKm: 0, pooled: false };
  // Direction and code ship their own payload shape, not a scalar calibration.
  if (own?.usable && (report.variables[variable].kind === 'direction' || report.variables[variable].kind === 'code')) {
    return { calib: { regime: own.regime }, direction: own.calibration, regime: own.regime, source: loc.name, pooled: false };
  }
  const pooled = report.pooled?.[variable]?.[lead];
  if (pooled?.calibration) {
    const km = report.locations.map(l => E.distanceKm(place, l)).sort((a, b) => a - b)[0] ?? null;
    const near = report.locations
      .map(l => ({ l, km: E.distanceKm(place, l) }))
      .sort((a, b) => a.km - b.km)[0];
    return {
      calib: pooled.calibration,
      source: 'bản gộp 6 địa điểm',
      distanceKm: km,
      pooled: true,
      note: near ? `Địa điểm gần nhất trong tập hiệu chỉnh: ${near.l.name}, cách ${Math.round(near.km)} km.` : null,
    };
  }
  return null;
}

/** How a variable is forecast live, per kind. Mirrors the engine's own branches. */
function scalarKind(variable) {
  const kind = report.variables[variable].kind;
  return ['gauss', 'log1p', 'logit'].includes(kind) ? kind : null;
}

function pooledPointForecast(variable, series, times) {
  const kind = scalarKind(variable);
  if (!kind) return new Array(times.length).fill(null);
  const forward = E.FORWARD[kind], inverse = E.INVERSE[kind];
  const [lo, hi] = range(variable);
  const cols = Object.values(series).map(a => a.map(v => (E.finite(v) ? forward(v) : null)));
  const out = new Array(times.length).fill(null);
  for (let i = 0; i < times.length; i++) {
    let s = 0, c = 0, s2 = 0;
    for (const col of cols) if (E.finite(col[i])) { s += col[i]; s2 += col[i] ** 2; c++; }
    if (c < 2) continue;
    const mean = s / c;
    const spread = Math.sqrt(Math.max(0, s2 / c - mean * mean));
    const mem = E.pseudoMembers(kind, mean, Math.max(spread, 0.3), lo, hi);
    out[i] = {
      mean: E.meanS(mem), median: E.quantile(mem, 0.5),
      p10: E.quantile(mem, 0.1), p25: E.quantile(mem, 0.25),
      p75: E.quantile(mem, 0.75), p90: E.quantile(mem, 0.9),
      low: mem[0], high: mem[E.K_MEMBERS - 1],
      sd: spread, spread, nModels: c, uncalibrated: true,
    };
  }
  return out;
}

// Wind direction and WMO code are forecast by the engine, which owns the u/v fit
// and the regime lookup so the page cannot drift from the verified method.

/** Đa số thô mã WMO giữa các mô hình — dự phòng hiển thị khi thiếu bảng vùng. */
function rawMajorityCode(times) {
  const cols = Object.keys(live.byId).map(id => seriesFor(live.byId[id], 'weather_code', times));
  return times.map((_, i) => {
    const tally = new Map();
    for (const col of cols) {
      const v = col[i];
      if (E.finite(v)) tally.set(Math.round(v), (tally.get(Math.round(v)) || 0) + 1);
    }
    if (!tally.size) return null;
    let best = null, bestN = -1;
    for (const [code, n] of tally) if (n > bestN) { bestN = n; best = code; }
    return { code: best, nModels: tally.size, uncalibrated: true };
  });
}

/* ---------- live data ---------- */

const LIVE_VARS = VAR_LIST;

function seriesFor(model, variable, times) {
  const h = model?.hourly;
  if (!h) return times.map(() => null);
  const col = h[variable];
  if (!col) return times.map(() => null);
  const map = new Map(h.time.map((t, i) => [t, col[i] ?? null]));
  return times.map(t => map.get(t) ?? null);
}

/** Hours from now, in the location's own clock, as ISO strings without offset. */
function activeTimes(base) {
  const h = base.hourly;
  const now = base.current?.time || h.time[0];
  const key = now.slice(0, 13) + ':00';
  let idx = h.time.findIndex(t => t >= key);
  if (idx < 0) idx = 0;
  return h.time.slice(idx, idx + 168);
}

function quickRender() {
  $('quick').innerHTML = report.locations
    .map(l => `<button data-city="${l.id}" class="${place.id === l.id ? 'selected' : ''}">${esc(l.name)}</button>`).join('');
  $('quick').querySelectorAll('button').forEach(b => {
    b.onclick = () => { place = { ...report.locations.find(l => l.id === b.dataset.city) }; loadForecast(); };
  });
}

/** Fetch base + per-model forecasts for any place. Returns null on failure. */
async function fetchPlaceData(aPlace) {
  const base = {
    latitude: aPlace.lat, longitude: aPlace.lon, timezone: 'auto', forecast_days: 16,
  };
  const results = await Promise.allSettled([
    api('https://api.open-meteo.com/v1/forecast', {
      ...base,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      hourly: LIVE_VARS.join(',') + ',weather_code,wind_gusts_10m,precipitation_probability',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,weather_code,sunrise,sunset',
    }),
    ...MODELS.map(m => api('https://api.open-meteo.com/v1/forecast', {
      ...base, models: m.id, hourly: LIVE_VARS.join(','),
    })),
  ]);
  if (results[0].status !== 'fulfilled') return null;
  const models = results.slice(1).map(r => (r.status === 'fulfilled' ? r.value : null));
  const byId = {};
  models.forEach((m, i) => { if (m) byId[MODELS[i].id] = m; });
  return {
    base: results[0].value, models, byId,
    downloadedAt: new Date().toISOString(),
    place: { ...aPlace },
  };
}

async function loadForecast() {
  const token = ++requestId;
  live = null;
  quickRender();
  $('place').textContent = place.name;
  $('coordinates').textContent = fmt(place.lat, 4) + '° B · ' + fmt(place.lon, 4) + '° Đ';
  for (const k of ['temp', 'humidity', 'wind', 'feels', 'rain24', 'rainRange', 'probHeavy', 'gustRisk']) $(k).textContent = '—';
  $('condition').textContent = 'Đang tải';
  $('chart').textContent = 'Đang lấy dự báo…';
  $('days').textContent = 'Đang tải…';
  $('paramGrid').innerHTML = '<p class="muted">Đang tải…</p>';
  $('exportForecast').disabled = true;
  notice('riskMessage', 'Chờ dữ liệu để đánh giá.');
  notice('liveStatus', 'Đang lấy dự liệu cho ' + place.name + '…');

  const fc = await fetchPlaceData(place);
  if (token !== requestId) return;
  if (!fc) {
    notice('liveStatus', 'Không tải được dự báo. Kiểm tra kết nối rồi chọn Cập nhật. Báo cáo kiểm thử vẫn dùng được.', 'error');
    $('condition').textContent = 'Chưa có dữ liệu';
    $('chart').textContent = 'Không có dữ liệu trực tiếp.';
    $('days').textContent = 'Không có dữ liệu.';
    $('paramGrid').innerHTML = '<p class="muted">Không có dữ liệu trực tiếp.</p>';
    return;
  }
  live = fc;
  calCache.clear();
  renderForecast();

  const failed = live.models.filter(m => !m).length;
  notice('liveStatus', failed
    ? `${MODELS.length - failed}/${MODELS.length} hệ thống có dữ liệu. Hệ thống thiếu được bỏ qua, giá trị thiếu không được coi là 0.`
    : `Đã tải ${MODELS.length} hệ thống và hiệu chỉnh bằng hệ số đã kiểm thử. Múi giờ ${live.base.timezone}.`,
    failed ? 'warning' : '');

  renderChart();
  renderParams();
  renderDays();
  selectedDay = null;
  $('dayDetailTitle').textContent = 'Chọn một ngày trong tháng';
  $('dayDetailMeta').textContent = '—';
  $('dayDetail').innerHTML = '<p class="muted">Bấm vào một ngày có dự báo trong lịch tháng (hoặc thẻ 16 ngày) để xem chi tiết từng giờ.</p>';
  renderNchmf();
  loadMonthCal();
  loadAqi();
  syncDisasterToPlace();
}

/* ---------- air quality (CAMS via Open-Meteo, no key, hourly) ---------- */

let aqiToken = 0;

// Thang US EPA: 0-50 Tot | 51-100 Trung binh | 101-150 Kem cho nhom nhay cam
// | 151-200 Xau | 201-300 Rat xau | 301+ Nguy hai. Giu nhan ASCII de tranh loi font.
const AQI_BANDS = [
  { max: 50, label: 'Tốt', color: '#27ae60', advice: 'Chất lượng không khí tốt. Sinh hoạt ngoài trời bình thường.' },
  { max: 100, label: 'Trung bình', color: '#f1c40f', advice: 'Chấp nhận được. Người rất nhạy cảm nên hạn chế vận động mạnh kéo dài ngoài trời.' },
  { max: 150, label: 'Kém cho nhóm nhạy cảm', color: '#e67e22', advice: 'Trẻ em, người già, người bệnh hô hấp/tim mạch nên rút ngắn hoạt động ngoài trời, đeo khẩu trang khi ra đường đông.' },
  { max: 200, label: 'Xấu', color: '#c0392b', advice: 'Mọi người nên giảm vận động ngoài trời kéo dài; nhóm nhạy cảm ở trong nhà, đóng cửa, bật lọc khí nếu có.' },
  { max: 300, label: 'Rất xấu', color: '#8e44ad', advice: 'Tránh ra ngoài. Nếu bắt buộc, đeo khẩu trang N95/KN95 và rút ngắn thời gian tối đa.' },
  { max: 1e9, label: 'Nguy hại', color: '#7b241c', advice: 'Khẩn cấp: ở trong nhà, niêm kín cửa, theo dõi cảnh báo chính thức.' },
];
const aqiBand = v => AQI_BANDS.find(b => v <= b.max) || AQI_BANDS[AQI_BANDS.length - 1];

async function loadAqi() {
  const token = ++aqiToken;
  const ref = { ...place };
  $('aqiNow').innerHTML = '<p class="muted">Đang tải dữ liệu không khí…</p>';
  $('aqiStrip').innerHTML = '';
  $('aqiPollutants').innerHTML = '';
  $('aqiAdvice').textContent = '';
  $('aqiMeta').textContent = 'đang tải…';
  try {
    const j = await api('https://air-quality-api.open-meteo.com/v1/air-quality', {
      latitude: ref.lat, longitude: ref.lon, timezone: 'auto', forecast_days: 3,
      current: 'us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone',
      hourly: 'us_aqi,pm2_5',
    });
    if (token !== aqiToken) return;
    const c = j.current || {};
    const aqi = c.us_aqi;
    if (!E.finite(aqi)) throw new Error('không có chỉ số AQI');
    const band = aqiBand(aqi);
    $('aqiMeta').textContent = 'mốc ' + (c.time || '').replace('T', ' ') + ' · CAMS';
    $('aqiNow').innerHTML =
      `<div class="aqi-badge" style="background:${band.color}"><strong>${fmt(aqi, 0)}</strong><span>US AQI · ${esc(band.label)}</span></div>` +
      `<p class="small">Bụi mịn PM2.5 hiện tại: <strong>${fmt(c.pm2_5, 1)} µg/m³</strong> (WHO khuyến nghị TB năm ≤ 5 µg/m³).</p>`;
    $('aqiAdvice').textContent = band.advice;

    const pol = [
      ['PM2.5', c.pm2_5, 'µg/m³', 'Bụi mịn vào sâu phổi'],
      ['PM10', c.pm10, 'µg/m³', 'Bụi thô đường hô hấp'],
      ['O₃', c.ozone, 'µg/m³', 'Ô-zôn mặt đất'],
      ['NO₂', c.nitrogen_dioxide, 'µg/m³', 'Khí giao thông'],
      ['SO₂', c.sulphur_dioxide, 'µg/m³', 'Khí công nghiệp'],
      ['CO', c.carbon_monoxide, 'µg/m³', 'Khí không màu'],
    ];
    $('aqiPollutants').innerHTML = pol.map(([name, v, u, note]) =>
      `<div class="pollutant"><span class="pollutant-name">${name}</span><strong>${E.finite(v) ? fmt(v, 1) : '—'}</strong><span class="pollutant-u">${u} · ${note}</span></div>`).join('');

    // Dải 72 giờ: màu theo thang AQI, rê chuột thấy số.
    const times = j.hourly?.time || [], vals = j.hourly?.us_aqi || [];
    $('aqiStrip').innerHTML = times.map((hh, i) => {
      const v = vals[i];
      if (!E.finite(v)) return '';
      const b = aqiBand(v);
      const d = new Date(hh.length <= 16 ? hh + ':00' : hh);
      const lab = d.toLocaleDateString('vi-VN', { weekday: 'short' }) + ' ' + String(d.getHours()).padStart(2, '0') + 'h';
      return `<div class="strip-cell" style="background:${b.color}22;border-top:3px solid ${b.color}" title="${lab}: AQI ${Math.round(v)} · ${b.label}"><span>${String(d.getHours()).padStart(2, '0')}h</span><strong>${Math.round(v)}</strong></div>`;
    }).join('');
  } catch (e) {
    if (token !== aqiToken) return;
    $('aqiNow').innerHTML = `<p class="muted">Không tải được dữ liệu không khí: ${esc(e.message)}</p>`;
    $('aqiMeta').textContent = 'lỗi tải';
  }
}

/* ---------- calibration for the whole series ---------- */

/**
 * Applies the lead-specific calibration to each hour. The shipped coefficients
 * are fitted per lead time (1/2/3/5/7 days), so each forecast hour is routed to
 * the nearest available lead rather than to a single one-size-fits-all fit.
 */
function calibratedSeries(variable, times, offsets) {
  const byId = live.byId;
  const ids = Object.keys(byId);
  const seriesMap = {};
  for (const id of ids) seriesMap[id] = seriesFor(byId[id], variable, times);

  const leads = report.leads;
  const nearestLead = h => leads.reduce((a, b) => (Math.abs(b * 24 - h) < Math.abs(a * 24 - h) ? b : a), leads[0]);
  const out = new Array(times.length).fill(null);
  let uncalibrated = false;

  for (const lead of new Set(times.map((_, i) => nearestLead(offsets[i])))) {
    const idx = [];
    for (let i = 0; i < times.length; i++) if (nearestLead(offsets[i]) === lead) idx.push(i);
    if (!idx.length) continue;

    const subTimes = idx.map(i => times[i]);
    const subSeries = {};
    for (const id of ids) subSeries[id] = idx.map(i => seriesMap[id][i]);

    const kind = report.variables[variable].kind;
    const found = calibrationFor(variable, lead);
    const utcOffset = place.utcOffset ?? Math.round(place.lon / 15);

    // Wind direction: components fitted separately offline, recombined here.
    if (kind === 'direction') {
      const su = {}, sv = {};
      for (const id of Object.keys(live.byId)) {
        const sp = seriesFor(live.byId[id], 'wind_speed_10m', times);
        const dr = seriesFor(live.byId[id], variable, times);
        const u = [], v = [];
        for (let i = 0; i < times.length; i++) {
          if (!E.finite(sp[i]) || !E.finite(dr[i])) { u.push(null); v.push(null); continue; }
          const r = dr[i] * Math.PI / 180;
          u.push(sp[i] * Math.cos(r)); v.push(sp[i] * Math.sin(r));
        }
        su[id] = u; sv[id] = v;
      }
      const dir = E.calibrateDirection({ times, seriesU: su, seriesV: sv, calibration: found?.direction, utcOffset });
      if (dir) {
        for (let k = 0; k < idx.length; k++) out[idx[k]] = dir?.[idx[k]] || null;
      } else {
        // Không có hiệu chỉnh u/v: trung bình vector thô, ghi rõ chưa hiệu chỉnh.
        for (let k = 0; k < idx.length; k++) {
          const i = idx[k];
          let su = 0, sv = 0, n = 0;
          for (const id of Object.keys(live.byId)) {
            const sp = seriesFor(live.byId[id], 'wind_speed_10m', times)[i];
            const dr = seriesFor(live.byId[id], variable, times)[i];
            if (E.finite(sp) && E.finite(dr)) {
              const r = dr * Math.PI / 180;
              su += sp * Math.cos(r); sv += sp * Math.sin(r); n++;
            }
          }
          out[idx[k]] = n >= 2
            ? { mean: Math.hypot(su / n, sv / n), median: Math.hypot(su / n, sv / n), dir: (Math.atan2(sv / n, su / n) * 180 / Math.PI + 360) % 360, nModels: n, uncalibrated: true }
            : null;
        }
        uncalibrated = true;
      }
      continue;
    }

    // Weather code: apply the regime lookup that was fitted offline.
    if (kind === 'code') {
      if (!found?.regime) {
        // Không có bảng vùng đã hiệu chỉnh (báo cáo thiếu): lấy đa số thô của
        // các mô hình, ghi rõ chưa hiệu chỉnh thay vì để trống cả ngày.
        const votes = rawMajorityCode(times);
        for (let k = 0; k < idx.length; k++) out[idx[k]] = votes[idx[k]];
        uncalibrated = true;
        continue;
      }
      const byVariable = {};
      for (const id of Object.keys(live.byId)) {
        byVariable[id] = {};
        for (const f of (found?.regime?.fields || CODE_FALLBACK_FIELDS)) {
          byVariable[id][f] = seriesFor(live.byId[id], f, times);
        }
      }
      const codes = E.calibrateCode({ times, series: byVariable, regime: found?.regime });
      for (let k = 0; k < idx.length; k++) out[idx[k]] = codes?.[k] ? { code: codes[k].code, nModels: codes[k].nModels, condition: codes[k].condition } : null;
      if (!codes) uncalibrated = true;
      continue;
    }

    if (!found) {
      uncalibrated = true;
      const flat = pooledPointForecast(variable, subSeries, subTimes);
      for (let k = 0; k < idx.length; k++) out[idx[k]] = flat[k];
      continue;
    }

    // Cross predictors are the multi-model mean in the same transformed space the
    // fit used, restricted to the model set that calibration was built on.
    const crossSeries = {};
    for (const cv of found.calib.crossVars || []) {
      const cols = found.calib.modelIds
        .filter(id => seriesMap[id])
        .map(id => seriesFor(byId[id], cv, times));
      if (!cols.length) continue;
      const fwd = E.FORWARD[report.variables[cv].kind];
      const need = Math.max(2, Math.ceil(cols.length * 0.6));
      crossSeries[cv] = subTimes.map((_, k) => {
        let s = 0, c = 0;
        for (const col of cols) if (E.finite(col[idx[k]])) { s += fwd(col[idx[k]]); c++; }
        return c >= need ? s / c : null;
      });
    }

    const cal = E.calibrate({
      times: subTimes, variable, series: subSeries,
      calib: found.calib, cross: crossSeries, utcOffset,
    });
    for (let k = 0; k < idx.length; k++) out[idx[k]] = cal ? cal[k] : null;
  }
  return { series: out, uncalibrated };
}

/** Memoised per variable, keyed on the current forecast generation. */
function calFor(variable) {
  if (calCache.has(variable)) return calCache.get(variable);
  const times = activeTimes(live.base);
  const offsets = forecastOffsetSeries(times);
  const value = calibratedSeries(variable, times, offsets);
  calCache.set(variable, value);
  return value;
}

function forecastOffsetSeries(times) {
  const tz = live.base.utc_offset_seconds ?? 0;
  const now = Date.now();
  const ref = new Date((live.base.current?.time || times[0]).replace(' ', 'T') + 'Z').getTime();
  const base = E.finite(ref) ? ref : now;
  return times.map(t => Math.max(0, (Date.parse(t + ':00Z') - base) / 3600000));
}

/* ---------- rendering ---------- */

function renderForecast() {
  const b = live.base, c = b.current || {}, times = activeTimes(b);
  $('temp').textContent = fmt(c.temperature_2m);
  $('humidity').textContent = fmt(c.relative_humidity_2m, 0) + ' %';
  $('wind').textContent = fmt(c.wind_speed_10m) + ' km/h';
  $('feels').textContent = fmt(c.apparent_temperature) + ' °C';
  $('condition').textContent = (weatherFamily(c.weather_code) + '  ' + condition(c.weather_code)).trim();

  const rain = calFor('precipitation').series;
  const gust = calFor('wind_gusts_10m').series;

  let sum = 0, n = 0, lo = null, hi = null;
  for (let i = 0; i < 24; i++) {
    const r = rain[i];
    if (!r) continue;
    sum += r.median; n++;
    lo = lo === null ? r.p10 : lo + r.p10;
    hi = hi === null ? r.p90 : hi + r.p90;
  }
  $('rain24').textContent = n ? fmt(sum, 1) : '—';
  $('rainRange').textContent = n ? `${fmt(lo)} → ${fmt(hi)} mm · dải 10–90%` : 'Không đủ 24 giờ';
  $('daysTz').textContent = 'Múi giờ: ' + b.timezone;

  let peakP = 0, peakGust = 0;
  for (let i = 0; i < 24; i++) {
    const pr = rain[i];
    if (pr?.probs?.['10'] !== undefined) peakP = Math.max(peakP, pr.probs['10']);
    const g = gust[i];
    if (g) peakGust = Math.max(peakGust, g.p90);
  }
  $('probHeavy').textContent = peakP > 0 ? pct(peakP, 0) : '—';
  $('gustRisk').textContent = peakGust > 0 ? fmt(peakGust) + ' km/h (90%)' : '—';

  const heavy = (rain.slice(0, 24).some(r => r?.probs?.['10'] > 0.5)) || sum >= 25 || peakGust >= 60;
  // Dung hợp mô hình số + cảnh báo chính thức: EMOS cho số, NCHMF cho thẩm quyền.
  const official = nchmfBannerFor(place.id);
  const officialRed = official.some(w => w.level === 'red');
  const riskText = official.length
    ? `NCHMF cũng đang cảnh báo vùng này: ${official[0].title.slice(0, 150)}. ` : '';
  notice('riskMessage', riskText + (heavy
    ? 'Có tín hiệu vượt ngưỡng mưa lớn hoặc gió mạnh trong 24 giờ tới. Xem bản tin chính thức và đối chiếu nhiều nguồn.'
    : n ? 'Dải 10–90% không vượt ngưỡng tham khảo trong 24 giờ tới. Điều này không loại trừ mưa dông cục bộ.'
      : 'Chưa đủ dữ liệu để đánh giá nguy cơ.'), (heavy || officialRed || official.length) ? 'warning' : '');

  const found24 = calibrationFor('precipitation', 1);
  $('calibNote').textContent = found24 && !found24.pooled
    ? `Hiệu chỉnh theo kiểm thử tại ${place.name}. Mỗi giờ kèm dải 10–90%.`
    : 'Dự báo trung bình nhiều hệ thống; không có hiệu chỉnh riêng cho địa điểm này.';
}

function renderParams() {
  const times = activeTimes(live.base);
  const at = Math.min(times.length - 1, 11);      // roughly 12 hours ahead
  const cards = [];
  for (const v of LIVE_VARS) {
    const s = report.variables[v];
    const r = calFor(v).series[at];
    const kind = s.kind;

    // Wind direction is a bearing: a 10-90 range is meaningless, so show the
    // sector and the count of systems instead.
    if (kind === 'direction') {
      cards.push(r
        ? `<button class="param" data-var="${v}"><span class="param-name">${esc(s.short)}</span>` +
        `<strong>${fmt(r.dir, 0)}<em>°</em></strong>` +
        `<span class="param-range">${bearing(r.dir)}</span>` +
        `<span class="param-n">${r.nModels}/${MODELS.length} hệ thống${r.uncalibrated ? ' · chưa hiệu chỉnh' : ''}</span></button>`
        : `<div class="param is-empty"><span class="param-name">${esc(s.short)}</span><strong>—</strong><span class="param-range">không đủ hệ thống</span></div>`);
      continue;
    }
    // Weather code is categorical.
    if (kind === 'code') {
      cards.push(r
        ? `<button class="param" data-var="${v}"><span class="param-name">${esc(s.short)}</span>` +
        `<strong>${weatherFamily(r.code)}</strong>` +
        `<span class="param-range">${esc(condition(r.code))}</span>` +
        `<span class="param-n">mã ${r.code} · ${r.nModels}/${MODELS.length} hệ thống${r.uncalibrated ? ' · chưa hiệu chỉnh' : ''}</span></button>`
        : `<div class="param is-empty"><span class="param-name">${esc(s.short)}</span><strong>—</strong><span class="param-range">ngoài vùng đã hiệu chỉnh</span></div>`);
      continue;
    }

    if (!r) { cards.push(`<div class="param is-empty"><span class="param-name">${esc(s.short)}</span><strong>—</strong><span class="param-range">không đủ hệ thống</span></div>`); continue; }
    const d = s.digits;
    cards.push(
      `<button class="param" data-var="${v}">` +
      `<span class="param-name">${esc(s.short)}</span>` +
      `<strong>${fmt(r.median, d)}<em>${esc(s.unit)}</em></strong>` +
      `<span class="param-range">${fmt(r.p10, d)} – ${fmt(r.p90, d)}</span>` +
      `<span class="param-n">${r.nModels}/${MODELS.length} hệ thống${r.uncalibrated ? ' · chưa hiệu chỉnh' : ''}</span>` +
      `</button>`);
  }
  $('paramGrid').innerHTML = cards.join('');
  $('paramGrid').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      $('chartVariable').value = b.dataset.var;
      renderChart();
      $('chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

function renderDays() {
  const d = live.base.daily;
  $('days').innerHTML = d.time.map((day, i) => {
    const risky = (d.precipitation_sum[i] ?? 0) >= 25 || (d.wind_gusts_10m_max[i] ?? 0) >= 60;
    return `<div class="day${risky ? ' alert' : ''}${selectedDay === day ? ' selected' : ''}" data-day="${day}" role="button" tabindex="0" title="Bấm để xem chi tiết từng giờ ngày ${day}">` +
      `<strong>${new Date(day + 'T12:00:00').toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}</strong>` +
      `<div class="day-temp">${fmt(d.temperature_2m_max[i], 0)}° <s>${fmt(d.temperature_2m_min[i], 0)}°</s></div>` +
      `<div class="rain-total">${fmt(d.precipitation_sum[i], 1)} mm</div>` +
      `<small>${weatherFamily(d.weather_code[i])} ${d.precipitation_probability_max[i] ?? '—'}%</small>` +
      `</div>`;
  }).join('');
  $('days').querySelectorAll('.day[data-day]').forEach(el => {
    const go = () => selectDay(el.dataset.day);
    el.onclick = go;
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}

/* ---------- month calendar + per-day detail ---------- */

let selectedDay = null;
let monthObs = {}; // iso date -> { tmax, tmin, psum }, gộp qua các tháng đã xem
let monthToken = 0;
let viewYear = null, viewMonth = null; // tháng đang hiển thị trong lịch

/** Today (YYYY-MM-DD) in the forecast location's own timezone. */
function placeToday() {
  const off = live?.base?.utc_offset_seconds ?? 0;
  return new Date(Date.now() + off * 1000).toISOString().slice(0, 10);
}

/**
 * Lịch tháng tùy chọn: ngày đã qua lấy quan trắc ERA5, ngày trong tầm 16 ngày
 * lấy dự báo tất định, ngày xa hơn để trống có nhãn rõ ràng thay vì đoán.
 * Không truyền y/m: quay về tháng hiện tại của điểm dự báo và làm mới cache.
 */
async function loadMonthCal(y, m) {
  const token = ++monthToken;
  const ref = { ...place };
  const today = placeToday();
  if (y === undefined || m === undefined) {
    const [cy, cm] = today.split('-').map(Number);
    viewYear = cy; viewMonth = cm;
    monthObs = {};
  } else {
    viewYear = y; viewMonth = m;
  }
  const yy = viewYear, mm = viewMonth;
  const prefix = `${yy}-${String(mm).padStart(2, '0')}`;
  wireMonthNav();
  $('monthPicker').value = prefix;
  $('monthCal').innerHTML = '<p class="muted">Đang tải lịch tháng…</p>';
  $('monthMeta').textContent = 'đang tải…';
  try {
    const monthStart = `${prefix}-01`;
    const monthEnd = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
    const yest = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    $('monthTitle').textContent = 'Tháng ' + mm + '/' + yy;

    const obsEnd = monthEnd < today ? monthEnd : (monthStart <= yest ? yest : null);
    if (obsEnd && monthStart <= obsEnd) {
      const j = await api('https://archive-api.open-meteo.com/v1/archive', {
        latitude: ref.lat, longitude: ref.lon,
        start_date: monthStart, end_date: obsEnd, timezone: 'auto',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      });
      if (token !== monthToken) return;
      (j.daily?.time || []).forEach((d, i) => {
        monthObs[d] = {
          tmax: j.daily.temperature_2m_max?.[i] ?? null,
          tmin: j.daily.temperature_2m_min?.[i] ?? null,
          psum: j.daily.precipitation_sum?.[i] ?? null,
        };
      });
    }
    if (token !== monthToken) return;

    const fc = {};
    const dd = live.base.daily;
    dd.time.forEach((d, i) => {
      fc[d] = {
        tmax: dd.temperature_2m_max[i], tmin: dd.temperature_2m_min[i],
        psum: dd.precipitation_sum[i], prob: dd.precipitation_probability_max[i],
        gust: dd.wind_gusts_10m_max[i], code: dd.weather_code[i],
      };
    });

    const lastFc = dd.time[dd.time.length - 1];
    const firstDow = (new Date(monthStart + 'T12:00:00').getUTCDay() + 6) % 7; // T2=0
    const dim = Number(monthEnd.slice(8, 10));
    let cells = '';
    for (let k = 0; k < firstDow; k++) cells += '<div class="mday empty"></div>';
    for (let day = 1; day <= dim; day++) {
      const iso = `${prefix}-${String(day).padStart(2, '0')}`;
      if (iso < today) {
        const o = monthObs[iso];
        cells += `<div class="mday past" data-day="${iso}"${o ? ` title="${iso}: cao nhất ${fmt(o.tmax, 1)}°C, thấp nhất ${fmt(o.tmin, 1)}°C, tổng mưa ${fmt(o.psum, 1)} mm (ERA5)"` : ''}><span class="mday-n">${day}</span>` +
          (o ? `<span class="mday-t">${fmt(o.tmax, 0)}°/${fmt(o.tmin, 0)}°</span><span class="mday-p">${fmt(o.psum, 1)} mm</span>`
            : '<span class="mday-p">chưa có</span>') + '</div>';
      } else if (fc[iso]) {
        const f = fc[iso];
        const risky = (f.psum ?? 0) >= 25 || (f.gust ?? 0) >= 60;
        cells += `<div class="mday forecast${risky ? ' alert' : ''}${selectedDay === iso ? ' selected' : ''}" data-day="${iso}" role="button" tabindex="0" title="${iso}: cao nhất ${fmt(f.tmax, 0)}°C, thấp nhất ${fmt(f.tmin, 0)}°C, mưa ${fmt(f.psum, 1)} mm, giật ${fmt(f.gust, 0)} km/h — bấm để xem chi tiết"><span class="mday-n">${day}</span>` +
          `<span class="mday-t">${fmt(f.tmax, 0)}°/${fmt(f.tmin, 0)}°</span><span class="mday-p">${weatherFamily(f.code)} ${fmt(f.psum, 1)} mm</span></div>`;
      } else {
        cells += `<div class="mday out"><span class="mday-n">${day}</span><span class="mday-p">ngoài tầm</span></div>`;
      }
    }
    $('monthCal').innerHTML =
      ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(w => `<div class="mday head">${w}</div>`).join('') + cells;
    $('monthCal').querySelectorAll('.mday.forecast').forEach(el => {
      const go = () => selectDay(el.dataset.day);
      el.onclick = go;
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    $('monthCal').querySelectorAll('.mday.past').forEach(el => {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.title = (el.title ? el.title + ' — bấm để xem chi tiết từng giờ' : 'Bấm để xem chi tiết từng giờ');
      const go = () => selectDay(el.dataset.day);
      el.onclick = go;
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    const mode = monthEnd < today ? 'toàn tháng là quan trắc ERA5'
      : prefix === today.slice(0, 7) ? `dự báo tới ${lastFc} · ERA5 các ngày đã qua`
        : `dự báo tới ${lastFc} · ngoài tầm cho hầu hết tháng này`;
    $('monthMeta').textContent = `${monthStart} → ${monthEnd} · ${mode}`;
  } catch (e) {
    if (token !== monthToken) return;
    $('monthCal').innerHTML = `<p class="muted">Không tải được lịch tháng: ${esc(e.message)}</p>`;
    $('monthMeta').textContent = 'lỗi tải';
  }
}

/** Nút tháng trước/sau và ô chọn tháng — gán một lần, gọi lại cũng an toàn. */
function wireMonthNav() {
  $('monthPrev').onclick = () => {
    let y = viewYear, m = viewMonth - 1;
    if (m < 1) { m = 12; y--; }
    loadMonthCal(y, m);
  };
  $('monthNext').onclick = () => {
    let y = viewYear, m = viewMonth + 1;
    if (m > 12) { m = 1; y++; }
    loadMonthCal(y, m);
  };
  $('monthPicker').onchange = () => {
    const v = $('monthPicker').value;
    if (/^\d{4}-\d{2}$/.test(v)) {
      const [y, m] = v.split('-').map(Number);
      if (m >= 1 && m <= 12) loadMonthCal(y, m);
    }
  };
}

/** Chi tiết 1 ngày: giờ nào, nhiệt/mưa/gió hiệu chỉnh ra sao, hoặc quan trắc đã qua. */
function selectDay(iso) {
  selectedDay = iso;
  document.querySelectorAll('.mday.forecast.selected, .day.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll(`.mday.forecast[data-day="${iso}"], .day[data-day="${iso}"]`).forEach(el => el.classList.add('selected'));
  const label = new Date(iso + 'T12:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  $('dayDetailTitle').textContent = label;

  const o = monthObs[iso];
  if (o && iso < placeToday()) {
    $('dayDetailMeta').textContent = 'quan trắc ERA5 · đã qua';
    $('dayDetail').innerHTML = `<div class="metric-grid compact">` +
      `<div class="metric"><span class="small">Cao nhất</span><strong>${fmt(o.tmax, 1)} °C</strong></div>` +
      `<div class="metric"><span class="small">Thấp nhất</span><strong>${fmt(o.tmin, 1)} °C</strong></div>` +
      `<div class="metric"><span class="small">Tổng mưa</span><strong>${fmt(o.psum, 1)} mm</strong></div></div>` +
      `<div id="pastHours"><p class="muted">Đang tải diễn biến từng giờ…</p></div>` +
      `<p class="small">Số liệu tái phân tích ERA5, không phải dự báo.</p>`;
    loadPastDayHours(iso);
    return;
  }

  const times = (live.base.hourly?.time || []).filter(t => t.slice(0, 10) === iso);
  if (!times.length) {
    $('dayDetailMeta').textContent = 'ngoài tầm dự báo';
    $('dayDetail').innerHTML = `<p class="muted">Ngày ${iso} nằm ngoài 16 ngày dự báo tất định của nguồn mở. Xem lịch tháng để đối chiếu các ngày đã qua.</p>`;
    return;
  }
  const offsets = forecastOffsetSeries(times);
  const cal = varName => calibratedSeries(varName, times, offsets).series;
  let temp, rain, wind, gust, feel, hum, cloud, wdir, wcode;
  try {
    temp = cal('temperature_2m'); rain = cal('precipitation');
    wind = cal('wind_speed_10m'); gust = cal('wind_gusts_10m');
    feel = cal('apparent_temperature'); hum = cal('relative_humidity_2m');
    cloud = cal('cloud_cover'); wdir = cal('wind_direction_10m');
    wcode = cal('weather_code');
  } catch (e) {
    $('dayDetailMeta').textContent = 'lỗi tính';
    $('dayDetail').innerHTML = `<p class="muted">Không dựng được chi tiết giờ: ${esc(e.message)}</p>`;
    return;
  }
  // Tổng quan ngày từ dự báo hằng ngày + tổng mưa hiệu chỉnh.
  const di = (live.base.daily?.time || []).indexOf(iso);
  const dd = live.base.daily || {};
  const rainSum = rain.filter(Boolean).reduce((s, r) => s + (r.median ?? 0), 0);
  const rainLo = rain.filter(Boolean).reduce((s, r) => s + (r.p10 ?? 0), 0);
  const rainHi = rain.filter(Boolean).reduce((s, r) => s + (r.p90 ?? 0), 0);
  const probs = rain.map(r => r?.probs?.['1']).filter(E.finite);
  const pMax = probs.length ? Math.max(...probs) : null;
  const gustMax = Math.max(...gust.filter(Boolean).map(g => g.median ?? -1).filter(v => v >= 0), NaN);
  const codeDay = di >= 0 ? dd.weather_code?.[di] : null;
  const sun = t => (t || '').slice(11, 16);
  $('dayDetailMeta').textContent = `${times.length} giờ · trung vị hiệu chỉnh + dải 10–90%`;
  $('dayDetail').innerHTML =
    `<div class="metric-grid compact">` +
    `<div class="metric"><span class="small">Thời tiết</span><strong>${weatherFamily(codeDay)} ${esc(condition(codeDay))}</strong></div>` +
    `<div class="metric"><span class="small">Cao / thấp nhất</span><strong>${di >= 0 ? fmt(dd.temperature_2m_max?.[di], 0) + '° / ' + fmt(dd.temperature_2m_min?.[di], 0) + '°' : '—'}</strong></div>` +
    `<div class="metric"><span class="small">Tổng mưa hiệu chỉnh</span><strong>${fmt(rainSum, 1)} mm</strong><small>dải 10–90%: ${fmt(rainLo, 1)}–${fmt(rainHi, 1)} mm</small></div>` +
    `<div class="metric"><span class="small">P(mưa ≥1 mm) cao nhất</span><strong>${pMax !== null ? pct(pMax, 0) : '—'}</strong></div>` +
    `<div class="metric"><span class="small">Gió giật mạnh nhất</span><strong>${E.finite(gustMax) ? fmt(gustMax, 0) + ' km/h' : '—'}</strong></div>` +
    `<div class="metric"><span class="small">Mặt trời mọc / lặn</span><strong>${di >= 0 ? sun(dd.sunrise?.[di]) + ' – ' + sun(dd.sunset?.[di]) : '—'}</strong></div></div>` +
    `<div class="table-wrap"><table><thead><tr><th>Giờ</th><th>Thời tiết</th><th>Nhiệt độ</th><th>Cảm giác</th><th>Mưa (P)</th><th>Ẩm</th><th>Mây</th><th>Gió</th><th>Giật</th></tr></thead><tbody>` +
    times.map((t, i) => {
      const T = temp[i], R = rain[i], W = wind[i], G = gust[i];
      const F = feel[i], H = hum[i], C = cloud[i], D = wdir[i], WC = wcode[i];
      return `<tr><td>${t.slice(11, 16)}</td>` +
        `<td>${WC ? weatherFamily(WC.code) + ' <span class="tiny">' + esc(condition(WC.code)) + '</span>' : '—'}</td>` +
        `<td>${T ? fmt(T.median, 1) + '° <span class="tiny">(' + fmt(T.p10, 1) + '–' + fmt(T.p90, 1) + ')</span>' : '—'}</td>` +
        `<td>${F ? fmt(F.median, 1) + '°' : '—'}</td>` +
        `<td>${R ? fmt(R.median, 1) + ' mm' + (E.finite(R.probs?.['1']) ? ' <span class="tiny">' + pct(R.probs['1'], 0) + '</span>' : '') : '—'}</td>` +
        `<td>${H ? fmt(H.median, 0) + '%' : '—'}</td>` +
        `<td>${C ? fmt(C.median, 0) + '%' : '—'}</td>` +
        `<td>${W ? fmt(W.median, 0) + ' km/h' + (D ? ' ' + bearing(D.dir) : '') : '—'}</td>` +
        `<td>${G ? fmt(G.median, 0) + ' km/h' : '—'}</td></tr>`;
    }).join('') + `</tbody></table></div>`;
  $('dayDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Diễn biến từng giờ của ngày đã qua (ERA5), tải theo yêu cầu và nhớ cache. */
const pastDayCache = {};
let pastDayToken = 0;
async function loadPastDayHours(iso) {
  const token = ++pastDayToken;
  if (pastDayCache[iso]) { renderPastDayHours(iso, pastDayCache[iso]); return; }
  try {
    const j = await api('https://archive-api.open-meteo.com/v1/archive', {
      latitude: place.lat, longitude: place.lon,
      start_date: iso, end_date: iso, timezone: 'auto',
      hourly: 'temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code',
    });
    if (token !== pastDayToken || selectedDay !== iso) return;
    pastDayCache[iso] = j.hourly;
    renderPastDayHours(iso, j.hourly);
  } catch (e) {
    if (token !== pastDayToken || selectedDay !== iso) return;
    const box = $('pastHours');
    if (box) box.innerHTML = `<p class="muted">Không tải được giờ quan trắc: ${esc(e.message)}</p>`;
  }
}
function renderPastDayHours(iso, h) {
  if (selectedDay !== iso) return;
  const box = $('pastHours');
  if (!box || !h?.time?.length) return;
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Giờ</th><th>Thời tiết</th><th>Nhiệt độ</th><th>Mưa</th><th>Ẩm</th><th>Gió</th></tr></thead><tbody>` +
    h.time.map((t, i) => {
      const dr = h.wind_direction_10m?.[i];
      return `<tr><td>${t.slice(11, 16)}</td>` +
        `<td>${E.finite(h.weather_code?.[i]) ? weatherFamily(h.weather_code[i]) + ' <span class="tiny">' + esc(condition(h.weather_code[i])) + '</span>' : '—'}</td>` +
        `<td>${E.finite(h.temperature_2m?.[i]) ? fmt(h.temperature_2m[i], 1) + '°' : '—'}</td>` +
        `<td>${E.finite(h.precipitation?.[i]) ? fmt(h.precipitation[i], 1) + ' mm' : '—'}</td>` +
        `<td>${E.finite(h.relative_humidity_2m?.[i]) ? fmt(h.relative_humidity_2m[i], 0) + '%' : '—'}</td>` +
        `<td>${E.finite(h.wind_speed_10m?.[i]) ? fmt(h.wind_speed_10m[i], 0) + ' km/h' + (E.finite(dr) ? ' ' + bearing(dr) : '') : '—'}</td></tr>`;
    }).join('') + `</tbody></table></div>`;
}

/** Median position of each hour in the daily cycle, for a 24-hour heat strip. */
function diurnalStrip(cal, view, spec) {
  if (spec.kind === 'direction' || spec.kind === 'code') return null;
  const byHour = Array.from({ length: 24 }, () => []);
  for (let i = 0; i < view.length && i < cal.length; i++) {
    const r = cal[i];
    if (!r) continue;
    const h = Number(view[i].slice(11, 13));
    byHour[(h + (place.utcOffset ?? 0)) % 24].push(r.median);
  }
  const cells = byHour.map((arr, h) => {
    if (!arr.length) return { h, text: '—', empty: true };
    const vals = arr;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const mean = E.meanS(vals);
    return { h, text: fmt(mean, spec.digits), tint: hi === lo ? 0.5 : (mean - lo) / (hi - lo), empty: false };
  });
  return cells;
}

function renderChart() {
  if (!live) return;
  const variable = $('chartVariable').value;
  const spec = report.variables[variable];
  const times = activeTimes(live.base);
  const horizon = Math.min(Number($('horizon').value), times.length);
  const view = times.slice(0, horizon);
  const full = calFor(variable).series;
  const cal = full.slice(0, horizon);
  const showBands = $('showBands').checked;

  if (spec.kind === 'code') { renderCodeChart(view, cal); return; }
  if (spec.kind === 'direction') { renderDirectionChart(view, cal); return; }

  const rows = MODELS.map(m => seriesFor(live.byId[m.id], variable, view));

  $('legend').innerHTML = MODELS.map((m, i) =>
    `<span><i style="background:${COLORS[i]}"></i>${esc(m.name)}${rows[i].some(v => !E.finite(v)) ? ' · thiếu' : ''}</span>`).join('')
    + `<span><i style="background:#172736"></i>Dự báo đã hiệu chỉnh</span>`
    + (showBands ? `<span><i class="band"></i>Dải 10–90%</span>` : '');

  const values = [];
  for (const r of rows) for (const v of r) if (E.finite(v)) values.push(v);
  for (const r of cal) if (r) values.push(r.p10, r.p90, r.median);
  drawChart(view, rows, cal, values, spec, showBands, variable);

  const here = calibrationFor(variable, report.leads[0]);
  $('spreadNote').textContent = cal.some(Boolean)
    ? 'Dải 10–90% là phân phối hiệu chỉnh: độ rộng được mô hình hóa từ mức bất đồng giữa các hệ thống, không phải khoảng tin cậy thống kê của một mô hình đơn. '
    + (here?.pooled ? 'Dùng bản gộp do địa điểm chưa có hiệu chỉnh riêng. ' : '')
    + 'Di chuột để xem từng giờ.'
    : 'Không có hiệu chỉnh cho biến này tại địa điểm đã chọn.';
}

/** Weather code has no continuous scale, so it gets a timeline instead of a curve. */
function renderCodeChart(view, cal) {
  const cells = view.map((t, i) => {
    const r = cal[i];
    const g = r ? E.condGroup(r.code) : null;
    return `<div class="code-cell${r ? '' : ' empty'}" style="${r ? `opacity:${(0.45 + 0.55 * (r.nModels / MODELS.length)).toFixed(2)}` : ''}">` +
      `<span class="code-ico">${r ? weatherFamily(r.code) : '—'}</span>` +
      `<span class="code-lab">${t.slice(11, 16)}</span>` +
      `<span class="code-txt">${r ? esc(condition(r.code)) : 'ngoài vùng'}</span></div>`;
  }).join('');
  $('chart').innerHTML = `<div class="code-timeline">${cells}</div>`;
  $('legend').innerHTML = `<span><i style="background:#172736"></i>Dự báo phân loại theo vùng đã hiệu chỉnh (5 trường liên tục)</span>` +
    `<span class="tiny">Mã WMO là biến phân loại nên không có dải số; ô mờ dần là khi còn ít hệ thống.</span>`;
  $('spreadNote').textContent = 'Mã thời tiết suy ra từ vùng khí tượng đã học từ tập huấn luyện. Giờ nằm ngoài vùng đã quan sát được để trống thay vì đoán.';
  void cells;
}

/** Direction is circular: a Cartesian line through 350 and 10 would be nonsense. */
function renderDirectionChart(view, cal) {
  const rows = MODELS.map(m => {
    const sp = seriesFor(live.byId[m.id], 'wind_speed_10m', view);
    const dr = seriesFor(live.byId[m.id], 'wind_direction_10m', view);
    return sp.map((s, i) => (E.finite(s) && E.finite(dr[i]) ? { speed: s, dir: dr[i] } : null));
  });
  $('legend').innerHTML = MODELS.map((m, i) =>
    `<span><i style="background:${COLORS[i]}"></i>${esc(m.name)}</span>`).join('')
    + `<span><i style="background:#172736"></i>Dự báo đã hiệu chỉnh</span>`;
  const cells = view.map((t, i) => {
    const r = cal[i];
    const spd = r ? r.mean : null;
    return `<div class="code-cell${r ? '' : ' empty'}">` +
      `<span class="code-ico">${r ? '➤' : '—'}</span>` +
      `<span class="code-lab">${t.slice(11, 16)}</span>` +
      `<span class="code-txt">${r ? bearing(r.dir) : '—'}${E.finite(spd) ? ' · ' + fmt(spd) + ' km/h' : ''}</span></div>`;
  }).join('');
  const legend = `<p class="tiny">Quy mũ dùng cả 7 hệ thống: ${rows.map((r, i) => MODELS[i].name + ' ' + r.filter(Boolean).length).join(' · ')} giờ có dữ liệu.</p>`;
  $('chart').innerHTML = `<div class="code-timeline">${cells}</div>` + legend;
  $('spreadNote').textContent = 'Hướng gió là đại lượng vòng: 359° và 1° là hai hướng gần nhau, nên không vẽ đường thẳng qua 0°. Biểu đồ hiển thị hướng và tốc độ theo giờ.';
}

function drawChart(times, rows, cal, values, spec, showBands, variable) {
  if (!values.length) { $('chart').textContent = 'Không có dữ liệu cho biến này.'; return; }
  const W = 1040, H = 300, pad = { l: 56, r: 16, t: 18, b: 44 };
  let lo = Math.min(...values), hi = Math.max(...values);
  const margin = (hi - lo) * 0.12 || 1;
  lo -= margin; hi += margin;
  const [floor, ceil] = range(variable);
  if (E.finite(floor)) lo = Math.max(lo, floor);
  if (E.finite(ceil)) hi = Math.min(hi, ceil);
  const x = i => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, times.length - 1);
  const y = v => H - pad.b - ((v - lo) * (H - pad.t - pad.b)) / Math.max(1e-9, hi - lo);

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Dự báo xác suất theo giờ">`;
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    svg += `<line x1="${pad.l}" y1="${y(v)}" x2="${W - pad.r}" y2="${y(v)}" stroke="#e0e6eb"/>`
      + `<text x="${pad.l - 9}" y="${y(v) + 5}" text-anchor="end" font-size="13" fill="#526474">${fmt(v, spec?.digits ?? 0)}</text>`;
  }
  for (let k = 0; k <= 5; k++) {
    const i = Math.floor(((times.length - 1) * k) / 5);
    svg += `<text x="${x(i)}" y="${H - 14}" text-anchor="${k === 0 ? 'start' : k === 5 ? 'end' : 'middle'}" font-size="13" fill="#526474">${times[i].slice(5, 10)} ${times[i].slice(11, 16)}</text>`;
  }

  // calibrated band as a filled polygon
  if (showBands) {
    const up = [], down = [];
    for (let i = 0; i < times.length; i++) {
      if (!cal[i]) continue;
      up.push(`${x(i).toFixed(2)} ${y(cal[i].p90).toFixed(2)}`);
      down.unshift(`${x(i).toFixed(2)} ${y(cal[i].p10).toFixed(2)}`);
    }
    if (up.length > 1) {
      svg += `<polygon points="${up.concat(down).join(' ')}" fill="#2a5f96" opacity="0.16"/>`;
    }
  }

  rows.forEach((r, j) => {
    let d = '', open = false;
    r.forEach((v, i) => {
      if (!E.finite(v)) { open = false; return; }
      d += (open ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(v).toFixed(2) + ' ';
      open = true;
    });
    svg += `<path d="${d}" fill="none" stroke="${COLORS[j]}" stroke-width="1.6" opacity="0.75"/>`;
  });

  let d = '', open = false;
  for (let i = 0; i < times.length; i++) {
    if (!cal[i]) { open = false; continue; }
    d += (open ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(cal[i].median).toFixed(2) + ' ';
    open = true;
  }
  svg += `<path d="${d}" fill="none" stroke="#172736" stroke-width="3.2"/>`;

  const strip = diurnalStrip(cal, times, spec);
  if (strip) {
    $('chart').innerHTML += '<div class="strip">' + strip.map(c =>
      `<div class="strip-cell${c.empty ? ' empty' : ''}" style="${c.empty ? '' : `background:rgba(42,95,150,${(0.06 + c.tint * 0.2).toFixed(3)})`}" title="${c.h} giờ · TB ${esc(c.text)}"><span>${c.h}</span><strong>${c.text}</strong></div>`).join('') + '</div>';
  }

  const dg = spec.digits;
  times.forEach((t, i) => {
    const c = cal[i];
    const title = t.replace('T', ' ') + '\n'
      + MODELS.map((m, j) => m.name + ': ' + fmt(rows[j][i], dg)).join('\n')
      + (c ? `\nHiệu chỉnh: ${fmt(c.median, dg)} (10–90%: ${fmt(c.p10, dg)} – ${fmt(c.p90, dg)})` : '');
    svg += `<rect x="${x(i) - 3}" y="${pad.t}" width="6" height="${H - pad.t - pad.b}" fill="transparent"><title>${esc(title)}</title></rect>`;
  });
  $('chart').innerHTML = svg + '</svg>';
}

/* ---------- bản tin chính thức NCHMF + dung hợp cảnh báo ---------- */

// Từ khóa vùng theo địa điểm, dùng để đối chiếu tiêu đề cảnh báo NCHMF.
// Conservative: chỉ khớp khi tên được nêu đích danh trong tiêu đề.
const NCHMF_REGIONS = {
  hanoi: ['HÀ NỘI', 'BẮC BỘ', 'ĐỒNG BẰNG BẮC BỘ', 'TÂY BẮC BỘ', 'ĐÔNG BẮC BỘ'],
  danang: ['ĐÀ NẴNG', 'QUẢNG TRỊ', 'QUẢNG NGÃI', 'HUẾ', 'TRUNG BỘ', 'TRUNG TRUNG BỘ'],
  dalat: ['ĐÀ LẠT', 'LÂM ĐỒNG', 'TÂY NGUYÊN', 'CAO NGUYÊN TRUNG BỘ'],
  cantho: ['CẦN THƠ', 'HẬU GIANG', 'TÂY NAM BỘ', 'ĐỒNG BẰNG SÔNG CỬU LONG'],
  hcm: ['HỒ CHÍ MINH', 'NAM BỘ', 'ĐÔNG NAM BỘ'],
  nhatrang: ['NHA TRANG', 'KHÁNH HÒA', 'NAM TRUNG BỘ', 'PHÚ YÊN', 'NINH THUẬN'],
};

/** Mọi cảnh báo còn hiệu lực trong ngày trên toàn quốc, kèm chuyên mục. */
function nchmfFreshWarnings() {
  const out = [];
  for (const c of NCHMF.categories || []) {
    for (const w of c.warnings || []) {
      if (isEffective(w.iso)) out.push({ ...w, category: c.label, url: c.url });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));
}

/** Cảnh báo còn tươi mà tiêu đề nêu đích danh vùng của địa điểm đang xem. */
function nchmfWarningsFor(placeId) {
  const keys = NCHMF_REGIONS[placeId] || [];
  if (!keys.length) return [];
  return nchmfFreshWarnings().filter(w => {
    const T = (w.title || '').toUpperCase();
    return keys.some(k => T.includes(k));
  });
}

const LEVEL_VN = { red: 'ĐỎ', orange: 'CAM', info: 'TIN', stale: 'CŨ' };

/** Hôm nay theo giờ Việt Nam — mốc để xác định tin còn hiệu lực. */
function vnToday() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}
/** Tin còn hiệu lực trong ngày: phát hành hôm nay hoặc hôm qua. */
function isEffective(iso) {
  if (!iso) return false;
  const days = (Date.parse(vnToday()) - Date.parse(iso)) / 86400000;
  return days >= 0 && days <= 1;
}

/**
 * Panel chỉ giữ tin còn hiệu lực trong ngày: cảnh báo khớp vùng đang xem lên
 * trước, cảnh báo tươi nơi khác tiếp theo, chuyên mục hết hiệu lực gom gọn
 * thành một dòng link để khỏi chiếm chỗ mà vẫn tra cứu được.
 */
function renderNchmf() {
  const cats = NCHMF.categories || [];
  if (!NCHMF.collectedAt) {
    $('nchmfMeta').textContent = 'chưa có dữ liệu thu thập';
    $('nchmfList').innerHTML = '<p class="muted">Chạy <code>node collect-nchmf.mjs</code> trước khi build để có bản tin mới nhất.</p>';
    return;
  }
  const eff = [];
  for (const c of cats) {
    for (const w of c.warnings || []) {
      if (isEffective(w.iso)) eff.push({ ...w, category: c.label, url: c.url });
    }
  }
  const matched = eff.filter(w => {
    const keys = NCHMF_REGIONS[place.id] || [];
    const T = (w.title || '').toUpperCase();
    return keys.some(k => T.includes(k));
  });
  const others = eff.filter(w => !matched.includes(w));
  const stale = cats.filter(c =>
    !(c.warnings || []).some(w => isEffective(w.iso)) && !(c.docIso && isEffective(c.docIso)));
  const fmtW = w => `<div><span class="warn-chip ${w.level}">${LEVEL_VN[w.level] || ''}</span><strong>${esc(w.title)}</strong> <span class="tiny">${w.iso}${w.time ? ' ' + w.time : ''} · ${esc(w.category)}</span> <span class="meta"><a href="${w.url}" target="_blank" rel="noopener">bản tin gốc</a></span></div>`;
  $('nchmfMeta').textContent = 'thu thập ' +
    new Date(NCHMF.collectedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) +
    ` · ${eff.length} tin còn hiệu lực hôm nay`;
  let html = '';
  if (matched.length) html += `<h4>Cảnh báo cho vùng ${esc(place.name)}</h4>` + matched.map(fmtW).join('');
  if (others.length) html += `<h4>Cảnh báo nơi khác còn hiệu lực</h4>` + others.slice(0, 6).map(fmtW).join('');
  if (!eff.length) html += '<p class="muted">Hôm nay NCHMF không có cảnh báo nào còn hiệu lực. Bản tin định kỳ mới nhất vẫn xem được ở từng chuyên mục gốc.</p>';
  if (stale.length) {
    html += `<details><summary>${stale.length} chuyên mục đã hết hiệu lực trong ngày (bấm để xem bản tin gốc)</summary>` +
      stale.map(c => `<div class="nchmf-item"><h4><span class="warn-chip stale">CŨ</span>${esc(c.title)}</h4>` +
        `<div class="meta"><a href="${c.url}" target="_blank" rel="noopener">đọc bản tin gốc NCHMF</a></div></div>`).join('') + '</details>';
  }
  $('nchmfList').innerHTML = html;
}

/** Banner cảnh báo toàn quốc + dung hợp vào thông điệp rủi ro của địa điểm. */
function nchmfBannerFor(placeId) {
  const matched = nchmfWarningsFor(placeId);
  const box = $('officialBanner');
  if (!matched.length) {
    const anyRed = nchmfFreshWarnings().filter(w => w.level === 'red');
    box.innerHTML = anyRed.length
      ? `<div class="notice warning">NCHMF đang có ${anyRed.length} cảnh báo đỏ trên cả nước (không nêu đích danh vùng này): ${esc(anyRed[0].title.slice(0, 120))}… <a href="#officialBanner" onclick="document.querySelector('.official-panel').scrollIntoView({behavior:'smooth'});return false;">xem chi tiết</a></div>`
      : '';
    return [];
  }
  const worst = matched.some(w => w.level === 'red') ? 'red' : 'orange';
  box.innerHTML = `<div class="notice ${worst === 'red' ? 'error' : 'warning'}">` +
    `<strong>Cảnh báo chính thức (NCHMF) cho vùng này:</strong> ` +
    matched.slice(0, 2).map(w => esc(w.title.slice(0, 140))).join(' · ') +
    ` <a href="#officialBanner" onclick="document.querySelector('.official-panel').scrollIntoView({behavior:'smooth'});return false;">xem bản tin gốc</a></div>`;
  return matched;
}

/* ---------- verification view ---------- */

function initSelects() {
  $('testCity').innerHTML = report.locations.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  $('testVariable').innerHTML = VAR_LIST
    .map(v => `<option value="${v}">${esc(report.variables[v].label)}</option>`).join('');
  $('testLead').innerHTML = report.leads.map(l => `<option value="${l}">${l * 24} giờ</option>`).join('');
  $('verifyPeriod').textContent = `${report.period.start} → ${report.period.end}, huấn luyện tới ${report.split.trainEnd}, chấm từ ${report.split.testStart}`;
}

function currentTest() {
  const loc = report.locations.find(l => l.id === $('testCity').value);
  const v = $('testVariable').value, lead = Number($('testLead').value);
  return { loc, v, lead, t: loc?.tests.find(x => x.variable === v && x.lead === lead) };
}

/** Human label for a model family, plus what it means operationally. */
const FAMILY = {
  mean: { name: 'Trung bình đều', note: 'Trung bình mọi hệ thống, không hiệu chỉnh' },
  best: { name: 'Hệ thống đơn tốt nhất', note: 'Chỉ dùng một hệ thống, chọn trên cửa sổ huấn luyện' },
  nnls: { name: 'Kết hợp không âm (NNLS)', note: 'Trọng số không âm trên từng hệ thống' },
  emos: { name: 'EMOS hồi quy ridge', note: 'Hồi quy trên các hệ thống, độ lệch và điều hòa' },
};

function renderTest() {
  const { loc, v, lead, t } = currentTest();
  if (!loc || !t) {
    $('testSummary').innerHTML = '<div class="metric"><span class="small">Không có dữ liệu</span></div>';
    return;
  }
  const s = report.variables[v];
  if (!t.usable) {
    $('testSummary').innerHTML = `<div class="metric"><span class="small">${esc(s.label)} · ${lead * 24} giờ</span><strong>—</strong><small>${esc(t.note || 'không đủ dữ liệu')}</small></div>`;
    ['scoreBars', 'candTable', 'eventTable', 'reliability', 'rankHist', 'allVarsTable', 'probSummary', 'bootNote', 'threshNote'].forEach(id => { $(id).innerHTML = ''; });
    notice('testVerdict', 'Không đủ dữ liệu chung ở thời hạn này, không chấm điểm và không công bố độ chính xác.');
    return;
  }

  // headline
  const skillEq = E.finite(t.equalMean?.rmse) && t.equalMean.rmse > 0 ? 1 - t.mean.rmse / t.equalMean.rmse : null;
  const bestRmse = t.models?.length ? Math.min(...t.models.map(m => m.rmse).filter(E.finite)) : null;
  const cards = [
    ['Giờ kiểm tra', fmt(t.testN, 0), `Huấn luyện ${fmt(t.trainingN, 0)} giờ`],
    ['RMSE hiệu chỉnh', fmt(t.mean?.rmse, s.digits + 1), s.unit],
    ['So với trung bình đều', E.finite(skillEq) ? (skillEq >= 0 ? '+' : '') + fmt(skillEq * 100, 2) + '%' : '—', 'Dương: giảm RMSE'],
    ['So với hệ thống tốt nhất', E.finite(bestRmse) && bestRmse > 0 && E.finite(t.mean?.rmse) ? fmt((1 - t.mean.rmse / bestRmse) * 100, 2) + '%' : '—', 'Hệ thống đơn tốt nhất cùng giờ'],
    ['Số hệ thống dùng', fmt(t.models?.length ?? 0, 0), 'Đủ dữ liệu trên cửa sổ huấn luyện'],
    ['Độ phủ kiểm tra', pct(t.coverageTest), 'Giờ đủ / giờ trong khoảng'],
    ['Mô hình được chọn', FAMILY[t.selected?.family]?.name || (t.selected?.family ?? '—'), FAMILY[t.selected?.family]?.note || ''],
  ];
  if (t.kind === 'direction') {
    cards.splice(1, 3,
      ['Sai số góc', fmt(t.direction?.circularMae, 1) + '°', 'Sai lệch vòng cung trung bình'],
      ['Trong 30°', pct(t.direction?.within30, 1), 'Tỉ lệ giờ đúng hướng'],
      ['Trong 45°', pct(t.direction?.within45, 1), 'Tỉ lệ giờ đúng hướng'],
      ['Sai số vector', fmt(t.direction?.vectorRmse, 2), 'km/h trên mặt phẳng u-v'],
    );
  }
  if (t.kind === 'code') {
    cards.splice(1, 4,
      ['Trùng tuyệt đối', pct(t.accuracy, 1), 'Đúng mã WMO'],
      ['Trùng nhóm thời tiết', pct(t.accuracyGroup, 1), 'Cùng nhóm mô tả'],
      ['Số mẫu', fmt(t.testN ?? 0, 0), 'Giờ kiểm tra'],
      ['Phương pháp', 'kNN', esc((t.method || '').slice(0, 40) + '…')],
    );
  }
  $('testSummary').innerHTML = cards.map(([l, val, note]) =>
    `<div class="metric"><span class="small">${l}</span><strong>${val}</strong><small>${note}</small></div>`).join('');

  // Score bars. Only variables with a continuous forecast have per-system RMSE;
// direction and code are reported through their own angular or categorical
// scores above, so an empty chart here is correct rather than a gap.
  const scored = (t.models || []).map(m => ({ name: m.name, v: m.rmse }));
  if (E.finite(t.equalMean?.rmse)) scored.push({ name: 'Trung bình đều', v: t.equalMean.rmse });
  if (E.finite(t.mean?.rmse)) scored.push({ name: 'Hiệu chỉnh EMOS', v: t.mean.rmse, featured: true });
  if (E.finite(t.persistence?.rmse)) scored.push({ name: 'Tr persistence', v: t.persistence.rmse });
  const usable = scored.filter(o => E.finite(o.v));
  const maxV = Math.max(...usable.map(x => x.v), 1e-9);
  $('scoreBars').innerHTML = usable.length
    ? usable.map(o => `
    <div class="bar-row${o.featured ? ' featured' : ''}"><span>${esc(o.name)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${(o.v / maxV) * 100}%"></div></div>
    <strong>${fmt(o.v, s.digits + 1)}</strong></div>`).join('')
    : `<p class="muted">${t.kind === 'direction'
      ? 'Hướng gió không có RMSE so sánh được giữa các hệ thống vì nó là đại lượng vòng; dùng sai số góc và tỉ lệ trong 30°/45° ở trên.'
      : 'Mã thời tiết là biến phân loại nên không có RMSE; dùng độ chính xác tuyệt đối và theo nhóm ở trên.'}</p>`;

  // Verdict. Direction and code are scored by their own metrics, so the
  // RMSE-improvement sentence does not apply to them.
  const verdictFor = () => {
    if (t.kind === 'direction') {
      const d = t.direction;
      return `Sai số hướng trung bình ${fmt(d?.circularMae, 1)}°, đúng hướng trong 30° ở ${pct(d?.within30, 1)} giờ kiểm tra. Chỉ áp dụng cho địa điểm, biến và giai đoạn đã kiểm thử.`;
    }
    if (t.kind === 'code') {
      const r = t.regime;
      return `Trùng mã WMO ${pct(t.accuracy, 1)}, trùng nhóm thời tiết ${pct(t.accuracyGroup, 1)}. ` +
        (r && E.finite(r.accuracy)
          ? `Bảng tra vùng dùng trong trang này đạt ${pct(r.accuracy, 1)} trên ${fmt(r.lookupN ?? 0, 0)} giờ, thấp hơn bộ phân loại kNN gốc vì bảng bị nén.`
          : 'Chỉ áp dụng cho địa điểm, biến và giai đoạn đã kiểm thử.');
    }
    if (!E.finite(t.mean?.rmse)) return 'Không chấm được điểm ở thời hạn này.';
    const better = E.finite(skillEq) && skillEq > 0;
    return better
      ? `Trong phép thử này hiệu chỉnh giảm RMSE ${fmt(skillEq * 100, 2)}% so với trung bình đều. Kết quả chỉ áp dụng cho địa điểm, biến và giai đoạn đã kiểm thử.`
      : 'Trong phép thử này hiệu chỉnh không giảm RMSE so với trung bình đều. Chưa có cơ sở khẳng định vượt mô hình.';
  };
  const bad = (t.kind === 'direction' || t.kind === 'code')
    ? false
    : !(E.finite(skillEq) && skillEq > 0);
  notice('testVerdict', verdictFor(), bad ? 'warning' : '');

  // Bootstrap applies to continuous variables only.
  const boot = t.bootstrap?.vsEqualMean;
  $('bootNote').textContent = boot
    ? `Bootstrap khối (${boot.reps} lần, khối ${boot.blockHours} giờ): chênh lệch RMSE ${fmt(boot.deltaRmse, s.digits + 1)} ${s.unit}, khoảng 95% [${fmt(boot.ci95[0], s.digits + 1)}, ${fmt(boot.ci95[1], s.digits + 1)}], xác suất cải thiện ${pct(boot.probImprovement)}.`
    : t.kind === 'direction'
      ? 'Bootstrap RMSE không áp dụng cho hướng gió; sai số góc đã báo ở trên là thang đo phù hợp.'
      : 'Không đủ dữ liệu cho bootstrap.';

  // candidates
  $('candTable').innerHTML = (t.candidates || []).map(c => {
    const fam = FAMILY[c.family]?.name || c.family;
    const note = FAMILY[c.family]?.note || '';
    return `<tr${c.chosen ? ' class="chosen"' : ''}><td>${esc(fam)}${c.chosen ? ' ✓' : ''}` +
      `<br><span class="tiny">${esc(note)}</span></td>` +
      `<td>${c.lambda ?? '—'}</td><td>${fmt(c.cvRmse, s.digits + 1)}</td>` +
      `<td class="tiny">${E.finite(c.cvGap) ? fmt(c.cvGap, s.digits + 1) : '—'}</td></tr>`;
  }).join('');
  if (t.selected) {
    $('candNote').textContent =
      `Chọn theo quy tắc một sai số chuẩn ghép cặp: chọn mô hình đơn giản nhất mà chênh lệch với ứng viên dẫn đầu (${FAMILY[t.selected.bestCvFamily]?.name || t.selected.bestCvFamily}) không vượt sai số chuẩn ${fmt(t.selected.cvStandardError, s.digits + 1)} ${s.unit}.`;
  }

  // events
  const ths = Object.keys(t.events || {});
  $('threshNote').textContent = ths.length
    ? `${s.label} · ngưỡng theo đơn vị ${s.unit}. CSI đo số lần đúng trên tổng đúng+bỏ sót+báo sai; BSS dương nghĩa là xác suất tốt hơn tần suất gốc.`
    : 'Biến này không có ngưỡng sự kiện.';
  $('eventTable').innerHTML = ths.map(th => {
    const e = t.events[th];
    const m = e.median, p = e.probability;
    return `<tr><td>${th} ${esc(s.unit)}</td><td>${fmt(m.csi, 3)}</td><td>${pct(m.pod, 1)}</td><td>${pct(m.far, 1)}</td><td>${fmt(p.brier, 4)}</td><td>${E.finite(p.bss) ? fmt(p.bss, 3) : '—'}</td></tr>`;
  }).join('');

  // probabilistic summary
  const pr = t.probabilistic;
  if (pr && pr.n) {
    $('probSummary').innerHTML = [
      ['CRPS', fmt(pr.crps, s.digits + 1), s.unit],
      ['Pinball 50%', fmt(pr.pinball?.p50, s.digits + 1), s.unit],
      ['Pinball 10/90', fmt(pr.pinball?.p10, s.digits + 1) + ' / ' + fmt(pr.pinball?.p90, s.digits + 1), s.unit],
      ['Độ rộng', fmt(pr.spread, s.digits + 1), 'độ lệch chuẩn'],
      ['Độ rộng/sai số', fmt(pr.spreadSkill, 2), '~1 là hiệu chuẩn'],
    ].map(([l, v2, note]) => `<div class="metric"><span class="small">${l}</span><strong>${v2}</strong><small>${note}</small></div>`).join('');
  } else {
    $('probSummary').innerHTML = '<div class="metric"><span class="small">Không có thang đo xác suất</span></div>';
  }

  // reliability
  const rel = ths.length ? t.events[ths[0]].probability.reliability : [];
  $('reliability').innerHTML = rel.length
    ? '<svg viewBox="0 0 320 200" role="img" aria-label="Độ tin cậy dự báo xác suất">'
    + '<line x1="34" y1="10" x2="34" y2="170" stroke="#526474"/><line x1="34" y1="170" x2="300" y2="170" stroke="#526474"/>'
    + '<line x1="34" y1="170" x2="300" y2="10" stroke="#cfd8e0" stroke-dasharray="4 3"/>'
    + rel.map(b => {
      const cx = 34 + b.forecast * 266, cy = 170 - b.observed * 160;
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.min(6, 2 + b.n / 40).toFixed(1)}" fill="#2869b8"><title>${b.forecast.toFixed(2)} dự báo / ${b.observed.toFixed(2)} quan sát / ${b.n} giờ</title></circle>`;
    }).join('')
    + '<text x="167" y="192" text-anchor="middle" font-size="12" fill="#526474">Xác suất dự báo</text>'
    + '<text x="14" y="90" font-size="12" fill="#526474" transform="rotate(-90 14 90)" text-anchor="middle">Tần suất quan sát</text>'
    + '</svg>'
    : '<p class="muted">Không có bảng độ tin cậy cho biến này.</p>';

  // Direction and code produce no calibrated distribution, so the probabilistic
  // panels say so instead of showing empty charts.
  const hasProb = pr && pr.n && t.kind !== 'direction' && t.kind !== 'code';
  if (!hasProb) {
    $('reliability').innerHTML = '<p class="muted">Không có bảng độ tin cậy cho biến này.</p>';
    $('rankHist').innerHTML = '<p class="muted">Không có phân phối hiệu chỉnh cho biến này.</p>';
    renderAllVars(loc);
    return;
  }

  // rank histogram
  if (pr && pr.rankHistogram) {
    const h = pr.rankHistogram;
    const mx = Math.max(...h, 0.001);
    $('rankHist').innerHTML = '<div class="rank-cols">' + h.map((val, i) =>
      `<div class="rank-col" title="Khoảng ${i}: ${pct(val, 1)}"><div class="rank-bar" style="height:${(val / mx) * 100}%"></div><span>${i}</span></div>`).join('') + '</div>'
      + `<p class="small">Sai lệch so với phân phối đều: <strong>${fmt(pr.rankDeviation, 3)}</strong> (0 là hoàn hảo). Độ rộng trung bình ${fmt(pr.rangeMean, s.digits + 1)} ${s.unit}.</p>`;
  } else {
    $('rankHist').innerHTML = '<p class="muted">Không có phân hoạch đứng hạng.</p>';
  }

  renderAllVars(loc);
}

function renderAllVars(loc) {
  $('allVarsTable').innerHTML = loc.tests.filter(t => t.usable).map(t => {
    const s = report.variables[t.variable];
    const cell = (x) => `<td>${E.finite(x) ? fmt(x, s.digits + 1) : '—'}</td>`;
    // Direction and code have no RMSE, so the table shows their native score.
    if (t.kind === 'direction') {
      return `<tr><td>${esc(s.label)}</td><td>${t.lead * 24} h</td><td>${t.models?.length ?? 0}</td>` +
        `<td>${fmt(t.direction?.circularMae, 1)}°</td><td>sai số góc</td>` +
        `<td>${pct(t.direction?.within30, 1)}</td><td>trong 30°</td></tr>`;
    }
    if (t.kind === 'code') {
      return `<tr><td>${esc(s.label)}</td><td>${t.lead * 24} h</td><td>${t.models?.length ?? 0}</td>` +
        `<td>${pct(t.accuracy, 1)}</td><td>trùng mã</td>` +
        `<td>${pct(t.accuracyGroup, 1)}</td><td>trùng nhóm</td></tr>`;
    }
    const skill = E.finite(t.equalMean?.rmse) && t.equalMean.rmse > 0 ? 1 - t.mean.rmse / t.equalMean.rmse : null;
    return `<tr><td>${esc(s.label)}</td><td>${t.lead * 24} h</td><td>${t.models?.length ?? 0}</td>` +
      cell(t.mean?.rmse) + cell(t.equalMean?.rmse) +
      `<td class="${E.finite(skill) && skill > 0 ? 'pos' : 'neg'}">${E.finite(skill) ? (skill >= 0 ? '+' : '') + fmt(skill * 100, 1) + '%' : '—'}</td>` +
      cell(t.probabilistic?.crps) + `</tr>`;
  }).join('');
}

function renderProtocol() {
  const h = report.headline;
  const items = [
    ['Phương pháp', 'EMOS hồi quy ridge trên 7 hệ thống + độ lệch + 2 biến phụ + điều hòa ngày đêm/năm.'],
    ['Chọn mô hình', `Kiểm chứng chặn 8 khối mở rộng dần trong cửa sổ huấn luyện, rồi quy tắc một sai số chuẩn ghép cặp chọn mô hình đơn giản nhất còn tương đương. Họ được chọn: ${JSON.stringify(h.familyChosen)}.`],
    ['Chuẩn hoá xác suất', 'Phương sai phần dư = alpha + beta × độ lệch², rồi 51 thành viên giả tạo tất định.'],
    ['Tách dữ liệu', `Huấn luyện ≤ ${report.split.trainEnd}, bỏ trống ${report.split.purgeDays} ngày, chấm từ ${report.split.testStart}. Không tinh chỉnh trên tập kiểm tra.`],
    ['Kết quả tổng', `${h.evaluated} phép chấm; ${h.betterThanEqualWeight} tốt hơn trung bình đều; ${h.betterThanBestSingle} tốt hơn hệ thống đơn tốt nhất.`],
    ['Ý nghĩa thống kê', `Bootstrap khối: ${h.significantImprovementVsEqualWeight} phép cải thiện có xác suất ≥90% so với trung bình đều.`],
  ];
  $('protocol').innerHTML = items.map(([k, v]) => `<div><span>${k}</span><strong>${esc(v)}</strong></div>`).join('');
  $('protocol').insertAdjacentHTML('beforeend',
    `<p class="small">${esc(report.method)}</p><p class="small">${esc(report.ensembleMethod)}</p>`);
}

/* ---------- exports, search, wiring ---------- */

function download(name, text, type) {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

/** Flat CSV: calibrated median plus p10/p90, then every raw system column. */
function exportForecast() {
  if (!live) return;
  const times = activeTimes(live.base);
  const offsets = forecastOffsetSeries(times);
  const raw = {};
  for (const v of LIVE_VARS) {
    raw[v] = MODELS.map(m => seriesFor(live.byId[m.id], v, times));
  }
  const header = ['time_local', 'timezone', 'hours_ahead'];
  for (const v of LIVE_VARS) {
    const d = report.variables[v].digits;
    header.push(`${v}_median`, `${v}_p10`, `${v}_p90`);
    MODELS.forEach(m => header.push(`${v}_${m.id}`));
  }
  const lines = [header.join(',')];
  times.forEach((t, i) => {
    const row = [t, live.base.timezone, Math.round(offsets[i])];
    for (const v of LIVE_VARS) {
      const d = report.variables[v].digits;
      const c = calFor(v).series[i];
      const put = x => (E.finite(x) ? x.toFixed(d) : '');
      row.push(put(c?.median), put(c?.p10), put(c?.p90));
      for (const arr of raw[v]) row.push(put(arr[i]));
    }
    lines.push(row.join(','));
  });
  download('atmos-forecast.csv', '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8');
}

// icebreaker: remove the dead duplicate hook and wire the disaster-aware tab handler once.

let searchRequest = 0;

/**
 * Tìm địa danh từ 2 nguồn bổ sung nhau: Open-Meteo nhanh và nhãn tiếng Việt
 * tốt, OpenStreetMap/Nominatim phủ sâu tới xã/phường và địa danh nhỏ toàn cầu.
 * Trả về danh sách đã khử trùng theo lưới ~1 km (ưu tiên Open-Meteo khi trùng).
 */
async function searchPlaces(q) {
  const [om, osm] = await Promise.allSettled([
    api('https://geocoding-api.open-meteo.com/v1/search', {
      name: q, count: 8, language: 'vi', format: 'json',
    }),
    (async () => {
      const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q, format: 'jsonv2', limit: '8', 'accept-language': 'vi', addressdetails: '1',
      }), { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('OpenStreetMap ' + r.status);
      return r.json();
    })(),
  ]);
  const items = [];
  if (om.status === 'fulfilled') {
    for (const r of om.value.results || []) {
      items.push({
        key: `om-${r.id}`, name: r.name,
        sub: [r.admin2, r.admin1, r.country].filter(Boolean).join(' · '),
        lat: r.latitude, lon: r.longitude, source: 'Open-Meteo',
      });
    }
  }
  if (osm.status === 'fulfilled') {
    for (const r of osm.value || []) {
      const a = r.address || {};
      const admin = [a.suburb || a.village || a.town || a.city_district, a.county || a.state_district, a.state, a.country].filter(Boolean).join(' · ');
      items.push({
        key: `osm-${r.place_id}`, name: (r.namedetails?.name || r.name || '').split(',')[0] || 'Địa điểm',
        sub: admin || r.display_name.split(',').slice(1, 3).join(','),
        lat: Number(r.lat), lon: Number(r.lon), source: 'OpenStreetMap',
      });
    }
  }
  const seen = new Set();
  const uniq = items.filter(it => {
    if (!E.finite(it.lat) || !E.finite(it.lon)) return false;
    const k = Math.round(it.lat * 100) + ':' + Math.round(it.lon * 100);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);
  const errors = [om.status === 'rejected' ? 'Open-Meteo: ' + om.reason.message : null,
    osm.status === 'rejected' ? 'OpenStreetMap: ' + osm.reason.message : null].filter(Boolean);
  return { items: uniq, errors };
}

function emptySearchHint(q) {
  return 'Không tìm thấy địa điểm cho "' + q + '". Thử tên không dấu, tên xã/phường kèm huyện/tỉnh, hoặc tên tiếng Anh (ví dụ: "Tan Lap, Dan Phuong" hay "Zermatt").';
}

function initSearch() {
  $('searchForm').onsubmit = async e => {
    e.preventDefault();
    const token = ++searchRequest;
    const q = $('search').value.trim();
    $('searchResults').textContent = 'Đang tìm trong 2 nguồn dữ liệu địa danh…';
    try {
      const { items, errors } = await searchPlaces(q);
      if (token !== searchRequest) return;
      $('searchResults').innerHTML = '';
      if (!items.length) {
        $('searchResults').textContent = errors.length
          ? 'Cả hai nguồn đều lỗi (' + errors.join('; ') + '). Kiểm tra kết nối rồi thử lại.'
          : emptySearchHint(q);
        return;
      }
      const meta = document.createElement('p');
      meta.className = 'small';
      meta.textContent = `Tìm thấy ${items.length} kết quả cho "${q}" (Open-Meteo + OpenStreetMap).`;
      $('searchResults').append(meta);
      items.forEach(it => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `${esc(it.name)} <span class="tiny">${esc(it.sub)} · ${esc(it.source)}</span>`;
        b.onclick = () => {
          place = { id: 'geo-' + it.key, name: it.name, lat: it.lat, lon: it.lon, utcOffset: Math.round(it.lon / 15) };
          $('searchResults').innerHTML = '';
          loadForecast();
        };
        $('searchResults').append(b);
      });
    } catch (err) {
      $('searchResults').textContent = 'Không tìm được địa điểm: ' + err.message;
    }
  };
}

/* ---------- boot ---------- */

$('chartVariable').innerHTML = LIVE_VARS.map(v =>
  `<option value="${v}">${esc(report.variables[v].label)} · ${esc(report.variables[v].unit)}</option>`).join('');
$('headModels').textContent = `${MODELS.length} HỆ THỐNG · ${LIVE_VARS.length} BIẾN`;
$('introNote').innerHTML = `Mỗi giá trị kèm dải 10–90% và xác suất vượt ngưỡng.<br>Tập kiểm tra: <strong>${fmt(report.headline.betterThanEqualWeight)}/${report.headline.evaluated}</strong> phép chấm tốt hơn trung bình đều.`;

/* ---------- disaster tab: radar + live alerts ---------- */

let radarMap = null, radarLayer = null, alertLayer = null, radarInitialized = false;
// Vị trí mà tab thiên tai đang theo dõi. Mặc định bám vị trí dự báo; khi người
// dùng bấm chip khác thì giữ nguyên cho tới khi bấm lại "Vị trí dự báo".
let disasterLoc = null, disasterFollow = true;

// Điểm ghim nhanh: 7 tỉnh/thành Việt Nam + 4 thành phố thế giới hay chịu bão/lụt.
const DISASTER_PRESETS = [
  { id: 'hanoi', name: 'Hà Nội', lat: 21.0285, lon: 105.8542 },
  { id: 'haiphong', name: 'Hải Phòng', lat: 20.86, lon: 106.68 },
  { id: 'danang', name: 'Đà Nẵng', lat: 16.0544, lon: 108.2022 },
  { id: 'nhatrang', name: 'Nha Trang', lat: 12.2395, lon: 109.196 },
  { id: 'hcm', name: 'TP. Hồ Chí Minh', lat: 10.8231, lon: 106.6297 },
  { id: 'cantho', name: 'Cần Thơ', lat: 10.0452, lon: 105.7469 },
  { id: 'dalat', name: 'Đà Lạt', lat: 11.9469, lon: 108.4583 },
  { id: 'bangkok', name: 'Bangkok', lat: 13.7563, lon: 100.5018 },
  { id: 'manila', name: 'Manila', lat: 14.5995, lon: 120.9842 },
  { id: 'tokyo', name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { id: 'jakarta', name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
];

/** Radar và cảnh báo luôn gắn với vị trí đang dự báo, không phải một nơi cố định. */
function syncDisasterToPlace() {
  if (disasterFollow || !disasterLoc) {
    disasterLoc = { name: place.name, lat: place.lat, lon: place.lon };
  }
  renderDisasterChips();
  applyDisasterLoc(false);
}

/** Vẽ chip vị trí + áp dụng vị trí thiên tai hiện tại lên ghi chú, link, radar. */
function renderDisasterChips() {
  const box = $('disasterChips');
  if (!box) return;
  box.innerHTML =
    `<button class="chip${disasterFollow ? ' selected' : ''}" data-dloc="__forecast">📍 Vị trí dự báo: ${esc(disasterFollow ? disasterLoc?.name || place.name : place.name)}</button>` +
    DISASTER_PRESETS.map(p =>
      `<button class="chip${!disasterFollow && disasterLoc?.name === p.name ? ' selected' : ''}" data-dloc="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  box.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      if (b.dataset.dloc === '__forecast') {
        disasterFollow = true;
        disasterLoc = { name: place.name, lat: place.lat, lon: place.lon };
      } else {
        const p = DISASTER_PRESETS.find(x => x.id === b.dataset.dloc);
        if (!p) return;
        disasterFollow = false;
        disasterLoc = { name: p.name, lat: p.lat, lon: p.lon };
      }
      renderDisasterChips();
      applyDisasterLoc(true);
    };
  });
}

/** Đẩy vị trí thiên tai ra ghi chú, link Windy, tâm bản đồ và danh sách cảnh báo. */
function applyDisasterLoc(reloadAlerts) {
  const loc = disasterLoc || { name: place.name, lat: place.lat, lon: place.lon };
  const note = $('disasterPlaceNote');
  if (note) note.textContent = `Radar, liên kết bão/lụt và cảnh báo dưới đây tính cho: ${loc.name} (${fmt(loc.lat, 2)}°, ${fmt(loc.lon, 2)}°).`;
  const wl = $('windyLink');
  if (wl) wl.href = `https://www.windy.com/${loc.lat.toFixed(3)}/${loc.lon.toFixed(3)}`;
  if (radarMap) {
    radarMap.setView([loc.lat, loc.lon], Math.max(radarMap.getZoom(), 5));
    drawDisasterPin();
  }
  if (reloadAlerts) loadAlerts();
}

/** Ghim vị trí đang xem trên bản đồ radar. */
function drawDisasterPin() {
  if (!radarMap || !disasterLoc) return;
  if (drawDisasterPin._pin) { try { radarMap.removeLayer(drawDisasterPin._pin); } catch (e) { /* bỏ qua */ } }
  drawDisasterPin._pin = L.marker([disasterLoc.lat, disasterLoc.lon], {
    title: disasterLoc.name,
  }).addTo(radarMap).bindTooltip(esc(disasterLoc.name));
}

/**
 * Real-time precipitation radar, composited from RainViewer's public raster
 * tiles over an OpenStreetMap base. This is a separate, explicitly labelled
 * live product — it is NOT part of the calibrated multi-variable forecast.
 */
async function initRadar() {
  if (radarInitialized) return;
  radarInitialized = true;
  const cl = disasterLoc || { lat: place.lat, lon: place.lon };
  const center = [cl.lat, cl.lon];

  if (typeof L === 'undefined') {
    $('radarMsg').textContent = 'Không tải được thư viện bản đồ (leaflet). Kiểm tra kết nối mạng.';
    return;
  }
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('rainviewer ' + res.status);
    const data = await res.json();
    const frames = [...(data.radar?.past || []), ...(data.radar?.nowcast || [])];
    if (!frames.length) throw new Error('no radar frames');

    radarMap = L.map('radarMap', {
      center, zoom: 6, minZoom: 2, maxZoom: 18, worldCopyJump: true, attributionControl: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; RainViewer',
    }).addTo(radarMap);

    const latest = frames[frames.length - 1];
    // Tile radar thật chỉ tới zoom 7: từ zoom 8 trở lên server trả ô trống.
    // Dùng tile 512px (nét hơn) + maxNativeZoom để Leaflet phóng to thay vì xin ô trống.
    radarLayer = L.tileLayer(
      `${data.host}${latest.path}/512/{z}/{x}/{y}/2/1_1.png`,
      { tileSize: 512, zoomOffset: -1, maxNativeZoom: 7, maxZoom: 18, opacity: 0.7, attribution: 'RainViewer' },
    ).addTo(radarMap);
    alertLayer = L.layerGroup().addTo(radarMap);
    drawDisasterPin();
    $('radarMsg').textContent = 'Radar hiện tại · khung ' +
      new Date(latest.time * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) +
      ' (ICT).';
  } catch (e) {
    $('radarMsg').textContent = 'Không tải được radar: ' + e.message + '. Tải lại khi có mạng.';
  }
}

async function loadAlerts() {
  const loc = disasterLoc || { name: place.name, lat: place.lat, lon: place.lon };
  $('alertsList').innerHTML = '<p class="muted">Đang lấy dữ liệu từ USGS…</p>';
  try {
    const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson', {
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json();
    const features = (j.features || []).map(f => {
      const [lon, lat] = f.geometry?.coordinates || [null, null];
      return { f, km: E.finite(lat) && E.finite(lon) ? E.distanceKm(loc, { lat, lon }) : null, lat, lon };
    });
    $('alertsMeta').textContent = `${features.length} sự kiện · USGS · 30 ngày · tính từ ${loc.name}`;
    if (alertLayer) alertLayer.clearLayers();
    if (!features.length) { $('alertsList').innerHTML = '<p class="muted">Không có sự kiện USGS trong 30 ngày.</p>'; return; }
    const sevColor = mag => (mag >= 6 ? 'red' : mag >= 5 ? 'orange' : mag >= 4.5 ? 'yellow' : 'green');
    const mapColor = { red: '#c0392b', orange: '#e67e22', yellow: '#f1c40f', green: '#27ae60' };
    const NEAR_KM = 1000;
    const ranked = features.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9)).slice(0, 25);
    if (alertLayer && typeof L !== 'undefined') {
      for (const { f, lat, lon } of ranked) {
        if (!E.finite(lat) || !E.finite(lon)) continue;
        const p = f.properties;
        L.circleMarker([lat, lon], {
          radius: Math.min(12, 4 + p.mag), color: mapColor[sevColor(p.mag)],
          weight: 2, fillOpacity: 0.55,
        }).addTo(alertLayer)
          .bindPopup(`<strong>M${p.mag.toFixed(1)} · ${esc(p.place)}</strong><br><a href="${p.url}" target="_blank" rel="noopener">chi tiết USGS</a>`);
      }
      drawDisasterPin();
    }
    $('alertsList').innerHTML = ranked.map(({ f, km }) => {
      const p = f.properties;
      const when = new Date(p.time).toLocaleString('vi-VN', { timeZone: 'UTC' });
      const near = km !== null && km < NEAR_KM;
      return `<div class="alert-item ${sevColor(p.mag)}">` +
        `<h4>${p.mag.toFixed(1)} · ${esc(p.place)}${near ? ' <span class="near-badge">GẦN VỊ TRÍ ĐANG XEM</span>' : ''}</h4>` +
        `<p>Cách ${esc(loc.name)} khoảng ${km !== null ? fmt(km, 0) + ' km' : 'không rõ'} · ${when} UTC.</p>` +
        `<div class="meta">USGS · <a href="${p.url}" target="_blank" rel="noopener">chi tiết sự kiện</a></div>` +
        `</div>`;
    }).join('');
  } catch (e) {
    $('alertsList').innerHTML = `<p class="muted">Không lấy được USGS: ${esc(e.message)}. Fox News / GDACS xem link bên phải.</p>`;
    $('alertsMeta').textContent = 'lỗi tải';
  }
}

function initDisasterTab() {
  renderDisasterChips();
  initDisasterSearch();
  $('disasterRefreshRadar').onclick = () => {
    if (radarMap) { try { radarMap.remove(); } catch (e) { /* bỏ qua */ } radarMap = null; }
    document.getElementById('radarMap').innerHTML = '<div id="radarMsg" class="notice">Đang tải lại radar…</div>';
    radarInitialized = false;
    initRadar();
  };
  $('disasterLoadAlerts').onclick = loadAlerts;
}

/**
 * Tìm vị trí radar/cảnh báo tùy ý: dùng chung 2 nguồn địa danh với ô tìm kiếm
 * chính. Chọn kết quả nào, radar + liên kết bão/lụt + cảnh báo theo ngay nơi đó.
 */
let disasterSearchRequest = 0;
function initDisasterSearch() {
  $('disasterSearchForm').onsubmit = async e => {
    e.preventDefault();
    const token = ++disasterSearchRequest;
    const q = $('disasterSearch').value.trim();
    $('disasterSearchResults').textContent = 'Đang tìm trong 2 nguồn dữ liệu địa danh…';
    try {
      const { items, errors } = await searchPlaces(q);
      if (token !== disasterSearchRequest) return;
      $('disasterSearchResults').innerHTML = '';
      if (!items.length) {
        $('disasterSearchResults').textContent = errors.length
          ? 'Cả hai nguồn đều lỗi (' + errors.join('; ') + '). Kiểm tra kết nối rồi thử lại.'
          : emptySearchHint(q);
        return;
      }
      const meta = document.createElement('p');
      meta.className = 'small';
      meta.textContent = `Tìm thấy ${items.length} kết quả cho "${q}" — chọn một nơi để xem radar và cảnh báo.`;
      $('disasterSearchResults').append(meta);
      items.forEach(it => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `${esc(it.name)} <span class="tiny">${esc(it.sub)} · ${esc(it.source)}</span>`;
        b.onclick = () => {
          disasterFollow = false;
          disasterLoc = { name: it.name, lat: it.lat, lon: it.lon };
          $('disasterSearchResults').innerHTML = '';
          renderDisasterChips();
          applyDisasterLoc(true);
        };
        $('disasterSearchResults').append(b);
      });
    } catch (err) {
      $('disasterSearchResults').textContent = 'Không tìm được địa điểm: ' + err.message;
    }
  };
}

/* ---------- tab wiring (extended) ---------- */

function wireTabs() {
  document.querySelectorAll('.tab').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.view').forEach(x => { x.hidden = x.id !== b.dataset.view; });
      if (b.dataset.view === 'disaster') {
        initRadar();
        // Ensure the Leaflet map sizes itself once the view is visible.
        setTimeout(() => { if (radarMap) radarMap.invalidateSize(); }, 120);
      }
    };
  });
}

wireTabs();
initDisasterTab();

initSelects();
initSearch();
quickRender();
renderNchmf();
renderProtocol();
renderTest();
loadForecast();
