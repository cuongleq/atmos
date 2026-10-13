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
  let url = base + '?' + new URLSearchParams(params);
  // Không dùng proxy trung gian nữa vì 8 request đồng thời sẽ làm treo proxy và gây đứng UI
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok || j.error) {
      throw new Error(j.reason || 'Nguồn dữ liệu trả về lỗi ' + r.status);
    }
    return j;
  } catch (e) {
    throw e;
  }
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

function menuPlaces() {
  return [...report.locations, ...(report.pinnedPlaces || [])];
}

function quickRender() {
  $('quick').innerHTML = menuPlaces()
    .map(l => {
      const pinned = !(report.pinnedPlaces || []).length ? '' : ((report.pinnedPlaces || []).some(p => p.id === l.id)
        ? ' data-pinned="1" title="Chưa có hiệu chỉnh riêng — dự báo trung bình nhiều mô hình"'
        : ' title="Đã có hiệu chỉnh riêng"');
      return `<button data-city="${l.id}" class="${place.id === l.id ? 'selected' : ''}"${pinned}>${esc(l.name)}</button>`;
    }).join('');
  $('quick').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const found = menuPlaces().find(l => l.id === b.dataset.city);
      if (found) { place = { ...found }; loadForecast(); }
    };
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
  if (results[0].status !== 'fulfilled') throw results[0].reason;
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

  try {
    const fc = await fetchPlaceData(place);
    if (token !== requestId) return;
    live = fc;
  } catch (err) {
    if (token !== requestId) return;
    console.error(err);
    const msg = err.message || '';
    if (msg.includes('429') || msg.toLowerCase().includes('limit exceeded') || msg.includes('403') || msg.includes('bị chặn')) {
      notice('liveStatus', 'Đã hết lượt API miễn phí của Open-Meteo (10,000 lượt/ngày) do lượng truy vấn lớn. Lỗi 403/429. Xin thử lại vào ngày mai.', 'error');
    } else {
      notice('liveStatus', 'Không tải được dự báo: ' + msg + '. Kiểm tra kết nối rồi chọn Cập nhật.', 'error');
    }
    $('condition').textContent = 'Chưa có dữ liệu';
    $('chart').textContent = 'Không có dữ liệu trực tiếp.';
    $('days').textContent = 'Không có dữ liệu.';
    $('paramGrid').innerHTML = '<p class="muted">Không có dữ liệu trực tiếp.</p>';
    return;
  }
  calCache.clear();
  try {
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
    loadAirMassAndRivers();
    syncDisasterToPlace();
  } catch (err) {
    console.error('Lỗi khi hiển thị dữ liệu:', err);
    notice('liveStatus', 'Lỗi hiển thị dữ liệu: ' + err.message + '. Vui lòng báo cáo lỗi này.', 'error');
    $('condition').textContent = 'Lỗi dữ liệu';
  }
}

/* ---------- air mass, trajectory and rivers ---------- */

// Các biến mức áp lực 850/500 hPa. Đây là mặt đất điều khiển không khí: nhiệt độ
// và độ dày cột không khí cho biết khối không là lạnh hay nóng, và gió 850 hPa
// cho biết nó đi đâu tới.
const LEVEL_VARS = [
  'temperature_850hPa', 'geopotential_height_850hPa', 'geopotential_height_500hPa',
  'wind_speed_850hPa', 'wind_direction_850hPa', 'relative_humidity_850hPa',
];
const LEVEL_MODELS = MODELS.map(m => m.id);

let levelsToken = 0;
let levels = null;
let rivers = null;
let riverSel = 0;

/**
 * Lấy các trường mức áp lực cho cả bảy hệ thống trong một request. Open-Meteo
 * tra ve mot doi tuong duy nhat voi ten bien co hau to ten mo hinh.
 */
async function fetchLevels() {
  const u = new URLSearchParams({
    latitude: place.lat, longitude: place.lon,
    hourly: LEVEL_VARS.join(','),
    models: LEVEL_MODELS.join(','),
    past_days: 7, forecast_days: 7, timezone: 'auto',
  });
  const j = await api('https://api.open-meteo.com/v1/forecast', Object.fromEntries(u.entries()));
  const hourly = j.hourly || {};
  const series = {};
  for (const id of LEVEL_MODELS) {
    const cols = {};
    for (const v of LEVEL_VARS) cols[v] = hourly[v + '_' + id] || null;
    if (Object.values(cols).some(c => c && c.length)) series[id] = cols;
  }
  return { time: hourly.time || [], series, offsetSeconds: j.utc_offset_seconds || 0 };
}

/**
 * Chỉ số của giờ hiện tại trong chuỗi giờ. Chuỗi của Open-Meteo bắt đầu lúc
 * 00:00 tại địa điểm và chạy tới cuối chu kỳ dự báo, nên "hiện tại" nằm ở đầu
 * chuỗi chứ không phải ở cuối. Dùng mốc lệch giờ của chính nguồn để tìm.
 */
function levelNowIndex() {
  if (!levels || !levels.time.length) return null;
  const local = new Date(Date.now() + (levels.offsetSeconds || 0) * 1000);
  const iso = local.toISOString().slice(0, 13) + ':00';
  let i = levels.time.indexOf(iso);
  if (i >= 0) return i;
  // Không trùng khung giờ thì lấy chỉ số giữa hai mốc liền kề.
  let best = 0, bestGap = Infinity;
  const t0 = local.getTime();
  for (let k = 0; k < levels.time.length; k++) {
    const gap = Math.abs(new Date(levels.time[k] + 'Z').getTime() - t0);
    if (gap < bestGap) { bestGap = gap; best = k; }
  }
  return best;
}

/** Chuoi da ghep san cho mot bien, dung chung moc thoi gian cua ca tap. */
function levelSeries(id, variable, time) {
  const col = levels?.series?.[id]?.[variable];
  if (!col) return new Array(time.length).fill(null);
  const idx = new Map(levels.time.map((t, i) => [t, i]));
  return time.map(t => {
    const k = idx.get(t);
    return k == null ? null : col[k];
  });
}

/** Giá trị trung bình của nhiều hệ thống tại một chỉ số thời gian. */
function levelMean(time, variable) {
  const ids = Object.keys(levels?.series || {});
  if (!ids.length) return null;
  const cols = ids.map(id => levelSeries(id, variable, time));
  return time.map((_, i) => {
    let s = 0, n = 0;
    for (const c of cols) if (E.finite(c[i])) { s += c[i]; n++; }
    return n ? s / n : null;
  });
}

const COMPASS8 = ['Bắc', 'Đông bắc', 'Đông', 'Đông nam', 'Nam', 'Nam tây nam', 'Tây', 'Tây bắc'];
const compass = d => E.finite(d) ? COMPASS8[Math.round(((d % 360) + 360) % 360 / 45) % 8] : '—';

function renderAirMass() {
  const box = $('airMassBox');
  if (!box) return;
  if (!levels) { box.innerHTML = '<p class="muted">Chưa có dữ liệu mức áp lực.</p>'; return; }
  const time = levels.time;
  const n = time.length;
  const now = levelNowIndex();
  if (now == null || now < 0) { box.innerHTML = '<p class="muted">Không xác định được giờ hiện tại trong chuỗi dữ liệu.</p>'; return; }
  const ids = Object.keys(levels.series);
  const t850 = levelMean(time, 'temperature_850hPa');
  const thick = time.map((_, i) => E.thickness(
    levelMean(time, 'geopotential_height_500hPa')[i], levelMean(time, 'geopotential_height_850hPa')[i]));
  const rh850 = levelMean(time, 'relative_humidity_850hPa');
  const dir850 = levelMean(time, 'wind_direction_850hPa');
  const spd850 = levelMean(time, 'wind_speed_850hPa');

  // Chuỗi lịch sử: 72 giờ phân tích ngay trước hiện tại làm đường cơ sở để
  // phân loại. Chỉ dùng các giờ đã qua, không đưa phần dự báo vào chuẩn.
  const baseFrom = Math.max(0, now - 72);
  const past = t850.slice(baseFrom, now).filter(E.finite);
  const tBase = E.meanS(past);
  const thPast = thick.slice(baseFrom, now).filter(E.finite);
  const thBase = E.meanS(thPast);
  const am = E.airMass({
    t850: t850[now], t850Baseline: tBase, thick: thick[now], thickBaseline: thBase,
    rh850: rh850[now], source: dir850[now],
  });
  // Chỉ số giờ dự báo tiếp theo, để nói "trong 24 giờ tới" có thể lật ngược.
  const next24 = { t850: t850.slice(now, now + 24), thick: thick.slice(now, now + 24) };
  const dT24 = E.finite(t850[now]) ? E.meanS(next24.t850.filter(E.finite)) - t850[now] : null;

  // Độ lệch giữa các hệ thống: bao nhiêu hệ thống đồng ý về phân loại.
  const perModel = ids.map(id => {
    const col = levelSeries(id, 'temperature_850hPa', time);
    const z5 = levelSeries(id, 'geopotential_height_500hPa', time);
    const z8 = levelSeries(id, 'geopotential_height_850hPa', time);
    const th = E.thickness(z5[now], z8[now]);
    return { id, t850: col[now], th, tag: E.airMass({ t850: col[now], t850Baseline: tBase, thick: th, thickBaseline: thBase, rh850: levelSeries(id, 'relative_humidity_850hPa', time)[now], source: levelSeries(id, 'wind_direction_850hPa', time)[now] }) };
  });
  const votes = {};
  for (const p of perModel) if (p.tag) votes[p.tag.tag] = (votes[p.tag.tag] || 0) + 1;
  const agree = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
  const spreadT = Math.sqrt(E.varS(perModel.map(p => p.t850).filter(E.finite))) || 0;

  const front = E.frontalPassage({ dir850: dir850.slice(0, now + 1), t850: t850.slice(0, now + 1), hoursBack: 12 });

  const tagClass = am ? { cold: 'cold', warm: 'warm', cool: 'cool', mild: 'mild', neutral: 'neutral' }[am.tone] : 'neutral';
  box.innerHTML =
    `<div class="mass-head">
       <div><span class="small">PHÂN LOẠI KHỐI KHÔNG</span>
         <div class="mass-tag ${tagClass}">${am ? am.tag : '—'}</div></div>
       <div class="mass-consensus"><strong>${agree[1]}/${ids.length}</strong><span class="small">hệ thống đồng ý</span></div>
     </div>
     <div class="metric-grid compact" style="margin:14px 0 0">
       <div class="metric"><span class="small">Nhiệt độ 850 hPa</span><strong>${E.finite(t850[now]) ? fmt(t850[now], 1) : '—'}<em>°C</em></strong>
         <span class="small">${E.finite(t850[now] - tBase) ? (t850[now] - tBase >= 0 ? '+' : '') + fmt(t850[now] - tBase, 1) + '° so với 7 ngày qua' : '—'}</span></div>
       <div class="metric"><span class="small">Độ dày cột 500–850</span><strong>${E.finite(thick[now]) ? fmt(thick[now] / 100, 1) : '—'}<em>đạm</em></strong>
         <span class="small">${E.finite(thick[now] - thBase) ? (thick[now] - thBase >= 0 ? '+' : '') + fmt(thick[now] - thBase, 0) + ' m so với 7 ngày qua' : '—'}</span></div>
       <div class="metric"><span class="small">Gió 850 hPa</span><strong>${E.finite(dir850[now]) ? fmt(dir850[now], 0) + '<em>°</em>' : '—'}</strong>
         <span class="small">${E.finite(dir850[now]) ? 'từ phía ' + compass(dir850[now]) + (am?.advection ? ' · ' + am.advection : '') : '—'}</span></div>
       <div class="metric"><span class="small">Độ ẩm 850 hPa</span><strong>${E.finite(rh850[now]) ? fmt(rh850[now], 0) + '<em>%</em>' : '—'}</strong>
         <span class="small">${am?.moisture || '—'}</span></div>
     </div>` +
    `<p class="small" style="margin-top:12px">${ids.length ? 'Độ lệch giữa ' + ids.length + ' hệ thống ở 850 hPa: <strong>' + fmt(spreadT, 2) + '°C</strong>. ' : ''}` +
    (front ? `Phat hien <strong>${front.kind.toLowerCase()}</strong>: gio 850 hPa xoay ${fmt(front.windShift, 0)}° so voi 12 gio truoc, nhiet do thay doi ${fmt(front.dT, 1)}°C.` : 'Không phát hiện mặt lạnh hay mặt ấm trong 12 giờ vừa rồi.') +
    ` Độ dày cột là đại lượng phổ thông cho nhiệt độ căn bản của cột không khí: thấp hơn là lạnh hơn, cao hơn là nóng hơn.</p>`;
}

/** Vẽ quạt đường đi khối không: những giờ sau, những giờ trước, theo từng mô hình. */
function renderTrajectory() {
  const host = $('trajectory');
  if (!host) return;
  if (!levels) { host.innerHTML = '<p class="muted">Chưa có dữ liệu mức áp lực.</p>'; return; }
  const time = levels.time;
  const n = time.length;
  const now = levelNowIndex();
  if (now == null || now < 0) { host.innerHTML = '<p class="muted">Không xác định được giờ hiện tại.</p>'; return; }
  const ids = Object.keys(levels.series);
  if (!ids.length) { host.innerHTML = '<p class="muted">Không có hệ thống nào trả dữ liệu.</p>'; return; }

  const backH = Math.min(24, now);
  const fwdH = Math.min(48, n - 1 - now);
  const runs = ids.map(id => {
    const spd = levelSeries(id, 'wind_speed_850hPa', time);
    const dir = levelSeries(id, 'wind_direction_850hPa', time);
    // Lấy giờ ngay TRƯỚC và ngay SAU hiện tại; không dùng đầu/cuối chuỗi.
    const uB = [], vB = [], uF = [], vF = [];
    for (let h = backH; h >= 1; h--) {
      const w = E.toUms(spd[now - h], dir[now - h]); uB.push(w.u); vB.push(w.v);
    }
    for (let h = 0; h < fwdH; h++) {
      const w = E.toUms(spd[now + h], dir[now + h]); uF.push(w.u); vF.push(w.v);
    }
    return {
      id,
      back: E.trajectory({ lat: place.lat, lon: place.lon, u: uB, v: vB, hours: backH, stepKm: 20, sign: -1 }),
      fwd: E.trajectory({ lat: place.lat, lon: place.lon, u: uF, v: vF, hours: fwdH, stepKm: 20, sign: 1 }),
    };
  }).filter(r => r.back.length > 2 && r.fwd.length > 2);

  if (!runs.length) { host.innerHTML = '<p class="muted">Dữ liệu gió 850 hPa không đủ để vẽ đường đi.</p>'; return; }

  const pts = [];
  for (const r of runs) { pts.push(...r.back.slice(1), ...r.fwd.slice(1)); }
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  let lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  let lat1 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon0 = Math.min(...lons), lon1 = Math.max(...lons);
  if (lon1 - lon0 < 2) { lon0 -= 1; lon1 += 1; }
  if (lat1 - lat0 < 2) { lat0 -= 1; lat1 += 1; }
  const W = 640, H = 420, PAD = 26;
  const sx = lon => PAD + (lon - lon0) / (lon1 - lon0) * (W - PAD * 2);
  const sy = lat => PAD + (lat1 - lat) / (lat1 - lat0) * (H - PAD * 2);
  const path = legs => legs.map((p, i) => (i ? 'L' : 'M') + sx(p.lon).toFixed(1) + ' ' + sy(p.lat).toFixed(1)).join(' ');

  const backEnds = runs.map(r => r.back[r.back.length - 1]);
  const srcKm = E.meanS(backEnds.map(p => E.distanceKm(place, p))) || 0;
  const srcBearing = E.bearingDeg(place, backEnds[0]);

  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Quạt đường đi khối không ở 850 hPa">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#eef3f7"/>
    ${[0.25, 0.5, 0.75].map(f => `<line x1="${PAD}" y1="${PAD + f * (H - PAD * 2)}" x2="${W - PAD}" y2="${PAD + f * (H - PAD * 2)}" stroke="#cfdbe4"/>`).join('')}
    ${[0.25, 0.5, 0.75].map(f => `<line x1="${PAD + f * (W - PAD * 2)}" y1="${PAD}" x2="${PAD + f * (W - PAD * 2)}" y2="${H - PAD}" stroke="#cfdbe4"/>`).join('')}
    ${runs.map((r, i) => `<path d="${path(r.fwd)}" fill="none" stroke="#c0392b" stroke-width="1.3" opacity="${0.25 + 0.5 * (i + 1) / runs.length}"/>
      <path d="${path(r.back)}" fill="none" stroke="#2a5f96" stroke-width="1.3" stroke-dasharray="4 3" opacity="${0.25 + 0.5 * (i + 1) / runs.length}"/>`).join('')}
    <circle cx="${sx(place.lon)}" cy="${sy(place.lat)}" r="5" fill="#101f2d" stroke="#fff" stroke-width="2"/>
    <text x="${PAD + 4}" y="${PAD + 14}" class="tvb">Hướng tuyến tới</text>
    <text x="${PAD + 4}" y="${PAD + 30}" class="tvb">điểm quan sát</text>
  </svg>`;
  host.innerHTML = svg +
    `<div class="legend"><span><i style="background:#c0392b"></i>đi tới (tối đa ${fwdH} giờ)</span><span><i style="background:#2a5f96"></i>đi từ (tối đa ${backH} giờ)</span><span>${runs.length} hệ thống vẽ chồng nhau; độ rộng quạt là mức bất đồng</span></div>`;

  $('trajNote').innerHTML = `Khối không khí nơi bạn đang xét, ở tầng 850 hPa (khoảng 1,5 km), về từ phía <strong>${compass(srcBearing)}</strong> cách điểm quan sát khoảng <strong>${fmt(srcKm, 0)} km</strong> trong ${backH} giờ trước. Bản đồ là hình chiếu thẳng, dùng gió theo giờ của từng mô hình nên độ rộng quạt chính là mức bất đồng giữa các hệ thống.`;
}

/* ---------- rivers (GloFAS via Open-Meteo Flood API) ---------- */

// GloFAS trả về con sông lớn nhất trong ô lưới 5 km. Tại Việt Nam các con sông
// chính khác nhau nằm ở các ô khác nhau, nên quét một lưới địa lý 5x5 quanh điểm
// hiện tại và gom theo ô lưới thực trả về để không đếm trùng.
/**
 * Chạy các việc theo giới hạn số request cùng một lúc. Browser chỉ mở ít kết
 * nối HTTP/1.1 mỗi host nên đẩy 25 request một lúc sẽ bị chờ đợi và phần lớn
 * trả về lỗi, không phải do nguồn dữ liệu hết hạn mức.
 */
async function pLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await worker(items[i], i); }
      catch { out[i] = null; }
    }
  });
  await Promise.all(runners);
  return out;
}

/*
 * GloFAS trả về con sông lớn nhất trong ô lưới 5 km. Để biết ĐẦY ĐỦ những gì
 * nằm trong bán kính 10 km phải quét ô lưới chứ không thể chỉ hỏi tại điểm đứng:
 * một ô trả về sông thì không có nghĩa các ô bên cạnh không có.
 *
 * Lưới GloFAS là 5 km, nên các mẫu cách nhau 5 km là đủ để chắc chắn không bỏ
 * sót ô nào: một ô có tâm trong 10 km luôn chứa ít nhất một điểm mẫu. Lưới
 * 5x5 phủ tới 10 km mỗi phía, và mọi ô trả về số liệu đều được giữ lại — không
 * cắt còn "12 con gần nhất" như trước, vì cắt bỏ là mất sông.
 */
const RIVER_RADIUS_KM = 10;
const RIVER_DEG = RIVER_RADIUS_KM / 111.2;      // ~0.09°
const RIVER_STEP = 5 / 111.2;                   // đúng bước lưới GloFAS

const floodCellKey = c => c.lat.toFixed(3) + ',' + c.lon.toFixed(3);

/** Một lần quét: trả về danh sách ô lưới có sông, đã loại trùng. */
async function scanRiverCells() {
  const offs = [];
  for (let k = -2; k <= 2; k++) offs.push(k * RIVER_STEP);
  const jobs = [];
  for (const dy of offs) for (const dx of offs) jobs.push({ lat: place.lat + dy, lon: place.lon + dx });
  const seen = await pLimit(jobs, 6, async p => {
    const u = new URLSearchParams({
      latitude: p.lat.toFixed(4), longitude: p.lon.toFixed(4),
      daily: 'river_discharge', forecast_days: 1,
    });
    const j = await api('https://flood-api.open-meteo.com/v1/flood', u);
    const q = j.daily?.river_discharge || [];
    if (!q.some(v => E.finite(v) && v > 0)) return null;   // ô không có sông
    return { lat: j.latitude, lon: j.longitude };
  });
  const byCell = new Map();
  for (const c of seen) {
    if (!c) continue;
    const km = E.distanceKm(place, c);
    if (km > RIVER_RADIUS_KM) continue;
    byCell.set(floodCellKey(c), { cell: c, km: E.round(km, 1) });
  }
  return [...byCell.values()].sort((a, b) => a.km - b.km);
}

/** Tải lịch sử 12 tháng + 7 ngày dự báo cho MỘT ô đã biết là có sông. */
async function fetchRiverSeries(entry) {
  const u = new URLSearchParams({
    latitude: entry.cell.lat.toFixed(4), longitude: entry.cell.lon.toFixed(4),
    daily: 'river_discharge,river_discharge_median,river_discharge_p25,river_discharge_p75',
    past_days: 365, forecast_days: 7,
  });
  const j = await api('https://flood-api.open-meteo.com/v1/flood', u);
  const time = j.daily.time || [];
  const q = j.daily.river_discharge || [];
  const median = j.daily.river_discharge_median || [];
  const p25 = j.daily.river_discharge_p25 || [];
  const p75 = j.daily.river_discharge_p75 || [];
  const today = new Date().toISOString().slice(0, 10);
  // Chỉ những ngày có số mới tính được "hôm nay" và "đỉnh 7 ngày tới".
  let iToday = time.lastIndexOf(today);
  if (iToday < 0) iToday = time.findIndex(t => t >= today);
  if (iToday < 0 || iToday >= time.length || !E.finite(q[iToday])) return null;
  return {
    ...entry,
    time,
    q,
    median,
    p25,
    p75,
    iToday,
    qToday: q[iToday],
    qMedianToday: E.finite(median[iToday]) ? median[iToday] : q[iToday],
    p25Today: p25[iToday], p75Today: p75[iToday],
    // Lịch sử: mọi ngày trước hôm nay có số liệu.
    history: q.slice(0, iToday).filter(v => E.finite(v)),
    forecast: q.slice(iToday).filter(v => E.finite(v)),
  };
}

async function fetchRivers() {
  const cells = await scanRiverCells();
  if (!cells.length) return [];
  const out = await pLimit(cells, 3, entry => fetchRiverSeries(entry));
  const merged = mergeDuplicateRivers(out.filter(Boolean).sort((a, b) => a.km - b.km));
  let biggest = null;
  for (const r of merged) {
    const v = r.qMedianToday;
    if (E.finite(v) && (!biggest || v > biggest.v)) biggest = { v, km: r.km };
  }
  return merged.map(r => ({
    ...r,
    isLargest: !!biggest && Math.abs(r.km - biggest.km) < 0.05,
    levels: E.floodLevels({
      history: r.history,
      qNow: r.qMedianToday,
      qForecast: r.forecast.slice(1),
      rating: ratingFor(r.qMedianToday),
    }),
  }));
}

/*
 * Gộp các ô lưới GloFAS cùng trả về một dòng chảy.
 *
 * GloFAS lấy con sông lớn nhất nằm trong ô, và ở vùng đồng bằng như đồng bằng
 * sông Cửu Long, một dòng chảy duy nhất có thể chiếm nhiều ô liền nhau. Không
 * gộp thì người dùng thấy năm "con sông" khác nhau mà lưu lượng, trung bình và
 * đỉnh gần như giống hệt nhau — đúng là dữ liệu lặp, không phải năm con sông.
 *
 * Hai ô được coi là cùng một tuyến khi chuỗi lưu lượng khớp nhau từng ngày.
 * Ô đại diện là ô gần người dùng nhất, và số ô bị gộp được ghi lại để nói rõ
 * với người đọc thay vì lặng lẽ bớt dòng.
 */
function mergeDuplicateRivers(list) {
  const out = [];
  for (const r of list) {
    const prev = out.find(o => sameRiver(o, r));
    if (!prev) { out.push({ ...r, mergedCells: 1 }); continue; }
    prev.mergedCells = (prev.mergedCells || 1) + 1;
    prev.mergedKm = [...(prev.mergedKm || []), r.km];
  }
  return out;
}

function sameRiver(a, b) {
  // Hai ô phải là lân cận. Hai ô cách xa mà trùng chuỗi thì nhiều khả năng
  // chỉ là hai tuyến cùng chịu một nhịp điều hoà, không phải một tuyến.
  if (Math.abs(a.km - b.km) > 12) return false;
  const n = Math.min(a.history.length, b.history.length);
  if (n < 30) return false;
  const A = a.history.slice(-n), B = b.history.slice(-n);
  let same = 0, seen = 0;
  for (let i = 0; i < n; i++) {
    if (!E.finite(A[i]) || !E.finite(B[i])) continue;
    seen++;
    // Ngưỡng tương đối: cùng một dòng chảy có thể lệch tới 5% giữa hai ô (có
    // nhánh nhập thêm giữa chừng, và GloFAS tự định lượng lưu lượng riêng cho
    // từng ô), nhưng khác gấp đôi là hai dòng khác nhau.
    const tol = Math.max(0.05, 0.05 * Math.abs(A[i]));
    if (Math.abs(A[i] - B[i]) <= tol) same++;
  }
  /*
   * Ngưỡng 70%, không phải 98%. Đo thực nghiệm trên dữ liệu GloFAS cho thấy hai
   * ô của cùng một dòng chảy khớp nhau khoảng 78–86% số ngày, còn hai kênh nhỏ
   * khác nhau chỉ khớp 30–43%. Ngưỡng 98% không gộp được gì cả, còn 50% thì
   * nuốt nhầm các kênh con.
   */
  return seen >= 30 && same / seen > 0.7;
}

function riverRiskOf(r) {
  const recentWindow = (r.history || []).slice(-30);
  const recent = E.meanS(recentWindow);
  return E.riverRisk({
    q: r.qMedianToday ?? r.qToday,
    qP25: r.p25Today, qP75: r.p75Today,
    recent,
  });
}

/** Nhãn cảnh báo ngắn gọn cho một con sông. */
function riverAlert(r) {
  const L = r.levels;
  if (!L) return null;
  const now = L.now;
  const peak = L.peakBand;
  return { level: now, peak, outranked: !!(peak && (!now || peak.level > now.level)) };
}

function renderRivers() {
  const box = $('riverList');
  if (!box) return;
  if (!rivers) { box.innerHTML = '<p class="muted">Đang tải lưu lượng sông…</p>'; return; }
  if (!rivers.length) {
    box.innerHTML = `<p class="muted">Không có ô lưới GloFAS nào có sông trong bán kính ${RIVER_RADIUS_KM} km. Các vùng ven biển phẳng thường rơi vào tình huống này vì GloFAS chỉ mô tả lưu lượng trên dòng sông có đủ lưu lượng để ghi nhận.</p>`;
    return;
  }
  if (riverSel >= rivers.length) riverSel = 0;
  box.innerHTML = rivers.map((r, i) => {
    const k = riverRiskOf(r);
    const a = riverAlert(r);
    const tone = !k ? '' : (k.vsRecent >= 0.25 ? 'high' : k.vsRecent <= -0.25 ? 'low' : '');
    const rt = ratingFor(k?.q);
    const H = E.nominalStage(k?.q, rt.a, rt.b, rt.q0);
    return `<button class="river-card${i === riverSel ? ' selected' : ''}" data-river="${i}">
      <span class="river-top"><strong>${fmt(r.km, 1)} km</strong><span class="small">${r.isLargest ? 'sông lớn nhất · ' : ''}${compass(E.bearingDeg(place, r.cell))}</span></span>
      <span class="river-q">${k ? fmt(k.q, 1) : '—'}<em> m³/s</em></span>
      <span class="river-h${a?.level ? ' lv ' + a.level.tone : ''}">${E.finite(H) ? fmt(H, 2) : '—'}<em> m quy ước</em></span>
      <span class="river-bar"><i style="width:${Math.max(4, Math.min(100, k ? k.vsRecent * 100 + 50 : 50))}%" class="${tone}"></i></span>
      ${a?.level ? `<span class="warn-chip ${a.level.tone}">${a.level.label}</span>` : '<span class="small">dưới ngưỡng tham chiếu</span>'}
      <span class="small">${k && E.finite(k.vsRecent) ? (k.vsRecent >= 0 ? '+' : '') + fmt(k.vsRecent * 100, 0) + '% so với TB 30 ngày' : '—'}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('[data-river]').forEach(b => {
    b.onclick = () => { riverSel = +b.dataset.river; renderRivers(); };
  });
  renderRiverChart();
}

