/**
 * ATMOS App - Air Mass & Trajectory
 * 850 hPa pressure level analysis
 */

import { selectors, state } from '../state/index.js';
import { $, fmt, finite, bearing, compass, esc } from '../helpers/index.js';
import { 
  LEVEL_VARS, 
  LEVEL_MODELS,
  api,
  MODELS 
} from '../api/index.js';

let levelsToken = 0;

/** Load air mass and river data */
export async function loadAirMassAndRivers(): Promise<void> {
  const place = selectors.currentPlace();
  
  // Load pressure levels
  loadLevels(place);
  
  // Load rivers
  loadRivers(place);
}

/** Fetch and render pressure level data */
async function loadLevels(place: any): Promise<void> {
  const token = ++levelsToken;
  state.loading.levels.set(true);
  
  try {
    const u = new URLSearchParams({
      latitude: place.lat,
      longitude: place.lon,
      hourly: LEVEL_VARS.join(','),
      models: LEVEL_MODELS.join(','),
      past_days: 7,
      forecast_days: 7,
      timezone: 'auto',
    });
    
    const data = await api('https://api.open-meteo.com/v1/forecast', Object.fromEntries(u.entries()));
    
    if (token !== levelsToken) return;
    
    const hourly = data.hourly || {};
    const series: Record<string, any> = {};
    
    for (const id of LEVEL_MODELS) {
      const cols: Record<string, any> = {};
      for (const v of LEVEL_VARS) cols[v] = hourly[v + '_' + id] || null;
      if (Object.values(cols).some(c => c && c.length)) series[id] = cols;
    }
    
    const levels = { 
      time: hourly.time || [], 
      series, 
      offsetSeconds: data.utc_offset_seconds || 0 
    };
    
    state.levels.set(levels);
    
    if (token === levelsToken) {
      renderAirMass();
      renderTrajectory();
    }
    
  } catch (err) {
    console.error('Levels load failed:', err);
  } finally {
    state.loading.levels.set(false);
  }
}

/** Render air mass classification */
function renderAirMass(): void {
  const E = (window as any).AtmosEngine;
  const box = $('airMassBox');
  const metaEl = $('massMeta');
  if (!box) return;
  
  const levels = state.levels.get();
  if (!levels) { 
    box.innerHTML = '<p class="muted">Chưa có dữ liệu mức áp lực.</p>'; 
    return; 
  }
  
  const time = levels.time;
  const now = levelNowIndex(levels);
  if (now == null || now < 0) { 
    box.innerHTML = '<p class="muted">Không xác định được giờ hiện tại.</p>'; 
    return; 
  }
  
  const ids = Object.keys(levels.series);
  
  // Mean fields
  const t850 = levelMean(time, 'temperature_850hPa', levels);
  const thick = time.map((_, i) => E.thickness(
    levelMean(time, 'geopotential_height_500hPa', levels)[i],
    levelMean(time, 'geopotential_height_850hPa', levels)[i]
  ));
  const rh850 = levelMean(time, 'relative_humidity_850hPa', levels);
  const dir850 = levelMean(time, 'wind_direction_850hPa', levels);
  const spd850 = levelMean(time, 'wind_speed_850hPa', levels);
  
  // Baseline (past 72h)
  const baseFrom = Math.max(0, now - 72);
  const pastT = t850.slice(baseFrom, now).filter(finite);
  const pastTh = thick.slice(baseFrom, now).filter(finite);
  const tBase = E.meanS(pastT);
  const thBase = E.meanS(pastTh);
  
  // Current air mass
  const am = E.airMass({
    t850: t850[now], t850Baseline: tBase,
    thick: thick[now], thickBaseline: thBase,
    rh850: rh850[now], source: dir850[now],
  });
  
  // Model agreement
  const perModel = ids.map(id => {
    const col = levelSeries(id, 'temperature_850hPa', time, levels);
    const z5 = levelSeries(id, 'geopotential_height_500hPa', time, levels);
    const z8 = levelSeries(id, 'geopotential_height_850hPa', time, levels);
    const th = E.thickness(z5[now], z8[now]);
    return { 
      id, 
      t850: col[now], 
      th, 
      tag: E.airMass({ 
        t850: col[now], t850Baseline: tBase, 
        thick: th, thickBaseline: thBase, 
        rh850: levelSeries(id, 'relative_humidity_850hPa', time, levels)[now], 
        source: levelSeries(id, 'wind_direction_850hPa', time, levels)[now] 
      }) 
    };
  });
  
  const votes: Record<string, number> = {};
  for (const p of perModel) if (p.tag) votes[p.tag.tag] = (votes[p.tag.tag] || 0) + 1;
  const agree = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
  const spreadT = Math.sqrt(E.varS(perModel.map(p => p.t850).filter(finite))) || 0;
  
  // Frontal passage
  const front = E.frontalPassage({ 
    dir850: dir850.slice(0, now + 1), 
    t850: t850.slice(0, now + 1), 
    hoursBack: 12 
  });
  
  const tagClass = am ? { cold: 'cold', warm: 'warm', cool: 'cool', mild: 'mild', neutral: 'neutral' }[am.tone] : 'neutral';
  
  if (metaEl) metaEl.textContent = 'Cập nhật: ' + new Date().toLocaleTimeString('vi-VN');
  
  box.innerHTML = 
    '<div class="mass-head">' +
      '<div><span class="small">PHÂN LOẠI KHỐI KHÔNG</span>' +
        '<div class="mass-tag ' + tagClass + '">' + (am ? am.tag : '—') + '</div></div>' +
      '<div class="mass-consensus"><strong>' + agree[1] + '/' + ids.length + '</strong><span class="small">hệ thống đồng ý</span></div>' +
    '</div>' +
    '<div class="metric-grid compact" style="margin:14px 0 0">' +
      '<div class="metric"><span class="small">Nhiệt độ 850 hPa</span><strong>' + (finite(t850[now]) ? fmt(t850[now], 1) : '—') + '<em>°C</em></strong>' +
        '<span class="small">' + (finite(t850[now]! - tBase) ? (t850[now]! - tBase >= 0 ? '+' : '') + fmt(t850[now]! - tBase, 1) + '° so với 7 ngày qua' : '—') + '</span></div>' +
      '<div class="metric"><span class="small">Độ dày cột 500–850</span><strong>' + (finite(thick[now]) ? fmt(thick[now] / 100, 1) : '—') + '<em>đạm</em></strong>' +
        '<span class="small">' + (finite(thick[now]! - thBase) ? (thick[now]! - thBase >= 0 ? '+' : '') + fmt(thick[now]! - thBase, 0) + ' m so với 7 ngày qua' : '—') + '</span></div>' +
      '<div class="metric"><span class="small">Gió 850 hPa</span><strong>' + (finite(dir850[now]) ? fmt(dir850[now], 0) + '<em>°</em>' : '—') + '</strong>' +
        '<span class="small">' + (finite(dir850[now]) ? 'từ phía ' + compass(dir850[now]) + (am?.advection ? ' · ' + am.advection : '') : '—') + '</span></div>' +
      '<div class="metric"><span class="small">Độ ẩm 850 hPa</span><strong>' + (finite(rh850[now]) ? fmt(rh850[now], 0) + '<em>%</em>' : '—') + '</strong>' +
        '<span class="small">' + (am?.moisture || '—') + '</span></div>' +
    '</div>' +
    '<p class="small" style="margin-top:12px">' + (ids.length ? 'Độ lệch giữa ' + ids.length + ' hệ thống ở 850 hPa: <strong>' + fmt(spreadT, 2) + '°C</strong>. ' : '') +
    (front ? 'Phát hiện <strong>' + front.kind.toLowerCase() + '</strong>: gió 850 hPa xoay ' + fmt(front.windShift, 0) + '° so với 12 giờ trước, nhiệt độ thay đổi ' + fmt(front.dT, 1) + '°C.' : 'Không phát hiện mặt lạnh hay mặt ấm trong 12 giờ vừa rồi.') +
    ' Độ dày cột là đại lượng phổ thông cho nhiệt độ căn bản của cột không khí: thấp hơn là lạnh hơn, cao hơn là nóng hơn.</p>';
}