/*
 * Đường hydrograph: 120 ngày gần nhất + 7 ngày dự báo, kèm các ngưỡng tham
 * chiếu. Không vẽ cả năm — 372 điểm trên một khung nhỏ là một vệt đen, và
 * người đọc không nhìn ra được giá trị nào là hôm nay.
 */
const RIVER_CHART_DAYS = 120;

function renderRiverChart() {
  const host = $('riverChart');
  if (!host) return;
  if (!rivers || !rivers.length) { host.innerHTML = '<p class="muted">Chọn một con sông.</p>'; return; }
  const r = rivers[riverSel];
  const today = r.iToday ?? 0;
  const lo = Math.max(0, today - RIVER_CHART_DAYS);
  const hi = r.q.length - 1;
  const n = hi - lo + 1;
  if (n < 2) { host.innerHTML = '<p class="muted">Không đủ số liệu để vẽ.</p>'; return; }
  const series = i => (r.median?.[i] != null && E.finite(r.median[i]) ? r.median[i] : r.q[i]);
  const vals = [];
  for (let i = lo; i <= hi; i++) {
    for (const c of [series, r.p25, r.p75]) if (E.finite(c?.[i])) vals.push(c[i]);
  }
  for (const t of r.levels?.thresholds || []) if (E.finite(t.q)) vals.push(t.q);
  if (!vals.length) { host.innerHTML = '<p class="muted">Không có số liệu.</p>'; return; }
  const vmax = Math.max(...vals) * 1.1 || 1;
  const W = 720, H = 280, PAD = 46, PB = 46;
  const sx = i => PAD + (i - lo) / (hi - lo) * (W - PAD * 2);
  const sy = v => H - PB - (v / vmax) * (H - PAD - PB);
  const at = i => r.time[i];
  const band = (i) => {
    const a = r.p25?.[i], b = r.p75?.[i];
    return E.finite(a) && E.finite(b) ? `<rect x="${(sx(i) - (W - PAD * 2) / (hi - lo) / 2).toFixed(1)}" y="${sy(b).toFixed(1)}" width="${Math.max(1, (W - PAD * 2) / (hi - lo)).toFixed(1)}" height="${Math.max(1, sy(a) - sy(b)).toFixed(1)}" fill="#2a5f96" opacity=".16"/>` : '';
  };
  const path = (from, to) => {
    let d = '', pen = false;
    for (let i = from; i <= to; i++) {
      const v = series(i);
      if (!E.finite(v)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(v).toFixed(1) + ' ';
      pen = true;
    }
    return d;
  };
  const hist = path(lo, today), fc = path(today, hi);
  const ticks = [];
  for (let i = lo; i <= hi; i += 14) ticks.push(`<text x="${sx(i).toFixed(1)}" y="${H - 14}" class="tvb" text-anchor="middle">${String(at(i)).slice(5, 7)}/${String(at(i)).slice(8, 10)}</text>`);
  const cut = today > lo ? `<line x1="${sx(today).toFixed(1)}" y1="${PAD}" x2="${sx(today).toFixed(1)}" y2="${H - PB}" stroke="#b54ae0" stroke-dasharray="4 3"/><text x="${(sx(today) + 5).toFixed(1)}" y="${PAD + 12}" class="tvb">nay</text>` : '';
  const levels = (r.levels?.thresholds || []).filter(t => E.finite(t.q)).map(t =>
    `<line x1="${PAD}" y1="${sy(t.q).toFixed(1)}" x2="${W - PAD}" y2="${sy(t.q).toFixed(1)}" stroke="${LEVEL_COLOR[t.tone]}" stroke-width="1" stroke-dasharray="2 4" opacity=".85"/>
     <text x="${W - PAD - 4}" y="${(sy(t.q) - 4).toFixed(1)}" class="tvb" text-anchor="end" fill="${LEVEL_COLOR[t.tone]}">${t.label} ${fmt(t.q, 0)} m³/s</text>`).join('');
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hydrograph">
    <line x1="${PAD}" y1="${H - PB}" x2="${W - PAD}" y2="${H - PB}" stroke="#c7d2dc"/>
    ${[0.25, 0.5, 0.75, 1].map(f => `<text x="${PAD - 6}" y="${sy(vmax * f) + 4}" class="tvb" text-anchor="end">${fmt(vmax * f, 0)}</text>`).join('')}
    ${Array.from({ length: n }, (_, i) => band(lo + i)).join('')}
    ${levels}${cut}
    <path d="${hist}" fill="none" stroke="#2a5f96" stroke-width="2"/>
    <path d="${fc}" fill="none" stroke="#2a5f96" stroke-width="2" stroke-dasharray="5 4"/>
    ${ticks.join('')}</svg>
    <p class="small">Đường đậm là lưu lượng trung vị quan sát, đường đứt là 7 ngày dự báo; dải xanh nhạt là khoảng p25–p75 của bộ thành viên tổ hợp GloFAS, phản ánh mức chắc chắn của dòng chảy chứ không phải mực nước tính bằng mét. Các đường ngang là ngưỡng <strong>tham chiếu</strong> lấy từ phân vị lịch sử 12 tháng của chính tuyến này, không phải báo động chính thức. Nguồn: Global Flood Awareness System (GloFAS v4) qua Open-Meteo.</p>`;
}

/* ---------------------------------------------------------------------
 * Chỉ số năng lượng đối lưu (CAPE) và nguy cơ bão tố
 * =====================================================================
 *
 * Tên gọi cẩn thận: đây KHÔNG phải dự báo động sét. Không có nguồn mở nào
 * cấp dự báo tia sét cho Việt Nam — biến `lightning_potential` của Open-Meteo
 * được chấp nhận nhưng luôn trả null ở cả bảy mô hình, đo trên cả tám địa
 * điểm. Nói "dự báo động sét" khi không có dữ liệu sét là bịa số, nên giao
 * diện gọi đúng tên: chỉ số năng lượng đối lưu và nguy cơ bão tố.
 *
 * Chỉ số dùng ba trường của mô hình — CAPE, lifted index, CIN — hiệu chuẩn
 * thành xác suất theo đường bậc thang đồng ý fit trên tập huấn luyện
 * (xem ltbench.mjs). Mức cảnh báo lấy từ phân vị 12 tháng của CHÍNH địa điểm
 * đó, cùng logic đã dùng cho ngưỡng báo lũ GloFAS: một ngưỡng chung cho cả
 * nước sẽ vô nghĩa vì Đà Lạt và Rừng Tràm không giống nhau.
 */

const STORM = (() => {
  try {
    const el = document.getElementById('lightning-data');
    return JSON.parse(el ? el.textContent : '{}');
  } catch { return {}; }
})();

const STORM_FIELDS = 'cape,lifted_index,convective_inhibition';
const STORM_LEVELS = {
  low: { name: 'Thấp', cls: 'low', note: 'dưới trung vị của 12 tháng tại đây' },
  p50: { name: 'Trung bình', cls: 'low', note: 'từ trung vị 12 tháng trở lên' },
  p80: { name: 'Khá', cls: 'mid', note: 'vượt 80% số giờ trong 12 tháng' },
  p95: { name: 'Cao', cls: 'high', note: 'vượt 95% số giờ trong 12 tháng' },
  p99: { name: 'Rất cao', cls: 'severe', note: 'vượt 99% số giờ trong 12 tháng' },
};

/* Toạ độ 8 địa điểm đã kiểm chứng, dùng để tìm điểm tham chiếu gần nhất. */
const PLACE_COORDS = {
  hcm: [10.8231, 106.6297], hanoi: [21.0285, 105.8542], daklak: [12.6675, 108.0378],
  songcau: [13.4556, 109.2235], danang: [16.0544, 108.2022], dalat: [11.9469, 108.4583],
  cantho: [10.0452, 105.7469], nhatrang: [12.2395, 109.196],
};

/**
 * Địa điểm đã kiểm chứng gần nhất — nơi lấy dải phân vị 12 tháng và số liệu
 * đo được. Dùng điểm gần nhất chứ không dùng "tp.HCM cho mọi thứ" vì chỉ số
 * này mang nghĩa khác nhau rõ rệt giữa Đà Lạt và Phú Yên.
 */
function stormReference() {
  if (!STORM.locations) return null;
  let best = null, bestD = Infinity;
  for (const [id, loc] of Object.entries(STORM.locations)) {
    const c = PLACE_COORDS[id];
    if (!c || !loc.bands) continue;
    const d = E.distanceKm(place, { lat: c[0], lon: c[1] });
    if (d < bestD) { bestD = d; best = { id, loc, km: E.round(d, 0) }; }
  }
  return best;
}

function stormIndexOf(cape, li, cin) {
  return E.lightningIndex({ cape, liftedIndex: li, convectiveInhibition: cin });
}

/** Mức cảnh báo theo dải phân vị 12 tháng của địa điểm tham chiếu. */
function stormLevel(risk, bands) {
  const id = E.lightningLevel(risk, bands);
  return id ? { id, ...STORM_LEVELS[id] } : null;
}

/**
 * Câu mô tả mức độ tin cậy, viết ra từ SỐ ĐÃ ĐO chứ không viết tay.
 *
 * Chú giải từng ghi cứng "nhóm cao mưa gấp 2–4 lần". Khi kiểm tra thêm biến
 * thể chỉ dùng GFS — mô hình duy nhất có đủ CAPE + LI + CIN nên cùng thang đo —
 * thì độ nâng chỉ còn khoảng 1,4 lần. Con số phải lấy từ dữ liệu, và cả hai
 * con số phải hiện ra: chỉ đưa cái đẹp thì là nói dối.
 */
function stormSkillSentence() {
  const m = STORM.medianContrast, f = STORM.medianContrastFull || {};
  if (!m || m.ratio == null) return 'Số liệu kiểm chứng chưa có trong bản dựng này.';
  const pct = v => v == null ? '—' : Math.round(v * 100) + '%';
  const full = f.ratio == null ? ''
    : ' Chỉ dùng GFS — mô hình duy nhất có đủ ba thành phần nên cùng thang đo — độ nâng còn ' + f.ratio + ' lần';
  return 'Nhóm 20% giờ có điểm cao nhất có mưa ở ' + pct(m.highRate) + ' số giờ so với '
    + pct(m.lowRate) + ' ở nhóm còn lại (' + m.locationsWithGain + '/' + m.locationsTotal + ' địa điểm có lợi).'
    + full + ' Nhưng điểm kỹ năng BSS so với khí quyết định chỉ quanh 0, tức nó KHÔNG thừa kỹ thuật trong việc dự báo một ngưỡng mưa cụ thể.';
}

let stormToken = 0;

async function loadStorm() {
  const box = $('stormBox');
  if (!box) return;
  const token = ++stormToken;
  if (STORM.stub || !STORM.locations || !Object.keys(STORM.locations).length) {
    box.innerHTML = '<p class="small">Chưa có dữ liệu kiểm chứng cho chỉ số này. Chạy <code>node ltbench.mjs</code> rồi dựng lại trang.</p>';
    const m = $('stormMeta'); if (m) m.textContent = '—';
    return;
  }
  box.innerHTML = '<p class="muted">Đang tải CAPE, lifted index và CIN…</p>';
  try {
    const u = new URLSearchParams({
      latitude: String(place.lat), longitude: String(place.lon),
      hourly: STORM_FIELDS, forecast_days: '2', timezone: 'Asia/Ho_Chi_Minh',
    });
    const j = await api('https://api.open-meteo.com/v1/forecast', u);
    if (token !== stormToken) return;
    const h = j.hourly;
    const nowKey = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 13);
    const start = Math.max(0, h.time.findIndex(t => t.slice(0, 13) >= nowKey));
    const hours = h.time.length - start;
    const rows = [];
    for (let i = start; i < h.time.length; i++) {
      const idx = stormIndexOf(h.cape[i], h.lifted_index ? h.lifted_index[i] : null, h.convective_inhibition ? h.convective_inhibition[i] : null);
      if (idx) rows.push({ t: h.time[i], risk: idx.risk, cape: h.cape[i], li: h.lifted_index ? h.lifted_index[i] : null, cin: h.convective_inhibition ? h.convective_inhibition[i] : null, parts: idx.ingredients.length });
    }
    if (!rows.length) { box.innerHTML = '<p class="small">Mô hình không trả CAPE cho điểm này trong 36 giờ tới.</p>'; return; }
    // forecast_days=2 trả về tới 48 giờ. Cắt còn 36 để khớp với nhãn và với
    // lưới bản đồ dự báo động — cùng một cửa sổ thời gian ở mọi nơi.
    renderStorm(rows.slice(0, 36));
  } catch (e) {
    if (token !== stormToken) return;
    box.innerHTML = '<p class="small">Không lấy được dữ liệu đối lưu: ' + esc(e.message) + '</p>';
  }
}

function renderStorm(rows) {
  const box = $('stormBox');
  const ref = stormReference();
  const bands = ref ? ref.loc.bands : null;
  const hours = rows.length;

  // Đỉnh trong 36 giờ và các khung giờ liên tiếp ở mức cao — thứ người dùng
  // cần biết là "khi nào", chứ không phải "mức bao nhiêu".
  const peak = rows.reduce((a, b) => (b.risk > a.risk ? b : a), rows[0]);
  const windows = stormWindows(rows, bands);

  const parts = rows.reduce((acc, r) => acc + r.parts, 0) / hours;
  const ingredients = parts >= 2.99 ? 'CAPE + lifted index + CIN'
    : parts >= 1.99 ? 'CAPE + một thành phần phụ' : 'chỉ CAPE (mô hình không có LI/CIN)';

  let skill = '';
  if (ref) {
    const v = ref.loc.verify && ref.loc.verify[5];
    const c = ref.loc.contrast;
    const rho = v && v.rollingYear ? v.rollingYear.spearman : null;
    skill = `<p class="small">Ở <strong>${esc(ref.loc.name)}</strong> — điểm đã kiểm chứng gần nhất — nhóm 20% giờ có chỉ số cao nhất có mưa ở
      <strong>${c.high.rate == null ? '—' : Math.round(c.high.rate * 100) + '%'}</strong> số giờ so với
      <strong>${c.low.rate == null ? '—' : Math.round(c.low.rate * 100) + '%'}</strong> ở nhóm còn lại
      ${c.ratio ? `<strong> (gấp ${c.ratio})</strong>` : ''},
      hệ số thứ hạng ρ = <strong>${rho == null ? '—' : rho.toFixed(2)}</strong>.
      Đây là những con số đo được trên 12 tháng dữ liệu, không phải ước lượng suông.</p>
      <p class="small">Nhưng điểm phải nói thẳng: với ngưỡng mưa ≥5 mm/giờ, điểm kỹ năng BSS của chỉ số chỉ quanh
      <strong>${v && v.rollingYear ? v.rollingYear.bss.toFixed(3) : '—'}</strong>, tức
      <strong>không nhỉnh hơn khí quyết định</strong>. Chỉ số xếp hạng các giờ được khá; nó không phải một dự báo
      xác suất đáng tin cho một ngưỡng mưa cụ thể.</p>`;
  }

  const bars = stormBars(rows, bands);
  box.innerHTML = `
    <div class="storm-top">
      <div><p class="eyebrow">36 GIỜ TỚI · ĐỈNH</p>
        <p class="storm-peak">${esc(fmtHour(peak.t))}</p>
        <p class="small muted">chỉ số ${peak.risk.toFixed(2)} · CAPE ${Math.round(peak.cape)} J/kg</p></div>
      <div><p class="eyebrow">THÀNH PHẦN ĐÃ DÙNG</p>
        <p class="small">${esc(ingredients)}</p>
        <p class="tiny muted">Thiếu thành phần thì phần đó bị bỏ qua và trọng số được chuẩn hoá lại, không bị coi là 0.</p></div>
    </div>
    <div class="storm-chart">${bars}</div>
    ${windows.length ? `<p class="small"><strong>Khung giờ nổi bật:</strong> ${windows.map(w => `${esc(fmtHour(w.t0))}–${esc(fmtHour(w.t1))}`).join(' · ')}</p>`
      : `<p class="small">${stormHoursText(rows, bands)}</p>`}
    ${skill}`;

  const m = $('stormMeta');
  if (m) m.textContent = `${hours} giờ · ${ingredients}`;
  const lim = $('stormLimits');
  if (lim && STORM.limits && STORM.limits.length) {
    lim.innerHTML = '<strong>Giới hạn đã biết:</strong><br>' + STORM.limits.map(l => '· ' + esc(l)).join('<br>');
  }
}

/** Số giờ theo từng mức, để câu thông báo không mâu thuẫn với các cột đã vẽ. */
function stormHoursText(rows, bands) {
  const cut = bands ? bands.p80 : 0.55;
  const n = rows.filter(r => r.risk >= cut).length;
  if (!n) return 'Không giờ nào trong 36 giờ tới chạm mức <em>' + (bands ? STORM_LEVELS.p80.name.toLowerCase() : 'khá') + '</em>.';
  return `Có ${n}/${rows.length} giờ chạm mức ${bands ? STORM_LEVELS.p80.name.toLowerCase() : 'khá'} trở lên, nhưng rải rác nên không có khung liên tiếp nào đủ dài để gọi là khung.`;
}

function fmtHour(iso) {
  const d = new Date(iso + ':00+07:00');
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Các khung giờ liên tiếp đạt mức "khá" trở lên. */
/**
 * Các khung giờ liên tiếp đạt mức "khá" trở lên.
 *
 * Viết bằng CHỈ SỐ MẢNG chứ không so chuỗi thời gian: so chuỗi thì điều kiện
 * dừng rất dễ trượt ra ngoài mảng, và lỗi đó làm cả panel biến mất thay vì báo
 * lỗi. Khung quá dài được CẮT thành các đoạn tối đa 12 giờ chứ không bị bỏ: bỏ
 * đi thì câu "không có khung nào" sẽ nói ngược với hình đang vẽ.
 */
function stormWindows(rows, bands) {
  const cut = bands ? bands.p80 : 0.55;
  const runs = [];
  let from = -1;
  for (let i = 0; i <= rows.length; i++) {
    const hot = i < rows.length && rows[i].risk >= cut;
    if (hot && from < 0) from = i;
    if (!hot && from >= 0) { runs.push([from, i - 1]); from = -1; }
  }
  const MAX = 12;                     // giờ
  const out = [];
  for (const [a, b] of runs) {
    if (b - a < 1) continue;          // một giờ lẻ chưa đáng gọi là khung
    for (let k = a; k <= b; k += MAX) {
      const e = Math.min(b, k + MAX - 1);
      out.push({ t0: rows[k].t, t1: rows[e].t });
    }
  }
  return out.slice(0, 4);
}

/** Dải màu theo giờ: cao hơn 12 tháng tại đây thì sáng hơn. */
function stormBars(rows, bands) {
  const marks = bands ? [bands.p50, bands.p80, bands.p95, bands.p99] : [0.5, 0.7, 0.85, 0.95];
  const out = rows.map(r => {
    const lv = stormLevel(r.risk, bands);
    const t = Math.max(0, Math.min(1, r.risk));
    return `<i class="storm-bar ${lv ? lv.cls : ''}" style="height:${(14 + t * 34).toFixed(0)}%" title="${esc(fmtHour(r.t))}: chỉ số ${r.risk.toFixed(2)}${lv ? ' · ' + lv.name : ''}"></i>`;
  }).join('');
  return out + '<p class="tiny muted">Cột cao là giờ có chỉ số cao; màu theo mức: xanh lá là dưới'
    + ' p80, vàng là p80–p95, cam là p95–p99, tím là trên p99 của 12 tháng tại điểm tham chiếu'
    + (marks.length ? ` (lần lượt ${marks.map(m => m.toFixed(2)).join(' / ')})` : '') + '.</p>';
}
async function loadAirMassAndRivers() {
  const token = ++levelsToken;
  levels = null; rivers = null;
  const massBox = $('airMassBox'), riverBox = $('riverList');
  if (massBox) massBox.innerHTML = '<p class="muted">Đang tải trường mức áp lực 850/500 hPa…</p>';
  if (riverBox) riverBox.innerHTML = '<p class="muted">Đang quét lưu lượng các sông quanh đây…</p>';
  const notes = [];
  try {
    levels = await fetchLevels();
    if (token !== levelsToken) return;
    renderAirMass();
    renderTrajectory();
  } catch (e) {
    notes.push('Không lấy được trường mức áp lực: ' + esc(e.message));
    if (massBox) massBox.innerHTML = '<p class="small">Không lấy được trường mức áp lực: ' + esc(e.message) + '</p>';
  }
  const rTok = token;
  fetchRivers().then(async r => {
    if (rTok !== levelsToken) return;
    rivers = r; renderRivers();
    renderRiverLevels();
    // Tên sông tra sau, không chặn phần lưu lượng: nếu OSM chậm hoặc lỗi thì
    // bảng vẫn hiện lưu lượng và mực nước như thường.
    await fetchRiverNames(rivers);
    if (rTok !== levelsToken) return;
    renderRiverLevels();
  }).catch(() => { if (riverBox) riverBox.innerHTML = '<p class="small">Không lấy được dữ liệu sông.</p>'; });
  const tn = $('massMeta');
  if (tn) tn.textContent = notes.length ? notes.join(' ') : (levels ? `${levels.time.length} giờ · 7 hệ thống` : '—');
  // Chỉ số đối lưu: gọi riêng và không chặn, vì hết hạn mức Open-Meteo sẽ làm
  // nó hỏng trong khi khối khí và sông vẫn cần hiện.
  loadStorm().catch(() => {});
}

/* ---------- A. vi tri thiet bi ---------- */

let geoBusy = false;

/** Nút GPS + trạng thái đang chờ quyền vị trí. */
function initGeo() {
  const btn = $('geoBtn');
  if (btn) btn.onclick = useDeviceLocation;
}

/**
 * Dinh vi bang GPS cua thiet bi. Chi chay tren HTTPS (hoac localhost) - trinh
 * duyet chan tach tren HTTP. That bai thi bao ro nguyen nhan chu khong giam
 * im lang, va giu nguyen vi tri dang xem.
 */
function useDeviceLocation() {
  const btn = $('geoBtn');
  const note = $('geoNote');
  if (!navigator.geolocation) {
    if (note) note.textContent = 'Thiết bị này không có GPS, không lấy được vị trí. Hãy dùng ô tìm kiếm.';
    return;
  }
  if (!window.isSecureContext) {
    if (note) note.textContent = 'Trình duyệt chỉ cho dùng GPS trên kết nối HTTPS. Mở trang bằng địa chỉ https:// là dùng được.';
    return;
  }
  if (geoBusy) return;
  geoBusy = true;
  if (btn) btn.disabled = true;
  if (note) note.textContent = 'Đang xin quyền dùng vị trí…';
  const done = msg => {
    geoBusy = false;
    if (btn) btn.disabled = false;
    if (note) note.textContent = msg;
  };
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = +pos.coords.latitude.toFixed(4), lon = +pos.coords.longitude.toFixed(4);
    const name = await reverseGeocode(lat, lon);
    place = { id: 'gps', name: name || 'Vị trí của tôi', lat, lon, utcOffset: 7, fromGps: true };
    done('Đã dùng vị trí thiết bị' + (name ? ': ' + esc(name) : '') + '. Chọn lại địa điểm khác sẽ tắt chế độ này.');
    loadForecast();
  }, err => {
    const why = { 1: 'quyền vị trí bị từ chối', 2: 'không lấy được vị trí', 3: 'lỗi đo đạc vị trí' }[err.code] || 'không rõ nguyên nhân';
    done('Không dùng GPS: ' + why + '. Vị trí đang xem giữ nguyên.');
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
}

/**
 * Dịch toạ độ thành tên nơi chốn. Dùng BigDataCloud vì cho phép gọi chéo
 * miền từ trình duyệt; Nominatim cũng được nhưng phụ thuộc User-Agent.
 */
async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=vi', { signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    if (!r.ok) return null;
    const parts = [j.city || j.locality, j.principalSubdivision].filter(Boolean);
    const name = [...new Set(parts.filter(p => p && !parts.some(q => q !== p && q.includes(p))))].slice(0, 2).join(', ');
    return name || j.countryName || null;
  } catch { return null; }
}

/* ---------- B. luoi khong khi de ve len ban do ---------- */

let airGrid = null;
let airLayer = null;

// Biến lấy cho lưới khối khí. Ghi đúng tên biến, không suy diễn: tên sai khiến
// Open-Meteo trả lỗi 400 cho cả request thay vì bỏ trống một ô.
const GRID_VARS = [
  'temperature_850hPa', 'geopotential_height_850hPa', 'geopotential_height_500hPa',
  'relative_humidity_850hPa', 'wind_speed_850hPa', 'wind_direction_850hPa',
];

/**
 * Lấy trường 850/500 hPa trên một lưới quanh điểm đang xét, rồi phân loại
 * từng ô so với trung bình của chính lưới đó. Một request cho nhiều toạ độ,
 * dùng đúng bảy hệ thống như phần còn lại của trang.
 */
async function fetchAirGrid() {
  // Nâng cấp độ phân giải từ 200km xuống 100km, giảm nhẹ bán kính còn 500km để không vượt quá giới hạn 100 tọa độ/request của Open-Meteo
  const stepKm = 100, radiusKm = 500, n = Math.ceil(radiusKm / stepKm);
  const pts = [];
  for (let iy = -n; iy <= n; iy++) {
    for (let ix = -n; ix <= n; ix++) {
      const dx = ix * stepKm, dy = iy * stepKm;
      if (Math.hypot(dx, dy) > radiusKm) continue;
      pts.push(E.offsetLatLon(place.lat, place.lon, dx, dy));
    }
  }
  const u = new URLSearchParams({
    latitude: pts.map(p => p.lat.toFixed(3)).join(','),
    longitude: pts.map(p => p.lon.toFixed(3)).join(','),
    hourly: GRID_VARS.join(','),
    // Tối ưu hóa: Thay vì lấy cả 7 mô hình (tốn 7x dung lượng và API request),
    // bản đồ khối khí diện rộng chỉ cần 1 mô hình ECMWF là đủ chính xác.
    models: 'ecmwf_ifs025',
    past_days: 2, forecast_days: 1, timezone: 'auto',
  });
  const j = await api('https://api.open-meteo.com/v1/forecast', Object.fromEntries(u.entries()));
  const list = Array.isArray(j) ? j : [j];
  if (list.length < pts.length) throw new Error('chỉ nhận ' + list.length + '/' + pts.length + ' điểm');

  // Chi so gio hien tai cua tung diem. Chuoi bat dau 00:00 tai dia diem nen
  // "hien tai" nam o dau, dung muc lech gio cua chinh nguon de tim.
  const nowIdx = arr => {
    const off = (arr.utc_offset_seconds || 25200) * 1000;
    const iso = new Date(Date.now() + off).toISOString().slice(0, 13) + ':00';
    const t = arr.hourly.time || [];
    const i = t.indexOf(iso);
    if (i >= 0) return i;
    const now = new Date(Date.now() + off).getTime();
    let best = 0, gap = Infinity;
    t.forEach((x, k) => { const g = Math.abs(new Date(x + 'Z').getTime() - now); if (g < gap) { gap = g; best = k; } });
    return best;
  };

  const values = list.map((a, k) => {
    const h = a.hourly || {}, i = nowIdx(a);
    const pick = base => {
      // Khi gửi một mô hình, Open-Meteo không thêm hậu tố _ecmwf_ifs025 vào tên
      // biến. Tìm đúng key thực tế trong phản hồi thay vì ghép chuỗi cố định.
      const key = Object.keys(h).find(k => k === base || k.startsWith(base + '_'));
      if (key === undefined) return null;
      const col = h[key];
      const v = col ? col[i] : null;
      return E.finite(v) ? v : null;
    };
    return {
      lat: a.latitude ?? pts[k].lat, lon: a.longitude ?? pts[k].lon,
      t850: pick('temperature_850hPa'),
      z850: pick('geopotential_height_850hPa'),
      z500: pick('geopotential_height_500hPa'),
      rh850: pick('relative_humidity_850hPa'),
      wind: pick('wind_speed_850hPa'),
      dir: pick('wind_direction_850hPa'),
    };
  });
  const g = E.airMassGrid({ lat: place.lat, lon: place.lon, radiusKm, stepKm, values });
  // Chi lay cac o co du lieu; trung binh tinh tren chinh tap o day.
  const good = g.cells.map((c, k) => ({ ...c, ...values[k], thick: E.thickness(values[k].z500, values[k].z850) }))
    .filter(c => E.finite(c.t850) && E.finite(c.thick));
  const tMean = E.meanS(good.map(c => c.t850)), thMean = E.meanS(good.map(c => c.thick));
  const cells = good.map(c => E.classifyCell(c, { t850: tMean, thick: thMean }, c.dir));
  return { cells, mean: { t850: tMean, thick: thMean }, radiusKm, stepKm };
}

const MASS_COLORS = {
  cold: '#2a5f96', cool: '#6fa3cc', neutral: '#8494a2', mild: '#d69a4a', warm: '#c0392b',
};
const MASS_LABELS = [
  ['cold', 'Lạnh hơn vùng'], ['cool', 'Hơi lạnh hơn vùng'], ['neutral', 'Ôn hòa'],
  ['mild', 'Hơi nóng hơn vùng'], ['warm', 'Nóng hơn vùng'],
];

/** Vẽ lớp khối khí và (nếu có) lớp mũi tên gió lên cùng bản đồ radar. */
function drawAirMassOverlay() {
  if (!airGrid || !radarMap || !airLayer) return;
  airLayer.clearLayers();
  const lat0 = place.lat, lon0 = place.lon;
  for (const c of airGrid.cells) {
    const dLat = (c.lat - lat0) * 111.32;
    const dLon = (c.lon - lon0) * 111.32 * Math.max(0.15, Math.cos(lat0 * Math.PI / 180));
    const cs = airGrid.stepKm * 0.95; // bán kính ô tròn gần bằng khoảng cách giữa các tâm
    const pts = [];
    for (let a = 0; a < 12; a++) {
      const ang = (a * Math.PI) / 6;
      const p = E.offsetLatLon(c.lat, c.lon, Math.cos(ang) * cs, Math.sin(ang) * cs);
      pts.push([p.lat, p.lon]);
    }
    const label = '<strong>' + (c.tag || '—') + '</strong><br>' + fmt(c.t850, 1) + ' °C ở 850 hPa<br>'
      + 'lệch ' + (c.dT > 0 ? '+' : '') + fmt(c.dT, 1) + ' °C so với trung bình vùng<br>'
      + 'độ dày cột ' + fmt(c.thick, 0) + ' m';
    L.polygon(pts, {
      color: MASS_COLORS[c.tone] || MASS_COLORS.neutral,
      weight: 0, fillOpacity: 0.72, stroke: false, interactive: false, className: 'mass-blob'
    }).addTo(airLayer);
    // bindTooltip gắn tooltip vào chính polygon. Dựng L.tooltip rồi gọi
    // setTooltip không tồn tại trên Leaflet.
    L.marker([c.lat, c.lon], {
      interactive: false, opacity: 0, icon: L.divIcon({ className: '', iconSize: [1, 1] }),
    }).bindTooltip(label, { permanent: false, direction: 'top', className: 'mass-tip' }).addTo(airLayer);
  }
  // Moc gio hien tai: ban do chong giong voi ban do khong co moc, rat de doc sai.
  const nowIso = new Date(Date.now() + 25200 * 1000).toISOString().slice(0, 13) + ':00';
  L.circle([lat0, lon0], {
    radius: E.round(airGrid.stepKm * 620, 0), color: '#101f2d', weight: 2,
    fill: false, dashArray: '6 5', interactive: false,
  }).addTo(airLayer);
  if (nowIso && radarMap?.attributionControl) {
    radarMap.attributionControl.addAttribution('Khối khí: 850/500 hPa · mốc hiện tại ' + nowIso.slice(11, 13) + ' giờ địa phương');
  }
}

/** Chu thich cho lop khong khi, giu ngay tren ban do. */
function airMassLegendHtml() {
  return '<div class="radar-legend" aria-label="Chú giải khối khí"><strong>Khối khí 850 hPa so với trung bình vùng:</strong>' +
    MASS_LABELS.map(([k, label]) => '<span><i style="background:' + MASS_COLORS[k] + '"></i>' + label + '</span>').join('') +
    '</div>';
}

async function loadAirGrid() {
  const meta = $('airGridMeta'), host = $('airGridNote');
  if (meta) meta.textContent = 'đang tải…';
  try {
    airGrid = await fetchAirGrid();
    if (meta) meta.textContent = airGrid.cells.length + ' ô · bán kính ' + airGrid.radiusKm + ' km · ECMWF IFS (đại diện 7 hệ thống)';
    if (host) {
      const coldest = [...airGrid.cells].sort((a, b) => a.dT - b.dT)[0];
      const warmest = [...airGrid.cells].sort((a, b) => b.dT - a.dT)[0];
      host.innerHTML = 'Trong vùng bán kính ' + airGrid.radiusKm + ' km, nhiệt độ 850 hPa dao động ' +
        fmt(coldest.dT, 1) + ' đến ' + fmt(warmest.dT, 1) + ' °C so với trung bình vùng. ' +
        'Ô lạnh nhất ở ' + fmt(coldest.km, 0) + ' km về phía ' + compass(E.bearingDeg(place, coldest)) +
        '; ô nóng nhất ở ' + fmt(warmest.km, 0) + ' km về phía ' + compass(E.bearingDeg(place, warmest)) + '. ' +
        'Đường đứt đen là vòng cách ' + fmt(airGrid.stepKm, 0) + ' km tính từ điểm bạn đang xét.';
    }
    const al0 = $('airLegend');
    if (al0) al0.innerHTML = airMassLegendHtml();
    drawAirMassOverlay();
    if (radarMap && airLayer && !radarMap.hasLayer(airLayer)) {
      airLayer.addTo(radarMap);
    }
    const tg = $('airGridToggle');
    if (tg) { tg.textContent = 'Tắt khối khí trên bản đồ'; tg.classList.remove('secondary'); tg.classList.add('primary'); }
    return true;
  } catch (e) {
    airGrid = null;
    const airGridError = e.message;
    if (meta) meta.textContent = 'không tải được';
    if (host) host.textContent = 'Không lấy được lưới khối khí: ' + esc(airGridError) + '. Bản đồ vẫn hiển thị radar bình thường.';
    return false;
  }
}

let airGridRetry = null;

/* ---------- C. ten sông tu OSM ---------- */

/**
 * Bao xa một tên OSM được coi là đại diện cho ô lưới GloFAS.
 *
 * Ô GloFAS rộng 5 km và chỉ chứa lưu lượng dòng sông chính, nên tên đường nước
 * nằm sát mép ô vẫn hợp lý. Quá ngần thì tên sẽ thuộc về một con kênh khác
 * hoặc về nhánh sông ở xa — tên có thật nhưng không phải tên của tuyến này.
 */
const NAME_MATCH_KM = 4;

let osmToken = 0;

/**
 * Tên sông gần ô lưới GloFAS. GloFAS không trả tên.
 *
 * Nguồn: Photon (Komoot) — dịch vụ địa danh OSM, cho phép gọi chéo miền và
 * trả đúng osm_key/osm_value nên lọc được đường nước. Overpass và Nominatim
 * đều chặn CORS từ trình duyệt nên không dùng được ở đây.
 *
 * Chỉ nhận feature có osm_key=waterway và osm_value=river/stream/canal, rồi tự
 * tính khoảng cách để chọn tên gần ô lưới nhất. Không tìm được thì ghi rõ là
 * không có tên, không đoán theo vùng.
 */
async function fetchRiverNames(riverList) {
  const token = ++osmToken;
  const meta = $('riverNameMeta');
  const riverListMeta = $('riverMeta');
  if (meta) meta.textContent = 'đang tra tên sông…';
  let done = 0;
  await pLimit(riverList, 1, async r => {
    if (token !== osmToken) return null;
    const found = [];
    let anyOk = false;   // có ít nhất một lần trả về dữ liệu thật không
    // Dò cả ba từ khóa địa danh rồi tự chọn tên gần nhất. Photon cho phép
    // gọi chéo miền và không giới hạn như Nominatim, nên dò đủ ba từ khóa vẫn
    // chịu tải được; chỉ ô đầu tiên có tên mới dừng sớm.
    for (const term of ['Sông', 'Rạch', 'Kênh']) {
      try {
        const u = new URLSearchParams({
          q: term, lat: r.cell.lat.toFixed(4), lon: r.cell.lon.toFixed(4),
          limit: '50',
        });
        const res = await fetch('https://photon.komoot.io/api/?' + u, { signal: AbortSignal.timeout(18000) });
        if (!res.ok) continue;
        const j = await res.json();
        anyOk = true;
        for (const f of (j.features || [])) {
          const p = f.properties || {};
          // Chỉ nhận đường nước thật, dựa trên nhãn OSM chứ không đoán theo tên.
          if (p.osm_key !== 'waterway') continue;
          if (!WATERWAY_VALUES.has(p.osm_value)) continue;
          // Tên chỉ gồm từ khóa ("Kênh", "Kênh 1") không mang thông tin địa
          // danh; hiển thị như vậy cũng không cho biết đó là con kênh nào.
          const name = (p.name || '').trim();
          if (!name) continue;
          if (PLACEHOLDER_NAME.test(name)) continue;
          // OSM có cả tên tiếng Anh ("Cho Dem River"). Trang này phục vụ
          // người dùng Việt, và tên song ngữ rất dễ gây nhầm với tên khác.
          if (/\b(river|stream|canal|creek|waterway)\b/i.test(name)) continue;
          // GeoJSON luôn là [kinh độ, vĩ độ]. Đảo thứ tự là đo 8.600 km thay
          // vì 12 km — lỗi này rất dễ mắc vì cùng một cặp số nhưng thứ tự khác.
          const c = f.geometry?.coordinates;
          const pt = Array.isArray(c) && Array.isArray(c[0]) ? c[0] : c;
          if (!Array.isArray(pt) || pt.length < 2) continue;
          const lon = pt[0], lat = pt[1];
          if (!E.finite(lat) || !E.finite(lon)) continue;
          const km = E.distanceKm(r.cell, { lat, lon });
          // Chỉ nhận tên nằm thật gần ô lưới. Một đường nước cách ô GloFAS
          // mấy chục km không phải là con sông mà ô đó đại diện — gán tên ấy
          // vào là bịa dữ liệu, dù nó là tên có thật trong OSM.
          if (km > NAME_MATCH_KM) continue;
          found.push({ name, km });
        }
        // Đã có tên rất gần thì không cần dò tiếp.
        if (found.some(f => f.km <= 5)) break;
      } catch { /* không phân biệt được lỗi mạng với không có tên; đánh dấu bên dưới */ }
    }
    // Chỉ coi là "không tra được" khi KHÔNG request nào thành công. Nếu nguồn
    // đã trả dữ liệu mà vẫn không có tên trong 25 km thì đó là kết quả thật:
    // phải ghi "chưa có tên", không phải "nguồn chặn".
    r.nameFailed = !anyOk && !found.length;
    // Loại trùng tên. Phải trả về đúng giá trị boolean ở CUỐI thân hàm: viết
    // kiểu { if (...) return false; seen.add(k); } mà thiếu mệnh đề return cuối
    // sẽ trả undefined cho mọi phần tử, khiến danh sách luôn rỗng.
    const seen = new Set();
    const uniq = found.filter(f => {
      const k = f.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => a.km - b.km);
    r.name = uniq[0]?.name || null;
    r.nameKm = uniq[0]?.km ?? null;
    r.nameOthers = uniq.slice(1, 3).map(u => u.name);
    r.nameTried = true;
    done++;
    if (token === osmToken && meta) meta.textContent = 'đã tra ' + done + '/' + riverList.length + ' ô';
    // Nghỉ nhẹ giữa các ô để không dồn tải lên một dịch vụ miễn phí.
    await new Promise(res => setTimeout(res, 400));
    // Vẽ lại ngay từng ô: người dùng thấy tên xuất hiện dần, không phải đợi
    // hết cả bảng rồi mới có gì.
    if (token === osmToken && rivers && rivers.includes(r)) {
      renderRiverLevels();
      if (riverListMeta) riverListMeta.textContent = 'đang tra tên ' + done + '/' + riverList.length + '…';
    }
    return r;
  });
  /*
   * Một tên chỉ thuộc về một ô. Hai ô GloFAS cách nhau vài km có thể cùng khớp
   * một tên OSM, và hiển thị cùng một cái tên cho hai dòng chảy khác nhau là
   * sai. Ô nào khớp tên xa hơn thì nhường tên cho ô khớp gần hơn.
   */
  const byName = new Map();
  for (const r of riverList) {
    if (!r.name) continue;
    const k = r.name.toLowerCase();
    const prev = byName.get(k);
    if (!prev || (r.nameKm ?? 1e9) < (prev.nameKm ?? 1e9)) byName.set(k, r);
  }
  for (const r of riverList) {
    if (!r.name) continue;
    const owner = byName.get(r.name.toLowerCase());
    if (owner && owner !== r) {
      r.duplicateOf = owner.km;
      r.name = null;
      r.nameOthers = [];
    }
  }
  if (token === osmToken && riverListMeta) riverListMeta.textContent = riverList.length + ' ô lưới đã quét';
  if (token === osmToken && meta) {
    const named = riverList.filter(r => r.name).length;
    const failed = riverList.filter(r => r.nameFailed).length;
    // Phân biệt rõ hai tình huống: không có tên trong OSM, và không tra được do
    // nguồn chặn. Gộp chung sẽ khiến người dùng tưởng dữ liệu không tồn tại.
    meta.textContent = failed
      ? named + '/' + riverList.length + ' ô có tên · ' + failed + ' ô không tra được (nguồn chặn yêu cầu)'
      : named
        ? named + '/' + riverList.length + ' ô có tên trong OSM'
        : 'OSM chưa ghi tên cho các ô này';
  }
}

/**
 * Chọn MỘT từ khóa tìm tên đường nước theo quy mô lưu lượng: tuyến lớn gọi
 * "Sông", kênh vừa gọi "Rạch", kênh nhỏ gọi "Kênh". Đây là cách gọi phổ biến
 * ở Việt Nam, dùng để tìm nhanh; tên hiển thị lấy y nguyên từ OSM.
 */
function waterTermFor(q) {
  if (!E.finite(q)) return 'Sông';
  if (q >= 300) return 'Sông';
  if (q >= 30) return 'Rạch';
  return 'Kênh';
}

// osm_value hợp lệ cho đường nước có tên. Chỉ dùng danh sách này, không suy
// diễn từ việc tên chứa chữ "sông".
const WATERWAY_VALUES = new Set(['river', 'stream', 'canal', 'ditch']);

// Tên đường nước chỉ gồm từ khóa rồi số ("Kênh", "Kênh 1", "Rạch 2") không
// mang thông tin địa danh — hiển thị như vậy không cho biết đó là con kênh nào.
const PLACEHOLDER_NAME = /^(Sông|Rạch|Kênh|Suối|Ao|Ruộng)\s*\d*$/i;

/* ---------- D. muc nuoc quy uoc ---------- */

/*
 * Mực nước quy ước — đọc kỹ trước khi dùng.
 *
 * H = a * (Q / q0)^b  với H tính bằng mét, Q tính bằng m³/s.
 *
 * Đường đo đạc thật (rating curve) là đặc thù từng trạm, có độ trễ và do
 * cơ quan thủy văn quản lý, không có trong bất kỳ nguồn mở nào. Bộ hệ số
 * dưới đây là số tham khảu chọn để hợp lý với quy mô từng loại tuyến:
 *   sông lớn  (q0 = 1000 m³/s, b = 0.54): Q = 2500 → 3,3 m; Q = 10000 → 7,0 m
 *   kênh nhỏ  (q0 = 10 m³/s,   b = 0.50): Q = 2 → 0,4 m
 * Chúng chỉ để SO SÁNH GIỮA CÁC NGÀY của cùng một tuyến. Tuyệt đối không
 * dùng làm số đo đối chiếu với số đo đạc chính thức.
 */
const RATING = {
  river: { a: 2.02, b: 0.54, q0: 1000, label: 'tuyến sông lớn (tham khảo)', ref: 2.0 },
  channel: { a: 0.9, b: 0.5, q0: 10, label: 'kênh/rạch nhỏ (tham khảo)', ref: null },
};

/**
 * Chọn bộ hệ số theo quy mô lưu lượng. Ngưỡng 100 m³/s phân tách tuyến sông
 * với kênh nhỏ; đây là đường phân loại của riêng ứng dụng, không phải phân
 * loại của cơ quan quản lý.
 *
 * Ngưỡng 100 chứ không phải 300 vì một dòng chảy 100 m³/s đã là sông thật, và
 * bộ hệ số của kênh nhỏ sẽ nâng nó lên 3 m — cao hơn cả sông lớn. Sai ở đây
 * làm mực nước quy ước vô nghĩa, mà mức này chính là thứ người đọc nhìn vào
 * để quyết định có phải lo lắng hay không.
 */
function ratingFor(q) {
  return q >= 100 ? RATING.river : RATING.channel;
}

const LEVEL_COLOR = { low: '#2e8b57', mid: '#c9a227', high: '#e07b39', severe: '#c0392b' };

function renderRiverLevels() {
  const host = $('riverLevels');
  if (!host) return;
  if (!rivers || !rivers.length) { host.innerHTML = '<p class="small">Chưa có dữ liệu sông.</p>'; return; }
  const anyPending = rivers.some(r => !r.nameTried);
  host.innerHTML = rivers.map((r, i) => {
    const k = riverRiskOf(r);
    if (!k) return '';
    const rt = ratingFor(k.q);
    const H = E.nominalStage(k.q, rt.a, rt.b, rt.q0);
    const p25H = E.nominalStage(k.p25, rt.a, rt.b, rt.q0);
    const p75H = E.nominalStage(k.p75, rt.a, rt.b, rt.q0);
    const L = r.levels;

    // +24h
    const idx24h = Math.min(r.q.length - 1, r.iToday + 1);
    const q24h = r.q[idx24h];
    const trend = (E.finite(q24h) && E.finite(k.q)) ? (q24h > k.q + 0.1 ? '↑' : q24h < k.q - 0.1 ? '↓' : '→') : '';
    const h24h = E.nominalStage(q24h, rt.a, rt.b, rt.q0);

    // Ba trạng thái khác nhau: đang tra, tra lỗi, và thật sự không có tên.
    const name = r.name || (r.duplicateOf != null
      ? 'cùng tên với ô cách ' + fmt(r.duplicateOf, 1) + ' km'
      : r.nameFailed ? 'Không tra được tên' : r.nameTried ? 'Chưa có tên trong OSM' : 'đang tra tên…');

    const alertCell = !L ? '<span class="tiny">chưa đủ lịch sử</span>'
      : (L.now
        ? `<span class="warn-chip ${L.now.tone}">${L.now.label}</span><br><span class="tiny">≥ ${fmt(L.now.q, 1)} m³/s</span>`
        : `<span class="tiny">dưới ngưỡng</span><br><span class="tiny">cần ${fmt(L.thresholds[0].q, 1)} m³/s</span>`)
      + (L.peakBand && (!L.now || L.peakBand.level > L.now.level)
        ? `<br><span class="warn-chip ${L.peakBand.tone}">7 ngày tới: ${L.peakBand.label}</span>` : '');

    const pctCell = !L || !E.finite(L.percent) ? '<span class="tiny">—</span>'
      : `thứ <strong>${L.rankFromTop}</strong> / ${L.n}<br><span class="tiny">TB ${fmt(L.p50, 1)} · max ${fmt(L.max, 1)} m³/s</span>`;

    return '<tr' + (i === riverSel ? ' class="chosen"' : '') + ' data-river="' + i + '">' +
      '<td><strong>' + esc(name) + '</strong>' + (r.nameOthers?.length ? '<br><span class="tiny">còn gọi: ' + esc(r.nameOthers.join(', ')) + '</span>' : '') +
      '<br><span class="tiny">ô lưới cách bạn ' + fmt(r.km, 1) + ' km · ' + compass(E.bearingDeg(place, r.cell)) +
      (r.nameKm != null ? ' · tên đường nước cách ô lưới ' + fmt(r.nameKm, 1) + ' km' : '') +
      (r.mergedCells > 1 ? '<br><span class="tiny">ô lưới này gộp ' + r.mergedCells + ' ô GloFAS cùng dòng chảy (cách thêm: ' + (r.mergedKm || []).map(x => fmt(x, 1)).join(', ') + ' km)</span>' : '') + '</span></td>' +
      '<td>' + fmt(k.q, 1) + '<span class="tiny"> m³/s</span></td>' +
      '<td><strong class="lv">' + (E.finite(H) ? fmt(H, 2) : '—') + ' m</strong>' +
      (E.finite(p25H) && E.finite(p75H) ? '<br><span class="tiny">' + fmt(p25H, 2) + '–' + fmt(p75H, 2) + ' m</span>' : '') +
      '<br><span class="tiny">' + rt.label + '</span></td>' +
      '<td>' + pctCell + '</td>' +
      '<td>' + (E.finite(k.vsRecent) ? (k.vsRecent >= 0 ? '+' : '') + fmt(k.vsRecent * 100, 0) + '%' : '—') + '</td>' +
      '<td>' + (E.finite(h24h) ? fmt(h24h, 2) + ' m <span class="tiny">' + trend + '</span>' : '—') + '</td>' +
      '<td>' + alertCell + '</td>' +
      '</tr>';
  }).join('')
    + (anyPending ? '<tr><td colspan="7" class="muted tiny">Đang tra tên sông trong OSM cho các ô còn lại…</td></tr>' : '');
  host.querySelectorAll('[data-river]').forEach(tr => {
    tr.onclick = () => { riverSel = +tr.dataset.river; renderRivers(); renderRiverLevels(); };
  });
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
      try {
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
      } catch (err) {
        console.warn('Lỗi tải ERA5 cho lịch tháng, bỏ qua quan trắc:', err.message);
      }
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
          // Nhiệt thấp và đơn vị "mm" là các span riêng: màn hình nhỏ bỏ chúng ra
          // để ô lịch không bị cắt chữ, màn lớn thì hiện như cũ.
          (o ? `<span class="mday-t">${fmt(o.tmax, 0)}°<span class="mday-lo">/${fmt(o.tmin, 0)}°</span></span><span class="mday-p">${fmt(o.psum, 1)}<span class="unit"> mm</span></span>`
            : '<span class="mday-p">chưa có</span>') + '</div>';
      } else if (fc[iso]) {
        const f = fc[iso];
        const risky = (f.psum ?? 0) >= 25 || (f.gust ?? 0) >= 60;
        cells += `<div class="mday forecast${risky ? ' alert' : ''}${selectedDay === iso ? ' selected' : ''}" data-day="${iso}" role="button" tabindex="0" title="${iso}: cao nhất ${fmt(f.tmax, 0)}°C, thấp nhất ${fmt(f.tmin, 0)}°C, mưa ${fmt(f.psum, 1)} mm, giật ${fmt(f.gust, 0)} km/h — bấm để xem chi tiết"><span class="mday-n">${day}</span>` +
          `<span class="mday-t">${fmt(f.tmax, 0)}°<span class="mday-lo">/${fmt(f.tmin, 0)}°</span></span><span class="mday-p">${weatherFamily(f.code)} ${fmt(f.psum, 1)}<span class="unit"> mm</span></span></div>`;
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
  danang: ['ĐÀ NẴNG', 'QUẢNG TRỊ', 'QUẢNG NGÃI', 'HUẾ', 'THỪA THIÊN HUẾ', 'TRUNG BỘ', 'TRUNG TRUNG BỘ', 'HÀ TĨNH', 'QUẢNG BÌNH'],
  dalat: ['ĐÀ LẠT', 'LÂM ĐỒNG', 'TÂY NGUYÊN', 'CAO NGUYÊN TRUNG BỘ', 'GIA LAI', 'ĐẮK LẮK'],
  cantho: ['CẦN THƠ', 'HẬU GIANG', 'TÂY NAM BỘ', 'ĐỒNG BẰNG SÔNG CỬU LONG', 'NAM BỘ', 'TRIỀU CƯỜNG'],
  hcm: ['HỒ CHÍ MINH', 'NAM BỘ', 'ĐÔNG NAM BỘ', 'ĐỒNG NAI', 'TRIỀU CƯỜNG'],
  nhatrang: ['NHA TRANG', 'KHÁNH HÒA', 'NAM TRUNG BỘ', 'PHÚ YÊN', 'NINH THUẬN', 'BÌNH THUẬN'],
  daklak: ['ĐẮK LẮK', 'BUÔN MA THUỘT', 'TÂY NGUYÊN', 'GIA LAI', 'LÂM ĐỒNG'],
  songcau: ['SÔNG CẦU', 'PHÚ YÊN', 'NAM TRUNG BỘ', 'QUẢNG NGÃI', 'BÌNH ĐỊNH'],
};

/** Mọi cảnh báo và bản tin còn hiệu lực trên toàn quốc (từ trang chủ và các chuyên mục NCHMF). */
function nchmfFreshWarnings() {
  const seen = new Set();
  const out = [];

  // 1. Bản tin khẩn cấp từ trang chủ NCHMF
  for (const b of NCHMF.breaking || []) {
    const key = (b.title || '') + (b.url || '');
    if (!seen.has(key) && isEffective(b.iso, 3)) {
      seen.add(key);
      out.push({
        ...b,
        category: b.category || 'Tin khẩn cấp NCHMF',
        url: b.url || 'https://www.nchmf.gov.vn/'
      });
    }
  }

  // 2. Bản tin từ các chuyên mục NCHMF
  for (const c of NCHMF.categories || []) {
    for (const w of c.warnings || []) {
      const key = (w.title || '') + (w.url || c.url);
      if (!seen.has(key) && isEffective(w.iso, 3)) {
        seen.add(key);
        out.push({
          ...w,
          category: c.label,
          url: w.url || c.url
        });
      }
    }
  }

  return out.sort((a, b) => {
    if (a.level === 'red' && b.level !== 'red') return -1;
    if (b.level === 'red' && a.level !== 'red') return 1;
    if (a.level === 'orange' && b.level === 'info') return -1;
    if (b.level === 'orange' && a.level === 'info') return 1;
    return (b.iso || '').localeCompare(a.iso || '');
  });
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

const LEVEL_VN = { red: 'KHẨN CẤP', orange: 'CẢNH BÁO', info: 'DỰ BÁO', stale: 'LƯU TRỮ' };

/** Hôm nay theo giờ Việt Nam — mốc để xác định tin còn hiệu lực. */
function vnToday() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}
/** Tin còn hiệu lực: phát hành trong vòng maxDays ngày. */
function isEffective(iso, maxDays = 3) {
  if (!iso) return true;
  const days = (Date.parse(vnToday()) - Date.parse(iso)) / 86400000;
  return days >= -1 && days <= maxDays;
}

/**
 * Hiển thị toàn bộ bản tin chính thức NCHMF:
 * - Cảnh báo khẩn cấp khớp với vùng đang xem (lũ quét, sạt lở, bão, mưa lớn)
 * - Cảnh báo khẩn cấp trên cả nước
 * - Dự báo thời tiết đất liền 24h & 10 ngày
 * - Dự báo thời tiết biển & triều cường
 */
function renderNchmf() {
  const cats = NCHMF.categories || [];
  const breaking = NCHMF.breaking || [];
  if (!NCHMF.collectedAt && !breaking.length && !cats.length) {
    $('nchmfMeta').textContent = 'chưa có dữ liệu';
    $('nchmfList').innerHTML = '<p class="muted">Chưa có dữ liệu bản tin NCHMF. Bấm nút <strong>Làm mới tin</strong> để tải về.</p>';
    return;
  }

  const allWarnings = nchmfFreshWarnings();
  const matched = allWarnings.filter(w => {
    const keys = NCHMF_REGIONS[place.id] || [];
    const T = (w.title || '').toUpperCase();
    return keys.some(k => T.includes(k));
  });
  const others = allWarnings.filter(w => !matched.includes(w));

  const fmtCard = w => `
    <div class="nchmf-card ${w.level || 'info'}">
      <div class="nchmf-card-title">
        <span class="warn-chip ${w.level || 'info'}">${LEVEL_VN[w.level] || 'TIN'}</span>
        <a href="${w.url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(w.title)}</a>
      </div>
      <div class="nchmf-card-meta">
        <span>🕒 ${w.iso || ''}${w.time ? ' ' + w.time : ''}</span>
        <span>📁 ${esc(w.category || 'NCHMF')}</span>
        <a class="nchmf-card-link" href="${w.url}" target="_blank" rel="noopener">Đọc bản tin gốc NCHMF ↗</a>
      </div>
    </div>`;

  const collectTimeStr = NCHMF.collectedAt
    ? new Date(NCHMF.collectedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : 'hôm nay';
  $('nchmfMeta').textContent = `Thu thập: ${collectTimeStr} · ${allWarnings.length} tin/cảnh báo mới nhất`;

  let html = '';

  // 1. Cảnh báo cho địa phương đang xem
  if (matched.length) {
    html += `<div class="nchmf-section-title">🚨 Cảnh báo chính thức cho khu vực ${esc(place.name)} (${matched.length})</div>`;
    html += matched.map(fmtCard).join('');
  }

  // 2. Cảnh báo khẩn cấp các vùng khác trên toàn quốc
  if (others.length) {
    html += `<div class="nchmf-section-title">⚠️ Cảnh báo khẩn cấp trên toàn quốc (${others.length})</div>`;
    html += others.map(fmtCard).join('');
  }

  if (!allWarnings.length) {
    html += '<p class="muted" style="padding:10px 0">Hiện NCHMF không phát cảnh báo thời tiết nguy hiểm đặc biệt. Dưới đây là bản tin dự báo định kỳ mới nhất.</p>';
  }

  // 3. Bản tin dự báo chuyên đề (Đất liền 24h, Biển 24h, 10 ngày tới)
  const datlien = cats.find(c => c.id === 'datlien');
  const bien = cats.find(c => c.id === 'bien');
  const muoingay = cats.find(c => c.id === 'muoi-ngay');

  if (datlien || bien || muoingay) {
    html += `<div class="nchmf-section-title" style="margin-top:22px">📋 Bản tin dự báo thời tiết định kỳ NCHMF</div>`;

    if (datlien && datlien.excerpt) {
      html += `
        <div class="nchmf-routine-box">
          <h4>🌤️ ${esc(datlien.title || 'Dự báo thời tiết đất liền 24h')}</h4>
          <p>${esc(datlien.excerpt)}</p>
          <div class="meta"><a class="nchmf-card-link" href="${datlien.url}" target="_blank" rel="noopener">Xem chi tiết toàn bộ các vùng trên NCHMF ↗</a></div>
        </div>`;
    }

    if (bien && bien.excerpt) {
      html += `
        <div class="nchmf-routine-box">
          <h4>🌊 ${esc(bien.title || 'Dự báo thời tiết biển 24h')}</h4>
          <p>${esc(bien.excerpt)}</p>
          <div class="meta"><a class="nchmf-card-link" href="${bien.url}" target="_blank" rel="noopener">Xem chi tiết thời tiết biển trên NCHMF ↗</a></div>
        </div>`;
    }

    if (muoingay && (muoingay.excerpt || muoingay.title)) {
      html += `
        <div class="nchmf-routine-box">
          <h4>📅 ${esc(muoingay.title || 'Xu thế thời tiết 10 ngày tới')}</h4>
          <p>${esc(muoingay.excerpt || 'Theo dõi diễn biến không khí lạnh, mưa dông và nhiệt độ 10 ngày tới trên toàn quốc.')}</p>
          <div class="meta"><a class="nchmf-card-link" href="${muoingay.url}" target="_blank" rel="noopener">Xem toàn văn bản tin 10 ngày NCHMF ↗</a></div>
        </div>`;
    }
  }

  // 4. Các chuyên mục chuyên sâu khác
  const otherCats = cats.filter(c => c.id !== 'datlien' && c.id !== 'bien' && c.id !== 'muoi-ngay');
  if (otherCats.length) {
    html += `
      <details style="margin-top:16px;border:1px solid var(--line);border-radius:8px;padding:10px 14px;background:#fbfcfd">
        <summary style="font-weight:600;cursor:pointer">Tra cứu trực tiếp ${otherCats.length} chuyên mục cảnh báo khác của NCHMF</summary>
        <div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:8px">
          ${otherCats.map(c => `
            <a href="${c.url}" target="_blank" rel="noopener" style="padding:8px 12px;background:#fff;border:1px solid var(--line);border-radius:6px;text-decoration:none;color:var(--ink);font-size:13px;display:block">
              <strong>${esc(c.label)}</strong><br>
              <span class="tiny" style="color:var(--muted)">${esc(c.title || 'Đọc tin')} ↗</span>
            </a>
          `).join('')}
        </div>
      </details>`;
  }

  $('nchmfList').innerHTML = html;
}

/** Tải dữ liệu NCHMF mới nhất từ máy chủ tĩnh hoặc làm mới tại chỗ. */
async function fetchLatestNchmf() {
  const btn = $('btnReloadNchmf');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Đang tải…';
  }
  try {
    const res = await fetch('nchmf.json?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      if (data && (data.breaking || data.categories)) {
        NCHMF = data;
        renderNchmf();
        nchmfBannerFor(place.id);
      }
    }
  } catch (err) {
    console.warn('Lỗi khi tải nchmf.json:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Làm mới tin';
    }
  }
}

/** Chuyển nhanh giữa các tab chức năng. */
function switchTab(viewId) {
  const targetTab = document.querySelector(`.tab[data-view="${viewId}"]`);
  if (targetTab) {
    targetTab.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
window.switchTab = switchTab;

/** Banner cảnh báo khẩn cấp tại tab Dự báo (gọn gàng, dẫn sang tab Tin tức). */
function nchmfBannerFor(placeId) {
  const matched = nchmfWarningsFor(placeId);
  const box = $('officialBanner');
  if (!box) return [];
  if (!matched.length) {
    const anyRed = nchmfFreshWarnings().filter(w => w.level === 'red');
    box.innerHTML = anyRed.length
      ? `<div class="notice warning" style="margin-bottom:14px;border-left:4px solid #c0392b">🚨 <strong>NCHMF cảnh báo khẩn cấp (${anyRed.length} tin):</strong> ${esc(anyRed[0].title.slice(0, 110))}… <a href="#news" onclick="switchTab('news');return false;" style="font-weight:700;margin-left:6px;color:var(--blue)">Xem chi tiết tại Tab Tin tức ↗</a></div>`
      : '';
    return [];
  }
  const worst = matched.some(w => w.level === 'red') ? 'red' : 'orange';
  box.innerHTML = `<div class="notice ${worst === 'red' ? 'error' : 'warning'}" style="margin-bottom:14px;border-left:4px solid ${worst === 'red' ? '#c0392b' : '#e67e22'}">` +
    `🚨 <strong>Cảnh báo chính thức (NCHMF) cho vùng này:</strong> ` +
    matched.slice(0, 2).map(w => esc(w.title.slice(0, 130))).join(' · ') +
    ` <a href="#news" onclick="switchTab('news');return false;" style="font-weight:700;margin-left:6px;color:var(--blue)">Xem chi tiết tại Tab Tin tức ↗</a></div>`;
  return matched;
}

/* ---------- tin tức khí tượng quốc tế (WMO · NOAA · ECMWF · JMA) ---------- */

const INTL_NEWS = [
  {
    id: 'wmo-enso',
    agency: 'wmo',
    agencyName: 'WMO · Tổ chức Khí tượng Thế giới (LHQ)',
    titleVn: 'Bản tin El Niño / La Niña: Xác suất chuyển dịch sang La Niña và tác động thời tiết Đông Nam Á',
    titleOrig: 'WMO Update: Neutral ENSO conditions likely to transition to weak La Niña',
    time: '2026-10',
    summary: 'Tổ chức Khí tượng Thế giới (WMO) nhận định hiện tượng ENSO tiếp tục duy trì trạng thái trung tính với khả năng 60% chuyển sang pha La Niña trong các tháng cuối năm. Pha La Niña thường kích hoạt sự gia tăng lượng mưa tại Đông Nam Á, tăng tần suất bão trên Biển Đông và các đợt không khí lạnh dồn dập tại miền Bắc Việt Nam.',
    url: 'https://wmo.int/news/media-centre',
    category: 'Khí hậu toàn cầu',
    level: 'orange'
  },
  {
    id: 'wmo-climate-state',
    agency: 'wmo',
    agencyName: 'WMO · Tổ chức Khí tượng Thế giới (LHQ)',
    titleVn: 'Báo cáo Khí hậu Toàn cầu: Nhiệt độ đại dương phá kỷ lục và sự gia tăng các cực đoan khí hậu',
    titleOrig: 'WMO State of the Global Climate: Record ocean heat and intensified hydrological cycle',
    time: '2026-10',
    summary: 'Nhiệt độ bề mặt nước biển tại Thái Bình Dương và Ấn Độ Dương duy trì ở mức cao bất thường trong suốt 12 tháng qua. Nhiệt lượng tích tụ trong đại dương là nguồn năng lượng khổng lồ kích hoạt các siêu bão nhiệt đới, mưa cực đoan gây ngập lụt ven biển và sóng nhiệt đại dương kéo dài.',
    url: 'https://wmo.int/topics/climate-change',
    category: 'Biến đổi khí hậu',
    level: 'info'
  },
  {
    id: 'noaa-mjo',
    agency: 'noaa',
    agencyName: 'NOAA / CPC · Cơ quan Khí quyển & Đại dương Mỹ',
    titleVn: 'Giám sát Hoàn lưu Đối lưu Nhiệt đới MJO: Kích hoạt dải hội tụ ẩm và mưa lớn trên Biển Đông',
    titleOrig: 'NOAA Climate Prediction Center: Global Tropics Hazards and MJO Outlook',
    time: '2026-10',
    summary: 'Trung tâm Dự báo Khí hậu Hoa Kỳ (CPC/NOAA) theo dõi sóng đối lưu quy mô hành tinh Madden-Julian (MJO) đang tiến vào pha 4 và 5 qua khu vực biển Đông Nam Á. Pha này tăng cường nguồn ẩm đối lưu mạnh mẽ, làm tăng khả năng hình thành xoáy thuận nhiệt đới, dải áp thấp và các đợt mưa diện rộng tại miền Trung và Nam Bộ.',
    url: 'https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/',
    category: 'Đối lưu nhiệt đới',
    level: 'orange'
  },
  {
    id: 'noaa-cyclones',
    agency: 'noaa',
    agencyName: 'NOAA / NWS · Trung tâm Dự báo Môi trường Quốc gia Mỹ',
    titleVn: 'Theo dõi Xoáy thuận Nhiệt đới Toàn cầu & Nâng cấp Mô hình Dự báo GFS / GEFS',
    titleOrig: 'NOAA / NCEP: Global Tropical Cyclone Monitoring and Numerical Weather Prediction',
    time: '2026-10',
    summary: 'NOAA cập nhật chuỗi dữ liệu đồng hóa vệ tinh thế hệ mới GOES/JPSS vào mô hình toàn cầu GFS, nâng cao độ chính xác dự báo quỹ đạo và cường độ bão trên Tây Bắc Thái Bình Dương, đồng thời cung cấp dự báo tổ hợp GEFS 31 thành phần hạn đến 16 ngày.',
    url: 'https://www.nhc.noaa.gov/',
    category: 'Bão nhiệt đới',
    level: 'info'
  },
  {
    id: 'ecmwf-aifs',
    agency: 'ecmwf',
    agencyName: 'ECMWF · Trung tâm Dự báo Thời tiết Hạn vừa Châu Âu',
    titleVn: 'Dự báo Thời tiết Trí tuệ Nhân tạo AIFS: Vận hành dự báo tổ hợp và cảnh báo sóng lạnh sớm 10-15 ngày',
    titleOrig: 'ECMWF Operational Updates: Artificial Intelligence Forecasting System (AIFS)',
    time: '2026-10',
    summary: 'ECMWF chính thức tích hợp mô hình AI khí tượng AIFS vào chu trình vận hành hằng ngày song song với mô hình vật lý IFS. AIFS thể hiện năng lực vượt trội trong việc phát hiện sớm các đợt bùng phát không khí lạnh (cold surges) từ lục địa Á - Âu tràn xuống vùng nhiệt đới trước từ 10 đến 14 ngày.',
    url: 'https://www.ecmwf.int/en/forecasts',
    category: 'Công nghệ AI khí tượng',
    level: 'info'
  },
  {
    id: 'ecmwf-seasonal',
    agency: 'ecmwf',
    agencyName: 'Copernicus / ECMWF · Dịch vụ Khí hậu Châu Âu',
    titleVn: 'Dự báo Mùa và Dị thường Nhiệt - Ẩm: Nhận định hoàn lưu gió mùa Đông Á trong 3 tháng tới',
    titleOrig: 'Copernicus Climate Change Service: Seasonal Forecast and Circulation Anomalies',
    time: '2026-10',
    summary: 'Phân tích dị thường áp cao Siberia và rãnh gió Tây cho thấy mùa đông năm nay có xu hướng xuất hiện các đợt rét đậm tập trung vào giữa mùa đông, với lượng mưa xấp xỉ đến cao hơn trung bình nhiều năm tại dải ven biển miền Trung Việt Nam.',
    url: 'https://climate.copernicus.eu/',
    category: 'Dự báo mùa',
    level: 'info'
  },
  {
    id: 'jma-typhoon',
    agency: 'jma',
    agencyName: 'JMA · Cơ quan Khí tượng Nhật Bản (RSMC Tokyo)',
    titleVn: 'Trung tâm Giám sát Bão Tây Bắc Thái Bình Dương: Theo dõi áp thấp nhiệt đới và bão trên Biển Đông',
    titleOrig: 'RSMC Tokyo - Typhoon Center: Tropical Cyclone Information and Analysis',
    time: '2026-10',
    summary: 'Cơ quan Khí tượng Nhật Bản (JMA) chịu trách nhiệm theo dõi và đặt tên quốc tế cho các cơn bão tại Tây Bắc Thái Bình Dương. Bản tin phân tích chi tiết vị trí tâm bão, áp suất thấp nhất, bán kính gió mạnh trên 30kt và 50kt, hỗ trợ cảnh báo an toàn hàng hải và ven bờ cho toàn vùng Đông Á và Biển Đông.',
    url: 'https://www.jma.go.jp/bosai/map.html#contents=typhoon',
    category: 'Trung tâm Bão RSMC',
    level: 'orange'
  },
  {
    id: 'jma-monsoon',
    agency: 'jma',
    agencyName: 'JMA · Cơ quan Khí tượng Nhật Bản',
    titleVn: 'Theo dõi Áp cao Siberia & Đợt bùng phát Gió mùa Đông Bắc (Cold Surge) xuống Đông Nam Á',
    titleOrig: 'JMA Climate Prediction Division: East Asian Winter Monsoon and Cold Air Outbreak',
    time: '2026-10',
    summary: 'JMA công bố báo cáo phân tích áp cao lạnh lục địa Siberia đang mạnh dần lên tại khu vực vĩ độ cao. Khi áp cao này tràn về phía nam sẽ gây gió mạnh cấp 6-8, sóng lớn trên Vịnh Bắc Bộ và Bắc Biển Đông, đồng thời gây giảm nhiệt độ sâu trên toàn miền Bắc Việt Nam.',
    url: 'https://www.data.jma.go.jp/gmd/cpd/db/enso/',
    category: 'Gió mùa Đông Bắc',
    level: 'info'
  }
];

function renderIntlNews(filter = 'all') {
  const container = $('intlNewsList');
  if (!container) return;
  const items = filter === 'alerts'
    ? INTL_NEWS.filter(n => n.level === 'orange' || n.level === 'red')
    : INTL_NEWS;

  container.innerHTML = items.map(item => `
    <article class="intl-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <span class="intl-agency-badge ${item.agency}">${esc(item.agencyName.split('·')[0].trim())}</span>
        <span class="tiny" style="color:var(--muted)">🕒 ${item.time} · ${esc(item.category)}</span>
      </div>
      <h4>${esc(item.titleVn)}</h4>
      <div class="orig-title">Gốc: "${esc(item.titleOrig)}"</div>
      <p>${esc(item.summary)}</p>
      <div class="intl-card-footer">
        <span>Nguồn: <strong>${esc(item.agencyName)}</strong></span>
        <a href="${item.url}" target="_blank" rel="noopener">Đọc báo cáo gốc ↗</a>
      </div>
    </article>
  `).join('');
}

function initNewsTab() {
  renderIntlNews('all');
  document.querySelectorAll('.news-filter-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.news-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      const f = btn.dataset.filter;
      const vnSec = $('nchmfSectionWrapper');
      const intlSec = $('intlSectionWrapper');
      if (f === 'all') {
        if (vnSec) vnSec.hidden = false;
        if (intlSec) intlSec.hidden = false;
        renderIntlNews('all');
      } else if (f === 'vn') {
        if (vnSec) vnSec.hidden = false;
        if (intlSec) intlSec.hidden = true;
      } else if (f === 'intl') {
        if (vnSec) vnSec.hidden = true;
        if (intlSec) intlSec.hidden = false;
        renderIntlNews('all');
      } else if (f === 'alerts') {
        if (vnSec) vnSec.hidden = false;
        if (intlSec) intlSec.hidden = false;
        renderIntlNews('alerts');
      }
    };
  });
}

/* ---------- verification view (backward compatibility safe) ---------- */

function initSelects() {
  if (!$('testCity')) return;
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
  if (!$('testSummary')) return;
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
    // `fitted` is the family that was actually estimated. With a single usable
    // system the winner key can name a blend family that was then downgraded,
    // and the tick has to follow what was fitted, not what was selected.
    const pick = c.fitted === true || (c.fitted === undefined && c.chosen);
    return `<tr${pick ? ' class="chosen"' : ''}><td>${esc(fam)}${pick ? ' ✓' : ''}` +
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
  if (!$('protocol')) return;
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
let radarFrames = null;   // chuỗi khung RainViewer để phát hoạt hình
let radarTimer = 0;
let radarFadeLayer = null;   // lớp tile thứ hai, dùng để mờ chuyển khung
let radarPlaying = false;
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
    // Sử dụng bản đồ vệ tinh độ phân giải cao (Esri World Imagery) thay vì OSM mặc định
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }).addTo(radarMap);

    // Giữ cả chuỗi khung để phát hoạt hình. RainViewer trả về khung quá khứ và
    // khung dự báo nhiều giờ; chỉ dùng khung cuối thì bản đồ đứng yên.
    radarFrames = { host: data.host, frames, index: frames.length - 1 };
    const latest = frames[frames.length - 1];
    // Trả lại cấu hình Retina 512px vì máy chủ RainViewer chặn zoom > 7 đối với ảnh tổng hợp toàn cầu.
    // Việc dùng tile 512px + zoomOffset -1 chính là cách ép nó hiện độ phân giải cao gấp 4 lần bình thường.
    const radarTileOpts = { tileSize: 512, zoomOffset: -1, maxNativeZoom: 7, maxZoom: 18, attribution: 'RainViewer' };
    radarLayer = L.tileLayer(
      `${data.host}${latest.path}/512/{z}/{x}/{y}/2/1_1.png`,
      { ...radarTileOpts, opacity: RADAR_OPACITY },
    ).addTo(radarMap);
    /*
     * Lớp thứ hai để mờ chuyển khung. Nó luôn nằm trên lớp chính và luôn trong
     * suốt cho tới khi được mờ lên; có nút chuột không để chặn thao tác kéo.
     */
    radarFadeLayer = L.tileLayer(
      `${data.host}${latest.path}/512/{z}/{x}/{y}/2/1_1.png`,
      { ...radarTileOpts, opacity: 0 },
    ).addTo(radarMap);
    const fc = radarFadeLayer.getContainer && radarFadeLayer.getContainer();
    if (fc) {
      fc.style.transition = 'none';
      fc.style.opacity = '0';
      fc.style.pointerEvents = 'none';
      fc.style.zIndex = '4';
    }
    const bc = radarLayer.getContainer && radarLayer.getContainer();
    if (bc) { bc.style.zIndex = '3'; bc.style.transition = 'none'; }
    alertLayer = L.layerGroup().addTo(radarMap);
    // Lop khong khi ve tren cung ban do radar. Ban do khu vuc dong du dat
    // phong do khong khi o 850/500 hPa nen phai keo lui mot so km de thay het
    // vung. Chi nap khi nguoi dung bat, tranh tai mot lan duyet khong can.
    airLayer = L.layerGroup();
    drawDisasterPin();
    /*
     * Ghi rõ cửa sổ mà nguồn thật sự cho. Nguồn mở của RainViewer chỉ phục vụ
     * 2 giờ quá khứ cộng (khi có) nửa giờ dự báo nowcast; trước đây nhãn chỉ
     * ghi giờ của khung cuối, người đọc dễ hiểu là có dữ liệu dài hơn thế.
     */
    radarFrames.past = (data.radar.past || []).length;
    radarFrames.nowcast = (data.radar.nowcast || []).length;
    const spanH = ((latest.time - frames[0].time) / 3600).toFixed(1);
    $('radarMsg').textContent = 'Radar hiện tại · khung '
      + new Date(latest.time * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
      + ' (ICT) · ' + frames.length + ' khung trong ' + spanH + ' giờ'
      + (radarFrames.nowcast ? ' (gồm ' + radarFrames.nowcast + ' khung dự báo nowcast)' : ' (không có khung dự báo)')
      + '.';
    initRadarControls();
    const al = $('airLegend');
    if (al) al.innerHTML = airGrid ? airMassLegendHtml() : '';
    const tg = $('airGridToggle');
    if (tg) {
      const on = radarMap && airLayer && radarMap.hasLayer(airLayer);
      tg.textContent = on ? 'Tắt khối khí trên bản đồ' : 'Bật khối khí trên bản đồ';
      if (on) { tg.classList.remove('secondary'); tg.classList.add('primary'); }
      else { tg.classList.remove('primary'); tg.classList.add('secondary'); }
    }
  } catch (e) {
    $('radarMsg').textContent = 'Không tải được radar: ' + e.message + '. Tải lại khi có mạng.';
  }
}


/* ---------- phát hoạt hình khung radar ---------- */

/*
 * Độ mịn khi chuyển khung.
 *
 * Trước đây mỗi bước chỉ gọi setUrl, tức khung mới thay thế khung cũ ngay lập
 * tức: các tế bào mưa nhảy ra như phim giánt cách, đúng thứ làm cho vòng phát
 * trông giật dù dữ liệu vẫn đúng.
 *
 * Cách sửa là chồng HAI lớp tile: lớp dưới giữ khung hiện tại, lớp trên mới tải
 * khung kế tiếp rồi mờ dần lên. Người xem thấy khung mới nối liền khung cũ như
 * một video, không phải 12 bức ảnh liên tiếp.
 *
 * Nói rõ đánh đổi: hai lớp cùng mờ 0,7 thì giữa chừng hình tổng độ mờ sẽ hơi
 * thấp hơn (0,58) rồi trở lại 0,7. Đây là giới hạn của cách pha bằng CSS —
 * pha chuẩn phải vẽ ra canvas mà tile RainViewer không cho đọc pixel. Độ nhấp
 * nháy này nhỏ và đối xứng, thấy hơn là tăng sáng, và vẫn tốt hơn nhiều so với
 * việc cắt hẳn.
 */
const RADAR_FADE_MS = 340;    // thời gian mờ dần giữa hai khung
const RADAR_DWELL_MS = 210;   // dừng ở khung mới trước khi mờ sang khung sau
const RADAR_TILE_WAIT = 320;  // chờ tile tải tối đa trước khi bắt đầu mờ
const RADAR_OPACITY = 0.7;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Chờ lớp tile nạp xong các ô đang nhìn thấy, hoặc hết giờ thì bỏ qua. */
function radarTilesReady(layer, maxWait) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      layer.off('load', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, maxWait);
    // Ô nào đã nằm trong bộ nhớ đệm thì sự kiện load có thể không nổ ra, nên
    // không được chờ mãi — hết giờ thì mờ luôn.
    layer.on('load', finish);
  });
}

function radarUrl(k) {
  const f = radarFrames.frames[k];
  return `${radarFrames.host}${f.path}/512/{z}/{x}/{y}/2/1_1.png`;
}

function radarLabel(k) {
  const frames = radarFrames.frames;
  const t = new Date(frames[k].time * 1000)
    .toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return 'Khung ' + (k + 1) + '/' + frames.length + ' · ' + t + ' (ICT)';
}

/** Đặt nhãn và thanh trượt về khung k, không đụng tới lớp tile. */
function radarMark(k) {
  const lab = $('radarFrameTime');
  if (lab) lab.textContent = radarLabel(k);
  const sl = $('radarFrameSlider');
  if (sl) sl.value = k;
}

/** Đổi sang khung radar thứ i. `fade` = true thì mờ dần, ngược lại thay thẳng. */
async function radarShowFrame(i, fade) {
  if (!radarFrames || !radarLayer) return;
  const frames = radarFrames.frames;
  const k = Math.max(0, Math.min(frames.length - 1, i));
  radarFrames.index = k;
  radarMark(k);

  const top = radarFadeLayer && radarFadeLayer.getContainer ? radarFadeLayer.getContainer() : null;
  if (!fade || !top) {
    radarLayer.setUrl(radarUrl(k));
    if (top) { top.style.transition = 'none'; top.style.opacity = '0'; }
    return;
  }

  // Nạp khung mới lên lớp trên, rồi chờ nó sẵn sàng TRƯỚC khi mờ — mờ vào ô
  // trống sẽ thấy một nháy trắng, tệ hơn cả việc cắt thẳng.
  radarFadeLayer.setUrl(radarUrl(k));
  await radarTilesReady(radarFadeLayer, RADAR_TILE_WAIT);
  if (radarFrames.index !== k) return;      // người dùng đã kéo thanh trượt
  if (!radarPlaying) return;

  const base = radarLayer.getContainer();
  /*
   * Đặt cả hai lớp về trạng thái đầu với transition rồi ÉP TRÌNH DUYỆT GHI NHẬN
   * bằng cách đọc offsetWidth, sau đó mới bật chuyển tiếp.
   *
   * Trước đây bước này bọc trong requestAnimationFrame. Ở tab chạy nền, rAF bị
   * hãm nhịp gần như không nổ, nên lớp trên chưa bao giờ được mờ lên: khung vẫn
   * đổi, nhưng thay thẳng chứ không mờ dần, và đúng cái độ mịn cần sửa thì
   * không có. Ép reflow bằng cách đọc thuộc tính là cách không phụ thuộc rAF.
   */
  top.style.transition = 'none';
  top.style.opacity = '0';
  if (base) { base.style.transition = 'none'; base.style.opacity = String(RADAR_OPACITY); }
  void top.offsetWidth;

  // Hai lớp chuyển cùng lúc: lớp dưới mờ đi trong khi lớp trên mờ lên, nên
  // tổng độ mờ không nhảy vọt lên như khi chỉ tăng một lớp.
  if (base) {
    base.style.transition = `opacity ${RADAR_FADE_MS}ms linear`;
    base.style.opacity = '0';
  }
  top.style.transition = `opacity ${RADAR_FADE_MS}ms linear`;
  top.style.opacity = String(RADAR_OPACITY);

  await sleep(RADAR_FADE_MS);
  // Khung mới đã lên lớp dưới; lớp trên trả về 0 và trở thành lớp dự phòng.
  radarLayer.setUrl(radarUrl(k));
  top.style.transition = 'none';
  top.style.opacity = '0';
  if (base) { base.style.transition = 'none'; base.style.opacity = String(RADAR_OPACITY); }
}

/** Dừng phát. `toNow` = true thì quay về khung mới nhất. */
function radarStop(toNow) {
  radarPlaying = false;
  if (radarTimer) { clearTimeout(radarTimer); radarTimer = 0; }
  const b = $('radarPlay');
  if (b) b.textContent = '▶ Phát radar';
  // Chuyển khung đang chạy dở sẽ tự dừng ở giữa chừng; đặt lại ngay để lớp
  // trên không bị kẹt ở độ mờ nửa chừng.
  const top = radarFadeLayer && radarFadeLayer.getContainer ? radarFadeLayer.getContainer() : null;
  if (top) { top.style.transition = 'none'; top.style.opacity = '0'; }
  const base = radarLayer && radarLayer.getContainer ? radarLayer.getContainer() : null;
  if (base) { base.style.transition = 'none'; base.style.opacity = String(RADAR_OPACITY); }
  if (toNow && radarFrames && radarFrames.frames.length > 1) {
    radarShowFrame(radarFrames.frames.length - 1, false);
  } else {
    radarMark(radarFrames ? radarFrames.index : 0);
  }
}

async function radarStep() {
  if (!radarPlaying || !radarFrames) return;
  const n = radarFrames.frames.length;
  await radarShowFrame((radarFrames.index + 1) % n, true);
  if (!radarPlaying) return;
  radarTimer = setTimeout(radarStep, RADAR_DWELL_MS);
}

function radarPlay(on) {
  if (on) {
    if (!radarFrames || radarFrames.frames.length < 2) return;
    radarPlaying = true;
    const b = $('radarPlay');
    if (b) b.textContent = '⏸ Tạm dừng radar';
    radarStep();
  } else {
    // Dừng thì về khung hiện tại, đúng như người dùng mong: bấm tạm dừng xong
    // thì bản đồ phải ở trạng thái "bây giờ", chứ không đứng lơ lửng ở giữa
    // quá khứ.
    radarStop(true);
  }
}

function initRadarControls() {
  const b = $('radarPlay');
  if (b) b.onclick = () => radarPlay(!radarPlaying);
  const s = $('radarFrameSlider');
  if (s) {
    /*
     * Phải đọc khung NGƯỜI DÙNG CHỌN trước khi dừng. radarStop gọi radarMark để
     * đồng bộ nhãn, và radarMark lại ghi giá trị hiện tại vào thanh trượt — đọc
     * sau đó thì luôn nhận được khung cũ, và kéo thanh trượt sẽ không bao giờ
     * dừng ở khung người dùng chọn.
     */
    s.oninput = () => {
      const k = +s.value;
      radarStop(false);
      radarShowFrame(k, false);
    };
  }
  if (radarFrames) {
    const s2 = $('radarFrameSlider');
    if (s2) s2.max = radarFrames.frames.length - 1;
    radarMark(radarFrames.index);
  }
}
/* ---------- bản đồ dự báo động ---------- */

/*
/*
 * Ngân sách dữ liệu — điều đã học được sau khi tự làm cạn hạn mức API
 * ============================================================
 *
 * Trần của Open-Meteo không tính theo SỐ REQUEST mà theo SỐ GIỜ DỮ LIỆU. Một lưới
 * 441 điểm × 48 giờ × 5 biến là hơn 100 nghìn giờ-dữ liệu trong một lần bấm nút,
 * và một lượt thử như vậy làm cạn hạn mức của cả giờ. Nếu không tính từ trước,
 * người dùng sẽ gặp 429 và tưởng trang hỏng.
 *
 * Vì vậy:
 *  1. Tải ĐÚNG BIẾN ĐANG XEM, không tải cả 5 biến cùng lúc. Gió cần 2 biến
 *     (tốc độ và hướng), các biến khác chỉ cần một.
 *  2. 36 giờ thay vì 48: ngày đầu là thứ người dùng thật sự xem.
 *  3. Tối đa 225 điểm mỗi lần tải. Thêm điểm thì tốn hạn mức mà không thấy rõ,
 *     vì canvas vẫn mịn nhờ nội suy.
 *  4. Kéo bản đồ không tải lại nếu lưới còn phủ được vùng đang xem.
 */
const ANIM_HOURS = 36;
const ANIM_CHUNK = 140;          // dưới trần 144 toạ độ, đo thực nghiệm
const ANIM_NATIVE = 0.25;        // độ — không xin mịn hơn mô hình gốc

const ANIM_FIELDS = 'wind_speed_10m,wind_direction_10m,temperature_2m,cloud_cover,precipitation';

// Biến nào cần những biến nào. Gió cần hai; các biến khác chỉ cần chính nó.
const ANIM_NEEDS = {
  wind: ['wind_speed_10m', 'wind_direction_10m'],
  temp: ['temperature_2m'],
  cloud: ['cloud_cover'],
  rain: ['precipitation'],
  // Ba trường cho một chỉ số ghép. Cần đủ cả ba vì thiếu một thành phần thì
  // cách hiệu chuẩn khác nhau, và so sánh giữa các mức màu sẽ vô nghĩa.
  storm: ['cape', 'lifted_index', 'convective_inhibition'],
};

/*
 * Thang màu ghép từ nhiều điểm dừng, chọn để tương phản trên nền bản đồ vệ tinh.
 */
const ANIM_SCALES = {
  wind: {
    label: 'Gió 10 m', unit: 'km/h', kind: 'wind', field: 'wind_speed_10m',
    stops: [[0, '#2f6f9f'], [10, '#4fa3c7'], [20, '#57c0a8'], [32, '#8fd14f'],
            [45, '#f2c14e'], [60, '#f08a3c'], [80, '#e05252'], [110, '#c026d3']],
  },
  temp: {
    label: 'Nhiệt độ 2 m', unit: '°C', kind: 'scalar', field: 'temperature_2m',
    stops: [[12, '#2b4a8b'], [18, '#3f8fc4'], [23, '#63c2a8'], [28, '#f2d24e'],
            [33, '#ef8a3c'], [38, '#d93838'], [42, '#a01f5a']],
  },
  cloud: {
    label: 'Phủ mây', unit: '%', kind: 'scalar', field: 'cloud_cover',
    stops: [[0, '#101a2c'], [15, '#2c3f55'], [40, '#5b6f85'], [70, '#8d9bad'], [100, '#e8eef5']],
  },
  rain: {
    label: 'Lượng mưa', unit: 'mm/giờ', kind: 'scalar', field: 'precipitation',
    stops: [[0.02, '#1b3a6b'], [0.5, '#2f7fc1'], [2, '#43b06b'], [5, '#e8d24a'],
            [10, '#e0762f'], [20, '#d03434'], [40, '#b03ad0']],
  },
  storm: {
    label: 'Nguy cơ bão tố', unit: 'điểm 0–1', kind: 'scalar', field: 'storm_index',
    derived: true,
    stops: [[0.15, '#1d3b2f'], [0.35, '#3f7a44'], [0.5, '#c9c04a'], [0.65, '#ef9a35'],
            [0.8, '#e0503a'], [0.92, '#b02fb0'], [1, '#e8e0ff']],
  },
};

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return h.length > 7
    ? [(n >> 16) & 255, (n >> 8) & 255, n & 255, (n >>> 24) & 255]
    : [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** Màu của một giá trị, nội suy giữa các điểm dừng. */
function animColour(stops, v) {
  if (!E.finite(v)) return null;
  if (v <= stops[0][0]) return hexToRgb(stops[0][1]);
  const last = stops[stops.length - 1];
  if (v >= last[0]) return hexToRgb(last[1]);
  for (let i = 1; i < stops.length; i++) {
    if (v > stops[i][0]) continue;
    const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
    const f = (v - v0) / (v1 - v0);
    const a = hexToRgb(c0), b = hexToRgb(c1);
    return [
      Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f), Math.round(a[3] + (b[3] - a[3]) * f),
    ];
  }
  return hexToRgb(last[1]);
}

const anim = {
  on: false, playing: false, varKey: 'wind', hour: 0,
  grid: null, cache: new Map(), timer: 0, raf: 0, last: 0,
  particlesOn: true, contours: false, dragging: false,
};

/*
 * Lưới phủ rộng hơn khung nhìn một chút. Không có phần dư này thì chỉ cần kéo bản đồ
 * vài pixel là mép lưới lộ ra, và người dùng thấy một đường viền rỗng chạy ngang.
 */
const ANIM_MARGIN = 1.25;

/*
 * Mức phóng quyết định vùng phủ và độ thưa, theo đúng thứ dữ liệu cho phép:
 * thu nhỏ xa thì ô phải thưa để số điểm vẫn nằm trong ngân sách; phóng to thì
 * vùng phủ nhỏ lại, ô giữ nguyên 0,25° vì không có gì chi tiết hơn để hiện.
 */
const ANIM_TIERS = [
  { maxSpan: 1e9, step: 1.0, n: 15 },    // nhìn cả khu vực
  { maxSpan: 14, step: 0.5, n: 15 },     // vùng rộng, ô 0,5°
  { maxSpan: 7, step: 0.25, n: 15 },     // vùng vừa, ô 0,25°
  { maxSpan: 3.5, step: 0.25, n: 13 },   // phóng to, vùng nhỏ, ô vẫn 0,25°
];

function animTierForView() {
  if (!radarMap) return ANIM_TIERS[2];
  const b = radarMap.getBounds();
  const span = Math.max(Math.abs(b.getEast() - b.getWest()), Math.abs(b.getNorth() - b.getSouth()));
  for (const t of ANIM_TIERS) if (span * ANIM_MARGIN <= t.maxSpan) return t;
  return ANIM_TIERS[ANIM_TIERS.length - 1];
}

function animCenterForView() {
  if (!radarMap) return { lat: place.lat, lon: place.lon };
  const c = radarMap.getCenter();
  return { lat: c.lat, lon: c.lng ?? c.lon };
}

/** Lưới hiện tại còn phủ được vùng đang xem không — quyết định có tải lại không. */
function animGridCoversView(grid, grow) {
  if (!grid || !radarMap) return false;
  const g = grow == null ? 0.15 : grow;
  const b = radarMap.getBounds();
  const west = grid.lon0 - (grid.n - 1) * grid.step * g;
  const east = grid.lon0 + (grid.n - 1) * grid.step * (1 + g);
  const south = grid.lat0 - (grid.n - 1) * grid.step * g;
  const north = grid.lat0 + (grid.n - 1) * grid.step * (1 + g);
  return b.getWest() >= west && b.getEast() <= east
    && b.getSouth() >= south && b.getNorth() <= north;
}

const animCacheKey = (center, tier, fields) =>
  center.lat.toFixed(2) + ',' + center.lon.toFixed(2) + ',' + tier.step.toFixed(3) + ',' + fields.join('+');

async function fetchAnimChunk(lats, lons, fields, attempt = 0) {
  const u = new URLSearchParams({
    latitude: lats.join(','), longitude: lons.join(','),
    hourly: fields.join(','), forecast_days: '2',
    wind_speed_unit: 'kmh', timezone: 'Asia/Ho_Chi_Minh',
  });
  try {
    const j = await api('https://api.open-meteo.com/v1/forecast', u);
    return Array.isArray(j) ? j : null;
  } catch (e) {
    // Hạn mức miễn phí tính theo giờ DỮ LIỆU và cạn trong một khoảng thời gian,
    // nên lần thử sau phải chờ đủ lâu mới có cơ hội.
    if (/hourly api request limit|429/i.test(e.message)) {
      const err = new Error('đã hết hạn mức lượt gọi của Open-Meteo trong giờ này');
      err.quota = true;
      throw err;
    }
    if (attempt < 4 && /overload|503|502|timeout/i.test(e.message)) {
      await new Promise(r => setTimeout(r, [1500, 4000, 9000, 16000][attempt]));
      return fetchAnimChunk(lats, lons, fields, attempt + 1);
    }
    return null;
  }
}

/** Tải MỘT biến (hoặc hai biến ghép nhau) cho một vùng, chia thành khối 140 điểm. */
async function fetchAnimGrid(varKey, tier, center, onProgress) {
  const fields = ANIM_NEEDS[varKey] || [ANIM_SCALES[varKey].field];
  const key = animCacheKey(center, tier, fields);
  if (anim.cache.has(key)) return anim.cache.get(key);
  const n = tier.n, step = tier.step;
  const lat0 = center.lat - ((n - 1) * step) / 2;
  const lon0 = center.lon - ((n - 1) * step) / 2;
  const lats = [], lons = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      lats.push((lat0 + j * step).toFixed(4));
      lons.push((lon0 + i * step).toFixed(4));
    }
  }
  const total = Math.ceil(lats.length / ANIM_CHUNK);
  const pts = [];
  let done = 0;
  for (let s = 0; s < lats.length; s += ANIM_CHUNK) {
    const part = await fetchAnimChunk(lats.slice(s, s + ANIM_CHUNK), lons.slice(s, s + ANIM_CHUNK), fields);
    if (part) pts.push(...part);
    done++;
    if (onProgress) onProgress(done, total);
    if (s + ANIM_CHUNK < lats.length) await new Promise(r => setTimeout(r, 600));
  }
  if (pts.length < n * n * 0.6) {
    throw new Error('chỉ tải được ' + pts.length + '/' + (n * n) + ' điểm');
  }
  const hours = pts[0].hourly.time.slice(0, ANIM_HOURS);
  const grid = {
    lat0, lon0, n, step, hours, fields: {}, varKey,
    missing: n * n - pts.length, km: Math.round(step * 111),
  };
  for (const f of fields) {
    const flat = new Float32Array(n * n * hours.length).fill(NaN);
    for (let idx = 0; idx < pts.length; idx++) {
      const row = (idx / n) | 0, col = idx % n;
      const arr = pts[idx].hourly[f];
      if (!arr || row >= n) continue;
      const base = (row * n + col) * hours.length;
      for (let h = 0; h < hours.length; h++) flat[base + h] = arr[h] == null ? NaN : arr[h];
    }
    grid.fields[f] = flat;
  }
  // Biến ghép: gộp ba trường thô thành MỘT trường để phần vẽ không phải biết
  // chuyện gì. Làm ở đây chứ không ở lúc vẽ vì trường ghép không phụ thuộc khung
  // hình — tính một lần cho cả 36 giờ.
  if (varKey === 'storm' && grid.fields.cape) {
    const nh2 = hours.length;
    const idx = new Float32Array(n * n * nh2).fill(NaN);
    for (let i = 0; i < n * n * nh2; i++) {
      const r = E.lightningIndex({
        cape: grid.fields.cape[i],
        liftedIndex: grid.fields.lifted_index ? grid.fields.lifted_index[i] : null,
        convectiveInhibition: grid.fields.convective_inhibition ? grid.fields.convective_inhibition[i] : null,
      });
      if (r) idx[i] = r.risk;
    }
    grid.fields.storm_index = idx;
  }
  anim.cache.set(key, grid);
  return grid;
}

/**
 * Tải lưới, lùi dần về bậc thưa hơn nếu bị từ chối.
 *
 * Hạn mức là theo giờ và không công bố, nên một lần lỗi có thể chỉ là hơi sớm.
 * Thay vì để người dùng nhìn thông báo lỗi, thử bậc nhỏ hơn: ô thưa hơi thì ít điểm
 * phải tải và nhiều khả năng lọt. Báo rõ là đã lùi bậc, vì lưới thưa là dữ liệu ít
 * hơn và người đọc phải biết.
 */
async function fetchAnimGridWithFallback(varKey, tier, center, onProgress) {
  let i = ANIM_TIERS.indexOf(tier);
  if (i < 0) i = ANIM_TIERS.length - 1;
  const start = i;
  let lastErr = null;
  for (; i >= 0; i--) {
    try {
      const g = await fetchAnimGrid(varKey, ANIM_TIERS[i], center, onProgress);
      if (i < start) { g.fallbackFrom = ANIM_TIERS[start].step; g.fallbackTo = ANIM_TIERS[i].step; }
      return g;
    } catch (e) {
      lastErr = e;
      if (e.quota) throw e;   // hết hạn mức thì lùi bậc cũng vô ích
    }
  }
  throw lastErr || new Error('không tải được lưới nào');
}

/** Nội suy song tuyến tại vị trí tương đối fx, fy trong lưới (0..1). */
function animSample(grid, field, fx, fy, hour) {
  const flat = grid.fields[field];
  if (!flat) return null;
  const n = grid.n, nh = grid.hours.length;
  const gx = Math.max(0, Math.min(1, fx)) * (n - 1);
  const gy = Math.max(0, Math.min(1, fy)) * (n - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
  const tx = gx - x0, ty = gy - y0;
  const at = (x, y) => flat[(y * n + x) * nh + hour];
  const v = [at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)];
  if (!v.every(E.finite)) return null;
  return (v[0] * (1 - tx) + v[1] * tx) * (1 - ty) + (v[2] * (1 - tx) + v[3] * tx) * ty;
}

/**
 * Hạt gió: vị trí lưu dạng tỉ lệ 0..1 trong lưới để không phụ thuộc mức phóng.
 * Số hạt theo tỉ lệ vùng đang nhìn thấy, và hạt được sinh lại ngay trong khung
 * nhìn thấy — nếu không, phóng to thì hạt nằm ngoài màn hình và bản đồ trống dần,
 * đúng lúc người dùng muốn nhìn kỹ nhất.
 */
const animParticles = [];
const ANIM_PARTICLE_BASE = 1100;

function animVisibleFraction(grid) {
  if (!radarMap) return { x0: 0, y0: 0, x1: 1, y1: 1, area: 1 };
  const b = radarMap.getBounds();
  const span = (grid.n - 1) * grid.step;
  const fx0 = (b.getWest() - grid.lon0) / span, fx1 = (b.getEast() - grid.lon0) / span;
  const fy0 = (b.getSouth() - grid.lat0) / span, fy1 = (b.getNorth() - grid.lat0) / span;
  const x0 = Math.max(0, Math.min(1, fx0)), x1 = Math.max(0, Math.min(1, fx1));
  const y0 = Math.max(0, Math.min(1, fy0)), y1 = Math.max(0, Math.min(1, fy1));
  return { x0, y0, x1, y1, area: Math.max(0, (x1 - x0) * (y1 - y0)) };
}

function animSpawn(p, vis) {
  p.x = vis.x0 + Math.random() * (vis.x1 - vis.x0);
  p.y = vis.y0 + Math.random() * (vis.y1 - vis.y0);
  p.age = 20 + Math.random() * 110;
  p.fade = 0;
}

function animSeedParticles(grid) {
  if (!grid) return;
  const vis = animVisibleFraction(grid);
  const target = Math.max(120, Math.round(ANIM_PARTICLE_BASE * Math.min(1, vis.area * 1.6)));
  animParticles.length = 0;
  for (let i = 0; i < target; i++) {
    const p = { x: 0, y: 0, age: 0, fade: 0 };
    animSpawn(p, vis);
    animParticles.push(p);
  }
}
/*
 * Vẽ một khung hình.
 *
 * Canvas trường nhỏ đúng bằng số ô lưới, đổ màu từng ô, rồi phóng to lên khung
 * bản đồ với bộ lọc nội suy. Cách này nhanh hơn vẽ từng pixel hàng trăm lần và
 * mịn hơn hẳn so với nối các ô thành hình chữ nhật.
 */
function animDrawField(grid, hour) {
  const spec = ANIM_SCALES[anim.varKey];
  if (!grid.fields[spec.field]) {
    const m = $('animMsg');
    if (m) m.textContent = 'Lưới hiện tại chưa có biến ' + spec.label.toLowerCase() + ' — đang tải lại…';
    animRefreshNow(true);
    return;
  }
  const n = grid.n, nh = grid.hours.length;
  const small = anim.fieldCanvas;
  if (!small || small.width !== n || small.height !== n) { small.width = n; small.height = n; }
  const ctx = small.getContext('2d');
  const img = ctx.createImageData(n, n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const v = grid.fields[spec.field][(row * n + col) * nh + hour];
      const c = animColour(spec.stops, v);
      const o = (row * n + col) * 4;
      if (!c) { img.data[o + 3] = 0; continue; }
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = c[3];
    }
  }
  ctx.putImageData(img, 0, 0);

  // Góc trên-trái trên màn hình là BẮC-TÂY, không phải nam-tây: trục y của
  // Leaflet đi xuống khi vĩ độ tăng. Lấy nhầm góc sẽ ra chiều cao âm.
  const nw = radarMap.latLngToContainerPoint([grid.lat0 + (n - 1) * grid.step, grid.lon0]);
  const se = radarMap.latLngToContainerPoint([grid.lat0, grid.lon0 + (n - 1) * grid.step]);
  // Bản đồ có thể chưa đo được (tab đang ẩn lúc khởi tạo), khiến toạ độ là NaN.
  // Canvas không nhận kích thước NaN nên sẽ giữ nguyên 300×150 và im lặng —
  // vì vậy phải chặn trước và báo lại thay vì vẽ sai.
  if (!E.finite(nw.x) || !E.finite(nw.y) || !E.finite(se.x) || !E.finite(se.y)) {
    const m = $('animMsg');
    if (m) m.textContent = 'Chưa đo được khung bản đồ — hãy phóng to hoặc kéo bản đồ rồi thử lại.';
    return;
  }
  const w = Math.max(1, Math.round(se.x - nw.x)), h = Math.max(1, Math.round(se.y - nw.y));
  const view = $('animCanvas');
  if (view.width !== w || view.height !== h) { view.width = w; view.height = h; }
  const vctx = view.getContext('2d');
  vctx.globalCompositeOperation = 'source-over';
  vctx.clearRect(0, 0, w, h);
  vctx.imageSmoothingEnabled = true;
  vctx.imageSmoothingQuality = 'high';
  // Phóng ra thêm nửa ô mỗi cạnh để mép lưới không hở khi kéo bản đồ.
  vctx.drawImage(small, 0, 0, n, n, -1, -1, w + 2, h + 2);
  animDrawContours(ctx, small, grid, spec, hour);
  animPlaceCanvas();
}

/*
 * Đường đồng mức.
 *
 * Vẽ trên canvas nhỏ rồi phóng to cùng ảnh phẳng. Không có bước này thì màu
 * trơn trông như một tấm ảnh nhuộm và người đọc không có neo định lý — chỉ có
 * "tốt/xấu", không có "ở đâu". Ở mức phóng thấp màu tương phản kém nên bỏ qua,
 * vì đường mảnh trên nền tối chỉ làm nhoè thêm.
 */
function animDrawContours(ctx, small, grid, spec, hour) {
  if (anim.contours) return;
  if ((radarMap?.getZoom() || 0) < 5) return;
  const n = grid.n, nh = grid.hours.length;
  const values = [];
  let lo = Infinity, hi = -Infinity;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const v = grid.fields[spec.field][(row * n + col) * nh + hour];
      values.push(E.finite(v) ? v : null);
      if (E.finite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  if (!(hi > lo)) return;
  const levels = [];
  const stepLv = (hi - lo) / 6;
  for (let i = 1; i <= 6; i++) levels.push(lo + i * stepLv);

  ctx.clearRect(0, 0, small.width, small.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(0.08, 1 / n * 1.2);
  const at = (row, col) => values[row * n + col];
  // Nội suy cạnh theo tỉ lệ giá trị để đường cắt đúng chỗ, không bị lệch nửa ô.
  const edge = (a, b) => {
    if (a == null || b == null || a === b) return null;
    return null;   // điểm cắt được xử lý bên dưới
  };
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = at(row, col), b = at(row, col + 1), c = at(row + 1, col + 1), d = at(row + 1, col);
      if (a == null || b == null || c == null || d == null) continue;
      const x0 = col, x1 = col + 1, y0 = row, y1 = row + 1;
      for (const lv of levels) {
        const pts = [];
        const cut = (va, vb, px, py) => {
          if ((va < lv && vb >= lv) || (vb < lv && va >= lv)) {
            const t = (lv - va) / (vb - va);
            pts.push([px + (qb - pa) * t, py + (rb - ra) * t]);
          }
        };
        let pa, pb, ra, rb;
        pa = x0; pb = x1; ra = y0; rb = y0; cut(a, b, pa, pb, ra, rb);
        pa = x1; pb = x1; ra = y0; rb = y1; cut(b, c, pa, pb, ra, rb);
        pa = x1; pb = x0; ra = y1; rb = y1; cut(c, d, pa, pb, ra, rb);
        pa = x0; pb = x0; ra = y1; rb = y0; cut(d, a, pa, pb, ra, rb);
        if (pts.length < 2) continue;
        ctx.beginPath();
        // Đoạn ngắn nhất giữa các điểm cắt là cạnh đường đồng mức trong ô.
        let best = null, bestLen = Infinity;
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const dd = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2;
            if (dd < bestLen) { bestLen = dd; best = [pts[i], pts[j]]; }
          }
        }
        if (!best || bestLen > 2) continue;
        ctx.moveTo(best[0][0], best[0][1]);
        ctx.lineTo(best[1][0], best[1][1]);
        ctx.stroke();
      }
    }
  }
}

/** Toạ độ pixel của một hạt gió. */
function animParticlePoint(grid, p) {
  const n = grid.n;
  return radarMap.latLngToContainerPoint([
    grid.lat0 + p.y * (n - 1) * grid.step,
    grid.lon0 + p.x * (n - 1) * grid.step,
  ]);
}

function animDrawParticles(grid, hour, dt) {
  if (!anim.particlesOn) return;
  const view = $('animCanvas');
  const pc = $('animParticles');
  if (!view.width) return;
  const pctx = pc.getContext('2d');
  if (pc.width !== view.width || pc.height !== view.height) {
    pc.width = view.width; pc.height = view.height;
  }
  // Xoá dần bằng chính canvas đang vẽ để hạt để lại vệt, thay vì xoá sạch mỗi
  // khung hình. Canvas hạt nằm riêng nên không xoá lớp trường đã vẽ.
  pctx.globalCompositeOperation = 'destination-out';
  pctx.fillStyle = 'rgba(0,0,0,0.18)';
  pctx.fillRect(0, 0, pc.width, pc.height);
  pctx.globalCompositeOperation = 'source-over';

  const vis = animVisibleFraction(grid);
  const step = Math.max(0.35, dt / 16);
  const stops = ANIM_SCALES.wind.stops;
  for (const p of animParticles) {
    if (!grid.fields.wind_speed_10m || !grid.fields.wind_direction_10m) return;
    const spd = animSample(grid, 'wind_speed_10m', p.x, p.y, hour);
    const dir = animSample(grid, 'wind_direction_10m', p.x, p.y, hour);
    p.age -= 1;
    // Ra khỏi khung nhìn thấy hoặc hết tuổi thì sinh lại ngay trong khung.
    if (p.age <= 0 || spd == null || dir == null
      || p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) {
      animSpawn(p, vis);
      continue;
    }
    p.fade = Math.min(1, p.fade + 0.06);
    // Hướng khí tượng là hướng gió thổi TỪ, nên vectơ chuyển động là phủ định.
    const rad = dir * Math.PI / 180;
    const degPerHour = spd * ((grid.step * 111) / (grid.n - 1)) / 3600;
    p.x -= Math.sin(rad) * degPerHour * step * 5;
    p.y -= Math.cos(rad) * degPerHour * step * 5;

    const pt = animParticlePoint(grid, p);
    const len = 1.5 + spd * 0.13;
    const c = animColour(stops, spd);
    const alpha = 0.30 + 0.55 * p.fade;
    pctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
    pctx.lineWidth = 1.1;
    pctx.beginPath();
    pctx.moveTo(pt.x, pt.y);
    pctx.lineTo(pt.x + Math.sin(rad) * len, pt.y - Math.cos(rad) * len);
    pctx.stroke();
  }
}
function animDrawContours(ctx, small, grid, spec, hour) {
  if (anim.contours) return;
  if ((radarMap?.getZoom() || 0) < 5) return;
  const n = grid.n, nh = grid.hours.length;
  const at = (row, col) => {
    if (row < 0 || col < 0 || row >= n || col >= n) return null;
    const v = grid.fields[spec.field][(row * n + col) * nh + hour];
    return E.finite(v) ? v : null;
  };
  // Chỉ cần biết giá trị nhỏ nhất và lớn nhất để chia mức.
  let lo = Infinity, hi = -Infinity;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const v = at(row, col);
      if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  if (!(hi > lo)) return;
  const lv = [];
  for (let i = 1; i <= 6; i++) lv.push(lo + ((hi - lo) * i) / 7);

  ctx.clearRect(0, 0, small.width, small.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(0.1, 1.2 / n);
  ctx.beginPath();
  // Cắt mỗi cạnh của ô, nội suy theo giá trị để đường đi đúng chỗ chứ không
  // lệch nửa ô; mỗi ô chỉ nối cặp điểm gần nhất (trường hợp đơn giản của
  // marching squares).
  const edge = (va, vb, p0, p1, level, out) => {
    if (va == null || vb == null || va === vb) return;
    if ((va < level) === (vb < level)) return;
    const t = (level - va) / (vb - va);
    out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
  };
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = at(row, col), b = at(row, col + 1), c = at(row + 1, col + 1), d = at(row + 1, col);
      if (a == null || b == null || c == null || d == null) continue;
      const x = col, y = row;
      for (const level of lv) {
        const pts = [];
        edge(a, b, [x, y], [x + 1, y], level, pts);
        edge(b, c, [x + 1, y], [x + 1, y + 1], level, pts);
        edge(c, d, [x + 1, y + 1], [x, y + 1], level, pts);
        edge(d, a, [x, y + 1], [x, y], level, pts);
        if (pts.length < 2) continue;
        let best = null, bestLen = Infinity;
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const dd = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2;
            if (dd < bestLen) { bestLen = dd; best = [pts[i], pts[j]]; }
          }
        }
        if (!best || bestLen > 1.6) continue;
        ctx.moveTo(best[0][0], best[0][1]);
        ctx.lineTo(best[1][0], best[1][1]);
      }
    }
  }
  ctx.stroke();
}
/*
 * Toạ độ pixel của một hạt gió. */
function animParticlePoint(grid, p) {
  const n = grid.n;
  return radarMap.latLngToContainerPoint([
    grid.lat0 + p.y * (n - 1) * grid.step,
    grid.lon0 + p.x * (n - 1) * grid.step,
  ]);
}

function animDrawParticles(grid, hour, dt) {
  if (!anim.particlesOn) return;
  const view = $('animCanvas');
  const pc = $('animParticles');
  if (!view.width) return;
  const pctx = pc.getContext('2d');
  if (pc.width !== view.width || pc.height !== view.height) {
    pc.width = view.width; pc.height = view.height;
  }
  // Xoá dần bằng chính canvas đang vẽ để hạt để lại vệt, thay vì xoá sạch mỗi
  // khung hình. Canvas hạt nằm riêng nên không xoá lớp trường đã vẽ.
  pctx.globalCompositeOperation = 'destination-out';
  pctx.fillStyle = 'rgba(0,0,0,0.18)';
  pctx.fillRect(0, 0, pc.width, pc.height);
  pctx.globalCompositeOperation = 'source-over';

  const vis = animVisibleFraction(grid);
  const step = Math.max(0.35, dt / 16);
  const stops = ANIM_SCALES.wind.stops;
  for (const p of animParticles) {
    const spd = animSample(grid, 'wind_speed_10m', p.x, p.y, hour);
    const dir = animSample(grid, 'wind_direction_10m', p.x, p.y, hour);
    p.age -= 1;
    // Ra khỏi khung nhìn thấy hoặc hết tuổi thì sinh lại ngay trong khung.
    if (p.age <= 0 || spd == null || dir == null
      || p.x < vis.x0 || p.x > vis.x1 || p.y < vis.y0 || p.y > vis.y1) {
      animSpawn(p, vis);
      continue;
    }
    p.fade = Math.min(1, p.fade + 0.06);
    // Hướng khí tượng là hướng gió thổi TỪ, nên vectơ chuyển động là phủ định.
    const rad = dir * Math.PI / 180;
    const degPerHour = spd * ((grid.step * 111) / (grid.n - 1)) / 3600;
    p.x -= Math.sin(rad) * degPerHour * step * 5;
    p.y -= Math.cos(rad) * degPerHour * step * 5;

    const pt = animParticlePoint(grid, p);
    const len = 1.5 + spd * 0.13;
    const c = animColour(stops, spd);
    const alpha = 0.30 + 0.55 * p.fade;
    pctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
    pctx.lineWidth = 1.1;
    pctx.beginPath();
    pctx.moveTo(pt.x, pt.y);
    pctx.lineTo(pt.x + Math.sin(rad) * len, pt.y - Math.cos(rad) * len);
    pctx.stroke();
  }
}

/**
 * Đọc giá trị tại điểm bấm trên bản đồ.
 *
 * Chỉ nội suy trên lưới đã tải. Ở ngoài phạm vi lưới thì nói rõ là ngoài phạm
 * vi thay vì kéo giá trị ở mép ra — biểu diễn giá trị ở rìa như một số thật ở
 * một điểm cách nửa trăm kilomet là sai.
 */
function animValueAt(containerPoint) {
  const g = anim.grid;
  if (!g) return null;
  const ll = radarMap.containerPointToLatLng(containerPoint);
  const span = (g.n - 1) * g.step;
  const fx = (ll.lng - g.lon0) / span;
  const fy = (ll.lat - g.lat0) / span;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return { outside: true, lat: ll.lat, lon: ll.lng };
  const spec = ANIM_SCALES[anim.varKey];
  const hour = anim.hour;
  const out = { outside: false, lat: ll.lat, lon: ll.lng, label: spec.label, unit: spec.unit };
  if (anim.varKey === 'wind') {
    const s = animSample(g, 'wind_speed_10m', fx, fy, hour);
    const d = animSample(g, 'wind_direction_10m', fx, fy, hour);
    if (s == null || d == null) return null;
    out.value = `${E.round(s, 1)} km/h · hướng ${E.round(d, 0)}°`;
    out.color = animColour(ANIM_SCALES.wind.stops, s);
  } else {
    if (!g.fields[spec.field]) return null;
    const v = animSample(g, spec.field, fx, fy, hour);
    if (v == null) return null;
    out.value = anim.varKey === 'storm'
      ? `${E.round(v, 2)} (0–1) — mức ${esc((stormLevel(v, (stormReference() || {}).loc?.bands)?.name || '—').toLowerCase())}`
      : `${E.round(v, 1)} ${spec.unit}`;
    out.color = animColour(spec.stops, v);
  }
  return out;
}

function animShowReadout(containerPoint) {
  const box = $('animReadout');
  if (!box) return;
  const r = animValueAt(containerPoint);
  if (!r) { box.hidden = true; return; }
  if (r.outside) {
    box.hidden = false;
    box.innerHTML = `<span class="tiny">Ngoài phạm vi lưới đã tải (${E.round(r.lat, 2)}°, ${E.round(r.lon, 2)}°). Kéo bản đồ để lưới tải theo vùng đang xem.</span>`;
    return;
  }
  const [cr, cg, cb] = r.color;
  box.hidden = false;
  box.innerHTML = `<i style="background:rgb(${cr},${cg},${cb})"></i><strong>${esc(r.label)}:</strong> ${esc(r.value)}`
    + `<span class="tiny"> @ ${E.round(r.lat, 2)}°, ${E.round(r.lon, 2)}° · ô lưới ${anim.grid.km} km</span>`;
}
function animTick(now) {
  if (!anim.on || !anim.grid) return;
  const dt = anim.last ? Math.min(90, now - anim.last) : 16;
  anim.last = now;
  if (anim.dirty || now - (anim.drawnAt || 0) > 300) {
    anim.dirty = false;
    anim.drawnAt = now;
    animDrawField(anim.grid, anim.hour);
    animUpdateTimeLabel();
  }
  animDrawParticles(anim.grid, anim.hour, dt);
  anim.raf = requestAnimationFrame(animTick);
}

/* ---------- điều khiển bản đồ động ---------- */

function animUpdateTimeLabel() {
  const g = anim.grid;
  const el = $('animTime');
  if (el && g) {
    const d = new Date(g.hours[anim.hour] + ':00+07:00');
    el.textContent = d.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }
  const sl = $('animSlider');
  if (sl && +sl.value !== anim.hour) sl.value = anim.hour;
}

function animLegendHtml() {
  const spec = ANIM_SCALES[anim.varKey];
  const s = spec.stops;
  const bar = s.map((st, i) => `${st[1]} ${(i / (s.length - 1)) * 100}%`).join(', ');
  const ticks = s.map((st, i) => (i % 2 === 0 || i === s.length - 1
    ? `<span style="left:${(i / (s.length - 1)) * 100}%">${st[0]}</span>` : '')).join('');
  const g = anim.grid;
  if (anim.varKey === 'storm') {
    return '<strong>Nguy cơ bão tố (điểm 0–1)</strong>'
      + '<span class="anim-ramp" style="background:linear-gradient(90deg,' + s.map((st, i) => `${st[1]} ${(i / (s.length - 1)) * 100}%`).join(', ') + ')"></span>'
      + '<span class="tiny">Ghép từ CAPE, lifted index và CIN của mô hình — là chỉ số năng lượng đối lưu, '
      + 'KHÔNG phải dự báo tia sét (không có nguồn mở nào cấp dữ liệu sét ở Việt Nam). '
      + 'Mức đã hiệu chuẩn trên 12 tháng và chấm điểm ở tab Phương pháp. '
      + stormSkillSentence() + ' Dùng để biết lúc nào khí quyển dễ bốc lên, KHÔNG dùng làm cảnh báo.</span>';
  }
  return `<strong>${spec.label} (${spec.unit})</strong>`
    + `<span class="anim-ramp" style="background:linear-gradient(90deg,${bar})">${ticks}</span>`
    + `<span class="tiny">Lưới ${g ? g.n + '×' + g.n : '—'} điểm, mỗi ô ${g ? g.km : '—'} km`
    + `${g && g.step <= 0.25 ? ' — đúng độ phân giải gốc 0,25° của mô hình' : ' — ô thưa hơn vì đang nhìn vùng rộng'}. `
    + (g && g.fallbackFrom ? `Hạn mức lượt gọi buộc phải dùng ô thưa hơn mức mong muốn. ` : '')
    + `Ảnh phẳng được nội suy bằng trình duyệt cho mượt; nó không thêm thông tin nào ngoài dữ liệu gốc. `
    + `Cùng dữ liệu này đã được hiệu chỉnh và kiểm thử ở tab Phương pháp.</span>`;
}

function animPlaceCanvas() {
  if (!anim.grid || !radarMap) return;
  const g = anim.grid;
  const nw = radarMap.latLngToContainerPoint([g.lat0 + (g.n - 1) * g.step, g.lon0]);
  for (const id of ['animCanvas', 'animParticles']) {
    const c = $(id);
    if (c) { c.style.left = nw.x + 'px'; c.style.top = nw.y + 'px'; }
  }
}

/**
 * Lấy lại lưới cho vùng đang xem, sau một khoảng chờ ngắn.
 *
 * Người dùng kéo bản đồ liên tục sẽ tạo ra hàng chục lần gọi nếu tải ngay, và
 * mỗi lần là vài request. Chờ 1,2 giây im lặng rồi mới tải: đủ để khung hình
 * ngừng chạy, và vẫn nhận ra người dùng đã kết thúc thao tác.
 */
function animRefreshSoon() {
  if (!anim.on) return;
  if (anim.refreshTimer) clearTimeout(anim.refreshTimer);
  anim.refreshTimer = setTimeout(() => animRefreshNow(), 1200);
}

let animRefreshBusy = false;
async function animRefreshNow(force) {
  if (!anim.on || animRefreshBusy) return;
  const tier = animTierForView();
  const center = animCenterForView();
  const cur = anim.grid;
  /*
   * Lưới đang phủ được vùng nhìn thì không tải lại. Kéo bản đồ là hành động rất
   * thường xuyên, và mỗi lần tải lại là vài lượt gọi — mà hạn mức tính theo giờ
   * DỮ LIỆU nên vài lần kéo là đủ cạn. Chỉ khi lưới không còn phủ nổi vùng xem mới
   * tải lại, và lúc đó báo rõ là đang tải.
   */
  const needs = ANIM_NEEDS[anim.varKey] || [ANIM_SCALES[anim.varKey].field];
  const hasAll = cur && needs.every(f => cur.fields[f]);
  if (!force && hasAll && animGridCoversView(cur)) return;
  animRefreshBusy = true;
  const msg = $('animMsg');
  if (msg) msg.textContent = 'Đang tải lưới cho vùng đang xem…';
  try {
    const g = await fetchAnimGridWithFallback(anim.varKey, tier, center, (done, total) => {
      if (msg) msg.textContent = `Đang tải lưới cho vùng đang xem… ${done}/${total} phần`;
    });
    if (!anim.on) return;
    anim.grid = g;
    anim.dirty = true;
    const lg = $('animLegend');
    if (lg) lg.innerHTML = animLegendHtml();
    animSeedParticles(anim.grid);
    animPlaceCanvas();
    /*
     * Vẽ ngay sau khi nạp, không chờ vòng lặp khung hình. Ở tab chạy nền
     * requestAnimationFrame bị hãm nhịp, nên nếu chờ thì bản đồ cứ hiện trường
     * của lưới CŨ trong khi chú giải đã nói về lưới mới — trang mâu thuẫn với
     * chính nó. Khi vẽ xong thì đánh dấu đã vẽ để vòng lặp không vẽ lại ngay.
     */
    animDrawField(anim.grid, anim.hour);
    anim.drawnAt = performance.now();
    anim.dirty = false;
    if (msg) msg.textContent = '';
  } catch (e) {
    // Giữ nguyên lưới cũ: hơn là mất hẳn lớp động vì một lần tải hỏng.
    if (msg) msg.textContent = 'Giữ lưới cũ: ' + e.message;
  } finally {
    animRefreshBusy = false;
  }
}
const g0 = tier => tier.n * tier.n;

async function setAnimLayer(on) {
  const msg = $('animMsg');
  const btn = $('animToggle');
  if (!on) {
    anim.on = false;
    animPlay(false);
    if (anim.raf) cancelAnimationFrame(anim.raf);
    if (anim.refreshTimer) clearTimeout(anim.refreshTimer);
    anim.timer = anim.raf = anim.refreshTimer = 0;
    for (const id of ['animCanvas', 'animParticles']) {
      const c = $(id);
      if (c) c.style.display = 'none';
    }
    if ($('animControls')) $('animControls').hidden = true;
    if (btn) { btn.textContent = 'Bật bản đồ dự báo động'; btn.classList.add('primary'); btn.classList.remove('secondary'); }
    return;
  }
  if (!radarMap) { if (msg) msg.textContent = 'Hãy mở bản đồ radar trước khi bật lớp động.'; return; }
  const tier = animTierForView();
  if (msg) msg.textContent = `Đang tải ${ANIM_SCALES[anim.varKey].label.toLowerCase()} trên lưới ${tier.n * tier.n} điểm, mỗi ô ${Math.round(tier.step * 111)} km…`;
  try {
    anim.grid = await fetchAnimGridWithFallback(anim.varKey, tier, animCenterForView(), (done, total) => {
      if (msg) msg.textContent = `Đang tải lưới… ${done}/${total} phần`;
    });
  } catch (e) {
    if (msg) {
      msg.textContent = e.quota
        ? 'Open-Meteo đã hết hạn mức lượt gọi trong giờ này. Bản đồ động sẽ trở lại khi hạn mức reset — phần dự báo dạng bảng ở tab Dự báo không bị ảnh hưởng.'
        : 'Không tải được lưới dự báo: ' + e.message;
    }
    return;
  }
  if (!anim.fieldCanvas) anim.fieldCanvas = document.createElement('canvas');
  // Mở ra từ giờ hiện tại chứ không phải 00:00: nếu không, lớp động bắt đầu bằng
  // dữ liệu của đêm qua rồi chạy tới hiện tại, tức là mở đúng phần đã qua.
  const nowKey = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 13);
  const idx = anim.grid.hours.findIndex(h => h.slice(0, 13) >= nowKey);
  anim.hour = idx >= 0 ? idx : 0;
  anim.on = true;
  anim.dirty = true;
  anim.particlesOn = anim.varKey === 'wind';

  for (const id of ['animCanvas', 'animParticles']) {
    const c = $(id);
    if (c) c.style.display = 'block';
  }
  $('animControls').hidden = false;
  if (btn) { btn.textContent = 'Tắt bản đồ dự báo động'; btn.classList.remove('secondary'); btn.classList.add('primary'); }
  const sl = $('animSlider');
  if (sl) { sl.max = anim.grid.hours.length - 1; sl.value = anim.hour; }
  if ($('animLegend')) $('animLegend').innerHTML = animLegendHtml();
  const ptg = $('animParticlesToggle');
  if (ptg) ptg.checked = anim.particlesOn;
  animUpdateTimeLabel();
  if (msg) {
    msg.textContent = anim.grid.fallbackFrom
      ? `Hạn mức lượt gọi nên đã dùng ô ${anim.grid.km} km thay vì ${Math.round(anim.grid.fallbackFrom * 111)} km.`
      : '';
  }
  if (!anim.bound) {
    anim.bound = true;
    radarMap.on('move zoom resize', () => { anim.dirty = true; animPlaceCanvas(); animRefreshSoon(); });
    radarMap.on('click', e => animShowReadout(e.containerPoint));
    radarMap.on('mousemove', e => {
      if (anim.dragging) return;
      animShowReadout(e.containerPoint);
    });
    radarMap.on('dragstart', () => { anim.dragging = true; });
    radarMap.on('dragend', () => { anim.dragging = false; });
  }
  animSeedParticles(anim.grid);
  if (anim.raf) cancelAnimationFrame(anim.raf);
  anim.last = 0;
  // Vẽ ngay một khung thay vì chờ requestAnimationFrame đầu tiên: nếu tab đang
  // chạy nền, trình duyệt hãm nhịp khung hình và người dùng sẽ thấy lớp động
  // "không bật" dù nó đã bật. Hạt gió vẫn cần vòng lặp, nhưng trường thì không.
  animDrawField(anim.grid, anim.hour);
  for (let i = 0; i < 40; i++) animDrawParticles(anim.grid, anim.hour, 16);
  anim.raf = requestAnimationFrame(animTick);
}

function animPlay(on) {
  anim.playing = on;
  const b = $('animPlay');
  if (b) b.textContent = on ? '⏸ Tạm dừng' : '▶ Phát';
  if (anim.timer) { clearInterval(anim.timer); anim.timer = 0; }
  if (!on || !anim.grid) return;
  anim.timer = setInterval(() => {
    anim.hour = (anim.hour + 1) % anim.grid.hours.length;
    anim.dirty = true;
    // Cập nhật nhãn ngay ở đây, không chờ khung hình vẽ kế tiếp: tab chạy nền
    // bị trình duyệt hãm nhịp requestAnimationFrame, còn setInterval thì không.
    animUpdateTimeLabel();
  }, 700);
}

function animSetVar(key) {
  if (!ANIM_SCALES[key]) return;
  anim.varKey = key;
  anim.dirty = true;
  // Hạt gió chỉ có nghĩa với biến gió; bật biến khác thì tắt hạt để không vẽ rác.
  anim.particlesOn = key === 'wind';
  const pc = $('animParticles');
  if (pc) pc.getContext('2d').clearRect(0, 0, pc.width, pc.height);
  const sel = $('animVar');
  if (sel) sel.value = key;
  if ($('animLegend')) $('animLegend').innerHTML = animLegendHtml();
  const lbl = $('animParticlesNote');
  if (lbl) lbl.hidden = key !== 'wind';
  if (!anim.on) { setAnimLayer(true); return; }
  /*
   * Vẽ lại NGAY, không chờ vòng lặp khung hình.
   *
   * Ở tab chạy nền, requestAnimationFrame bị hãm nhịp, nên nếu chờ vòng lặp thì
   * đổi sang biến khác mà bản đồ vẫn hiện trường của biến cũ — chú giải đã đổi
   * nhưng hình thì không, tức trang tự mâu thuẫn với chính nó. Hạt gió cũng vậy:
   * bật ra mà bản đồ trống thì người dùng tưởng công tắc hỏng.
   */
  if (anim.grid) animDrawField(anim.grid, anim.hour);
  if (anim.particlesOn && anim.grid) {
    for (let i = 0; i < 40; i++) animDrawParticles(anim.grid, anim.hour, 16);
  }
  animPlaceCanvas();
}

/** Bật/tắt đường đồng mức và hạt gió. */
function animToggleLayer(name, on) {
  if (name === 'contours') {
    anim.contours = on;
    anim.dirty = true;
    if (!on) {
      const c = anim.fieldCanvas;
      if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
      anim.dirty = true;
    }
  } else if (name === 'particles') {
    anim.particlesOn = on && anim.varKey === 'wind';
    if (!on) {
      const pc = $('animParticles');
      if (pc) pc.getContext('2d').clearRect(0, 0, pc.width, pc.height);
    }
  }
}
/* ---------- tropical cyclones (GDACS positions, not our track forecast) ---------- */

const ALERT_RANK = { Green: 1, Orange: 2, Red: 3 };

// GDACS tra ve mot diem cho moi "episode" (moi vi tri ba gio). Cac episode
// cung lai duong da qua cua con xoay, nen ta ve duong nay va goi ro la
// duong da qua chu khong phai duong do bao.
async function loadTropicalCyclones() {
  const box = $('tcList');
  const meta = $('tcMeta');
  if (!box) return;
  box.innerHTML = '<p class="muted">Đang tải vị trí xoáy nhiệt đới…</p>';
  const now = new Date();
  const from = new Date(now.getTime() - 10 * 864e5).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 6 * 864e5).toISOString().slice(0, 10);
  try {
    const r = await fetch(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromDate=${from}&toDate=${to}`, { signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    if (j.error) throw new Error(j.reason || 'lỗi GDACS');
    const byStorm = new Map();
    for (const f of j.features || []) {
      const p = f.properties || {};
      // GDACS bo qua tham so loc eventtypes, phai tu loai lai phia may.
      if (p.eventtype !== 'TC') continue;
      const key = p.glide || p.eventname;
      if (!byStorm.has(key)) byStorm.set(key, { name: p.name || p.eventname, url: p.url, track: [] });
      const s = byStorm.get(key);
      if (p.alertlevel && (!s.alertRank || (ALERT_RANK[p.alertlevel] || 0) > (ALERT_RANK[s.alertRank] || 0))) s.alertRank = p.alertlevel;
      if (f.geometry && f.geometry.type === 'Point') {
        s.track.push({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], t: p.fromdate });
      }
    }
    const storms = [...byStorm.values()]
      .map(s => {
        s.track.sort((a, b) => String(a.t || '').localeCompare(String(b.t || '')));
        const last = s.track[s.track.length - 1];
        if (!last) return null;
        // Huong tien gan nhat: vector giua hai vi tri gan nhat da biet.
        let approach = null;
        if (s.track.length >= 2) {
          const a = s.track[s.track.length - 2], b = last;
          approach = E.bearingDeg({ lat: a.lat, lon: a.lon }, b);
        }
        return {
          ...s, last, approach,
          km: E.round(E.distanceKm(place, last), 0),
          bearing: E.bearingDeg(place, last),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.km - b.km);
    if (!storms.length) {
      box.innerHTML = '<p class="muted">Không có xoáy nhiệt đới nào đang hoạt động trong cửa sổ 10 ngày qua đến 6 ngày tới theo GDACS.</p>';
      if (meta) meta.textContent = '0 cơn';
      return;
    }
    box.innerHTML = storms.map(s => {
      const rank = ALERT_RANK[s.alertRank] === 3 ? 'red' : ALERT_RANK[s.alertRank] === 2 ? 'orange' : 'yellow';
      return `<div class="alert-item ${rank}">
        <h4>${esc(s.name)}${s.alertRank ? ` <span class="warn-chip ${rank}">${esc(s.alertRank)}</span>` : ''}</h4>
        <p>Tâm tại ${fmt(Math.abs(s.last.lat), 2)}° ${s.last.lat >= 0 ? 'B' : 'N'} · ${fmt(Math.abs(s.last.lon), 2)}° ${s.last.lon >= 0 ? 'Đ' : 'T'} — cách đây <strong>${fmt(s.km, 0)} km</strong> về phía ${compass(s.bearing)}.</p>
        ${s.approach != null ? `<p class="small">Hướng tiến gần nhất theo các vị trí GDACS: <strong>${compass(s.approach)}</strong> (${fmt(s.approach, 0)}°). Đây là hướng đi qua các điểm quan sát gần nhất, không phải dự báo chính thức.</p>` : ''}
        <p class="meta">${s.last.t ? 'Cập nhật ' + esc(String(s.last.t).slice(0, 16)).replace('T', ' ') + ' UTC · ' : ''}<a href="${esc(s.url || 'https://www.gdacs.org/')}" target="_blank" rel="noopener">GDACS</a> · <a href="https://www.jtwc.navy.mil/" target="_blank" rel="noopener">JTWC</a></p>
      </div>`;
    }).join('');
    if (meta) meta.textContent = storms.length + ' cơn · gần nhất ' + fmt(storms[0].km, 0) + ' km';
  } catch (e) {
    box.innerHTML = `<p class="small">Không lấy được dữ liệu xoáy nhiệt đới: ${esc(e.message)}</p>`;
    if (meta) meta.textContent = 'lỗi';
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
  initAnimControls();
  $('disasterRefreshRadar').onclick = () => {
    radarStop(false);
    if (radarMap) { try { radarMap.remove(); } catch (e) { /* bỏ qua */ } radarMap = null; }
    radarLayer = null; radarFadeLayer = null;
    // Phải dựng lại đúng cấu trúc như lúc đầu: hai canvas của lớp động nằm
    // trong khung bản đồ, và innerHTML = '' sẽ xoá mất chúng.
    document.getElementById('radarMap').innerHTML = '<div id="radarMsg" class="notice">Đang tải lại radar…</div>'
      + '<canvas id="animCanvas" class="anim-canvas" aria-hidden="true" style="display:none"></canvas>'
      + '<canvas id="animParticles" class="anim-canvas" aria-hidden="true" style="display:none"></canvas>';
    radarInitialized = false;
    anim.grid = null; anim.cache.clear();
    const wantAnim = anim.on;
    anim.bound = false;
    initRadar();
    // Gọi lại nốt các handler vì các phần tử vừa bị thay.
    initAnimControls();
    if (wantAnim) initRadar().then(() => setAnimLayer(true));
  };
  $('disasterLoadAlerts').onclick = () => { loadAlerts(); loadTropicalCyclones(); };
  // Bat/tat lop khong khi tren ban do radar.
  $('airGridToggle').onclick = () => {
    const on = radarMap && airLayer && radarMap.hasLayer(airLayer);
    if (on) {
      radarMap.removeLayer(airLayer);
      $('airGridToggle').textContent = 'Bật khối khí trên bản đồ';
      $('airGridToggle').classList.remove('primary');
      $('airGridToggle').classList.add('secondary');
    } else {
      if (!airGrid) { $('airGridToggle').textContent = 'Đang tải…'; loadAirGrid(); }
      if (airGrid && radarMap && airLayer) {
        airLayer.addTo(radarMap);
        $('airGridToggle').textContent = 'Tắt khối khí trên bản đồ';
        $('airGridToggle').classList.remove('secondary');
        $('airGridToggle').classList.add('primary');
      }
    }
  };
}

/** Gắn bộ điều khiển của lớp bản đồ dự báo động. */
function initAnimControls() {
  const t = $('animToggle');
  if (t) t.onclick = () => setAnimLayer(!anim.on);
  const p = $('animPlay');
  if (p) p.onclick = () => animPlay(!anim.playing);
  const v = $('animVar');
  if (v) v.onchange = () => animSetVar(v.value);
  const s = $('animSlider');
  if (s) {
    s.oninput = () => { anim.hour = +s.value; anim.dirty = true; animUpdateTimeLabel(); };
    s.onchange = () => animPlay(false);
  }
  const c = $('animContours');
  if (c) c.onchange = () => animToggleLayer('contours', c.checked);
  const pt = $('animParticlesToggle');
  if (pt) pt.onchange = () => animToggleLayer('particles', pt.checked);
  const op = $('animOpacity');
  if (op) {
    const apply = () => {
      const v = +op.value / 100;
      const field = $('animCanvas'), part = $('animParticles');
      if (field) field.style.opacity = v;
      // Hạt gió mờ đi theo nhưng không tới mức biến mất, nếu không người dùng
      // tưởng lớp bị hỏng khi kéo thanh độ phủ.
      if (part) part.style.opacity = Math.min(1, 0.35 + v * 0.72);
    };
    op.oninput = apply;
    apply();
  }
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
      if (b.dataset.view === 'disaster' && !$('tcMeta').textContent.match(/\d/)) loadTropicalCyclones();
      if (b.dataset.view === 'news') {
        renderNchmf();
        renderIntlNews();
      }
    };
  });
}

wireTabs();
initDisasterTab();
initNewsTab();

initSelects();
initSearch();
initGeo();
quickRender();
renderNchmf();
renderIntlNews();
renderProtocol();
renderTest();
loadForecast();

// Tự động kiểm tra bản tin NCHMF mới nhất từ máy chủ
setTimeout(fetchLatestNchmf, 1200);

// Automatically request device location on startup if supported
if (navigator.geolocation && window.isSecureContext) {
  setTimeout(useDeviceLocation, 800);
}