/** Render trajectory fan */
function renderTrajectory(): void {
  const E = (window as any).AtmosEngine;
  const host = $('trajectory');
  if (!host) return;
  
  const levels = state.levels.get();
  if (!levels) { host.innerHTML = '<p class="muted">Chưa có dữ liệu mức áp lực.</p>'; return; }
  
  const time = levels.time;
  const now = levelNowIndex(levels);
  if (now == null || now < 0) { host.innerHTML = '<p class="muted">Không xác định được giờ hiện tại.</p>'; return; }
  
  const ids = Object.keys(levels.series);
  if (!ids.length) { host.innerHTML = '<p class="muted">Không có hệ thống nào trả dữ liệu.</p>'; return; }
  
  const backH = Math.min(24, now);
  const fwdH = Math.min(48, time.length - 1 - now);
  
  const runs = ids.map(id => {
    const spd = levelSeries(id, 'wind_speed_850hPa', time, levels);
    const dir = levelSeries(id, 'wind_direction_850hPa', time, levels);
    
    const uB = [], vB = [], uF = [], vF = [];
    for (let h = backH; h >= 1; h--) {
      const w = E.toUms(spd[now - h], dir[now - h]); uB.push(w.u); vB.push(w.v);
    }
    for (let h = 0; h < fwdH; h++) {
      const w = E.toUms(spd[now + h], dir[now + h]); uF.push(w.u); vF.push(w.v);
    }
    
    return {
      id,
      back: E.trajectory({ lat: selectors.currentPlace().lat, lon: selectors.currentPlace().lon, u: uB, v: vB, hours: backH, stepKm: 20, sign: -1 }),
      fwd: E.trajectory({ lat: selectors.currentPlace().lat, lon: selectors.currentPlace().lon, u: uF, v: vF, hours: fwdH, stepKm: 20, sign: 1 }),
    };
  }).filter(r => r.back.length > 2 && r.fwd.length > 2);
  
  if (!runs.length) { host.innerHTML = '<p class="muted">Dữ liệu gió 850 hPa không đủ để vẽ đường đi.</p>'; return; }
  
  const pts = [];
  for (const r of runs) { pts.push(...r.back.slice(1), ...r.fwd.slice(1)); }
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  let lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  let lat1 = lat0;
  let lon0 = Math.min(...lons), lon1 = Math.max(...lons);
  if (lon1 - lon0 < 2) { lon0 -= 1; lon1 += 1; }
  if (lat1 - lat0 < 2) { lat0 -= 1; lat1 += 1; }
  
  const W = 640, H = 420, PAD = 26;
  const sx = (lon: number) => PAD + (lon - lon0) / (lon1 - lon0) * (W - PAD * 2);
  const sy = (lat: number) => PAD + (lat1 - lat) / (lat1 - lat0) * (H - PAD * 2);
  const path = (legs: any[]) => legs.map((p, i) => (i ? 'L' : 'M') + sx(p.lon).toFixed(1) + ' ' + sy(p.lat).toFixed(1)).join(' ');
  
  const backEnds = runs.map(r => r.back[r.back.length - 1]);
  const srcKm = E.meanS(backEnds.map(p => E.distanceKm(selectors.currentPlace(), p))) || 0;
  const srcBearing = E.bearingDeg(selectors.currentPlace(), backEnds[0]);
  
  const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Quạt đường đi khối không ở 850 hPa">' +
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#eef3f7"/>' +
    [0.25, 0.5, 0.75].map(f => '<line x1="' + PAD + '" y1="' + (PAD + f * (H - PAD * 2)) + '" x2="' + (W - PAD) + '" y2="' + (PAD + f * (H - PAD * 2)) + '" stroke="#cfdbe4"/>').join('') +
    [0.25, 0.5, 0.75].map(f => '<line x1="' + (PAD + f * (W - PAD * 2)) + '" y1="' + PAD + '" x2="' + (PAD + f * (W - PAD * 2)) + '" y2="' + (H - PAD) + '" stroke="#cfdbe4"/>').join('') +
    runs.map((r, i) => '<path d="' + path(r.fwd) + '" fill="none" stroke="#c0392b" stroke-width="1.3" opacity="' + (0.25 + 0.5 * (i + 1) / runs.length) + '"/>' +
      '<path d="' + path(r.back) + '" fill="none" stroke="#2a5f96" stroke-width="1.3" stroke-dasharray="4 3" opacity="' + (0.25 + 0.5 * (i + 1) / runs.length) + '"/>').join('') +
    '<circle cx="' + sx(selectors.currentPlace().lon) + '" cy="' + sy(selectors.currentPlace().lat) + '" r="5" fill="#101f2d" stroke="#fff" stroke-width="2"/>' +
    '<text x="' + (PAD + 4) + '" y="' + (PAD + 14) + '" class="tvb">Hướng tuyến tới</text>' +
    '<text x="' + (PAD + 4) + '" y="' + (PAD + 30) + '" class="tvb">điểm quan sát</text>' +
    '</svg>';
  
  host.innerHTML = svg +
    '<div class="legend"><span><i style="background:#c0392b"></i>đi tới (tối đa ' + fwdH + ' giờ)</span><span><i style="background:#2a5f96"></i>đi từ (tối đa ' + backH + ' giờ)</span><span>' + runs.length + ' hệ thống vẽ chồng nhau; độ rộng quạt là mức bất đồng</span></div>';
  
  const trajNote = $('trajNote');
  if (trajNote) {
    trajNote.innerHTML = 'Khối không khí nơi bạn đang xét, ở tầng 850 hPa (khoảng 1,5 km), về từ phía <strong>' + compass(srcBearing) + '</strong> cách điểm quan sát khoảng <strong>' + fmt(srcKm, 0) + ' km</strong> trong ' + backH + ' giờ trước. Bản đồ là hình chiếu thẳng, dùng gió theo giờ của từng mô hình nên độ rộng quạt chính là mức bất đồng giữa các hệ thống.';
  }
}

/** Helper: level series aligned to time */
function levelSeries(id: string, variable: string, time: string[], levels: any): (number | null)[] {
  const col = levels?.series?.[id]?.[variable];
  if (!col) return time.map(() => null);
  const idx = new Map(levels.time.map((t: string, i: number) => [t, i]));
  return time.map(t => {
    const k = idx.get(t);
    return k == null ? null : col[k];
  });
}

/** Helper: mean across models */
function levelMean(time: string[], variable: string, levels: any): (number | null)[] {
  const ids = Object.keys(levels?.series || {});
  if (!ids.length) return time.map(() => null);
  const cols = ids.map(id => levelSeries(id, variable, time, levels));
  return time.map((_, i) => {
    let s = 0, n = 0;
    for (const c of cols) if (finite(c[i])) { s += c[i]!; n++; }
    return n ? s / n : null;
  });
}

/** Helper: current time index */
function levelNowIndex(levels: any): number | null {
  if (!levels?.time?.length) return null;
  const local = new Date(Date.now() + (levels.offsetSeconds || 0) * 1000);
  const iso = local.toISOString().slice(0, 13) + ':00';
  let i = levels.time.indexOf(iso);
  if (i >= 0) return i;
  
  let best = 0, bestGap = Infinity;
  const t0 = local.getTime();
  for (let k = 0; k < levels.time.length; k++) {
    const gap = Math.abs(new Date(levels.time[k] + 'Z').getTime() - t0);
    if (gap < bestGap) { bestGap = gap; best = k; }
  }
  return best;
}