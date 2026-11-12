/**
 * ATMOS App - Rivers (GloFAS)
 * River discharge data from Open-Meteo Flood API
 */

import { E } from '../../engine/index.js';
import { selectors, state } from '../state/index.js';
import { $, fmt, finite, bearing, compass, esc, todayISO } from '../helpers/index.js';
import { api, pLimit } from '../api/index.js';
import { RIVER_RADIUS_KM, RIVER_DEG, RIVER_STEP, RIVER_CHART_DAYS, LEVEL_COLOR, FLOOD_BANDS } from '../constants/index.js';

let riversToken = 0;

/** Load rivers data */
export async function loadRivers(): Promise<void> {
  const place = selectors.currentPlace();
  const token = ++riversToken;
  state.loading.rivers.set(true);
  
  try {
    const cells = await scanRiverCells(place);
    if (token !== riversToken) return;
    if (!cells.length) {
      state.rivers.set([]);
      renderRivers([]);
      return;
    }
    
    const series = await pLimit(cells, 3, entry => fetchRiverSeries(entry, place));
    const merged = mergeDuplicateRivers(series.filter(Boolean).sort((a, b) => a.km - b.km));
    
    // Find largest river
    let biggest: { v: number; km: number } | null = null;
    for (const r of merged) {
      const v = r.qMedianToday;
      if (finite(v) && (!biggest || v > biggest.v)) biggest = { v, km: r.km };
    }
    
    const rivers = merged.map(r => ({
      ...r,
      isLargest: !!biggest && Math.abs(r.km - biggest.km) < 0.05,
      levels: finite(r.qMedianToday) ? E.floodLevels({
        history: r.history,
        qNow: r.qMedianToday,
        qForecast: r.forecast.slice(1),
        rating: ratingFor(r.qMedianToday),
      }) : null,
    }));
    
    state.rivers.set(rivers);
    if (token === riversToken) renderRivers(rivers);
    
  } catch (err) {
    console.error('Rivers load failed:', err);
  } finally {
    state.loading.rivers.set(false);
  }
}

/** Scan river cells in 10km radius */
async function scanRiverCells(place: any): Promise<any[]> {
  const offs: number[] = [];
  for (let k = -2; k <= 2; k++) offs.push(k * RIVER_STEP);
  
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
    const km = E.distanceKm(place, c);
    if (km > RIVER_RADIUS_KM) continue;
    byCell.set(floodCellKey(c), { cell: c, km: Math.round(km * 10) / 10 });
  }
  
  return [...byCell.values()].sort((a, b) => a.km - b.km);
}

/** Fetch detailed river series */
async function fetchRiverSeries(entry: any, place: any): Promise<any | null> {
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

/** Render river list */
export function renderRivers(rivers: any[]): void {
  const box = $('riverList');
  const metaEl = $('riverMeta');
  const nameEl = $('riverNameMeta');
  if (!box) return;
  
  if (!rivers.length) {
    box.innerHTML = '<p class="muted">Không có ô lưới GloFAS nào có sông trong bán kính ' + RIVER_RADIUS_KM + ' km. Các vùng ven biển phẳng thường rơi vào tình huống này vì GloFAS chỉ mô tả lưu lượng trên dòng sông có đủ lưu lượng để ghi nhận.</p>';
    if (metaEl) metaEl.textContent = 'Không có dữ liệu';
    if (nameEl) nameEl.textContent = '\u2014';
    return;
  }
  
  const riverSel = state.riverSel.get();
  const sel = Math.min(riverSel, rivers.length - 1);
  state.riverSel.set(sel);
  
  if (metaEl) metaEl.textContent = rivers.length + ' tuyến sông/kênh trong bán kính ' + RIVER_RADIUS_KM + ' km';
  if (nameEl) nameEl.textContent = 'Tên song tra tu OSM, o khong co ten thi ghi ro la chua co ten';
  
  box.innerHTML = rivers.map((r, i) => {
    const k = riverRiskOf(r);
    const a = riverAlert(r);
    const tone = !k ? '' : (k.vsRecent >= 0.25 ? 'high' : k.vsRecent <= -0.25 ? 'low' : '');
    const rt = ratingFor(k?.q || 0);
    const H = E.nominalStage(k?.q || 0, rt.a, rt.b, rt.q0);
    
    return '<button class="river-card' + (i === sel ? ' selected' : '') + '" data-river="' + i + '">' +
      '<span class="river-top"><strong>' + fmt(r.km, 1) + ' km</strong><span class="small">' + (r.isLargest ? 'song lon nhat \u00B7 ' : '') + compass(bearing(place, r.cell)) + '</span></span>' +
      '<span class="river-q">' + (k ? fmt(k.q, 1) : '\u2014') + '<em> m3/s</em></span>' +
      '<span class="river-h' + (a?.level ? ' lv ' + a.level.tone : '') + '">' + (finite(H) ? fmt(H, 2) : '\u2014') + '<em> m quy uoc</em></span>' +
      '<span class="river-bar"><i style="width:' + Math.max(4, Math.min(100, k ? k.vsRecent * 100 + 50 : 50)) + '%" class="' + tone + '"></i></span>' +
      (a?.level ? '<span class="warn-chip ' + a.level.tone + '">' + a.level.label + '</span>' : '<span class="small">duoi nguong tham chieu</span>') +
      '<span class="small">' + (k && finite(k.vsRecent) ? (k.vsRecent >= 0 ? '+' : '') + fmt(k.vsRecent * 100, 0) + '% so voi TB 30 ngay' : '\u2014') + '</span>' +
    '</button>';
  }).join('');
  
  box.querySelectorAll('[data-river]').forEach(btn => {
    btn.addEventListener('click', () => { 
      state.riverSel.set(parseInt(btn.dataset.river!)); 
      renderRivers(rivers); 
      renderRiverChart();
    });
  });
  
  renderRiverChart();
}

/** River risk assessment */
function riverRiskOf(r: any): any {
  const recentWindow = (r.history || []).slice(-30);
  const recent = E.meanS(recentWindow);
  return E.riverRisk({
    q: r.qMedianToday ?? r.qToday,
    qP25: r.p25Today, qP75: r.p75Today,
    recent,
  });
}

function riverAlert(r: any): any {
  const L = r.levels;
  if (!L) return null;
  const now = L.now;
  const peak = L.peakBand;
  return { level: now, peak, outranked: !!(peak && (!now || peak.level > now.level)) };
}

/** River chart (hydrograph) */
export function renderRiverChart(): void {
  const host = $('riverChart');
  if (!host) return;
  
  const rivers = state.rivers.get();
  const sel = state.riverSel.get();
  if (!rivers || !rivers.length) { host.innerHTML = '<p class="muted">Chon mot con song.</p>'; return; }
  
  const r = rivers[sel];
  const today = r.iToday ?? 0;
  const lo = Math.max(0, today - RIVER_CHART_DAYS);
  const hi = r.q.length - 1;
  const n = hi - lo + 1;
  if (n < 2) { host.innerHTML = '<p class="muted">Khong du so lieu de ve.</p>'; return; }
  
  const series = (i: number) => (r.median?.[i] != null && finite(r.median[i]) ? r.median[i] : r.q[i]);
  const vals: number[] = [];
  for (let i = lo; i <= hi; i++) {
    for (const c of [series, r.p25, r.p75]) if (finite(c?.[i])) vals.push(c[i]!);
  }
  for (const t of r.levels?.thresholds || []) if (finite(t.q)) vals.push(t.q);
  if (!vals.length) { host.innerHTML = '<p class="muted">Khong co so lieu.</p>'; return; }
  
  const vmax = Math.max(...vals) * 1.1 || 1;
  const W = 720, H = 280, PAD = 46, PB = 46;
  const sx = (i: number) => PAD + (i - lo) / (hi - lo) * (W - PAD * 2);
  const sy = (v: number) => H - PB - (v / vmax) * (H - PAD - PB);
  
  const band = (i: number) => {
    const a = r.p25?.[i], b = r.p75?.[i];
    return finite(a) && finite(b) ? '<rect x="' + (sx(i) - (W - PAD * 2) / (hi - lo) / 2).toFixed(1) + '" y="' + sy(b).toFixed(1) + '" width="' + Math.max(1, (W - PAD * 2) / (hi - lo)).toFixed(1) + '" height="' + Math.max(1, sy(a) - sy(b)).toFixed(1) + '" fill="#2a5f96" opacity=".16"/>' : '';
  };
  
  const path = (from: number, to: number) => {
    let d = '', pen = false;
    for (let i = from; i <= to; i++) {
      const v = series(i);
      if (!finite(v)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(v).toFixed(1) + ' ';
      pen = true;
    }
    return d;
  };
  
  const hist = path(lo, today), fc = path(today, hi);
  
  const ticks = [];
  for (let i = lo; i <= hi; i += 14) ticks.push('<text x="' + sx(i).toFixed(1) + '" y="' + (H - 14) + '" class="tvb" text-anchor="middle">' + r.time[i].slice(5, 7) + '/' + r.time[i].slice(8, 10) + '</text>');
  
  const cut = today > lo ? '<line x1="' + sx(today).toFixed(1) + '" y1="' + PAD + '" x2="' + sx(today).toFixed(1) + '" y2="' + (H - PB) + '" stroke="#b54ae0" stroke-dasharray="4 3"/><text x="' + (sx(today) + 5).toFixed(1) + '" y="' + (PAD + 12) + '" class="tvb">nay</text>' : '';
  
  const levels = (r.levels?.thresholds || []).filter((t: any) => finite(t.q)).map((t: any) =>
    '<line x1="' + PAD + '" y1="' + sy(t.q).toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + sy(t.q).toFixed(1) + '" stroke="' + (LEVEL_COLOR[t.tone as keyof typeof LEVEL_COLOR] || '#000') + '" stroke-width="1" stroke-dasharray="2 4" opacity=".85"/>' +
    '<text x="' + (W - PAD - 4) + '" y="' + (sy(t.q) - 4).toFixed(1) + '" class="tvb" text-anchor="end" fill="' + (LEVEL_COLOR[t.tone as keyof typeof LEVEL_COLOR] || '#000') + '">' + t.label + ' ' + fmt(t.q, 0) + ' m3/s</text>'
  ).join('');
  
  host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Hydrograph">' +
    '<line x1="' + PAD + '" y1="' + (H - PB) + '" x2="' + (W - PAD) + '" y2="' + (H - PB) + '" stroke="#c7d2dc"/>' +
    [0.25, 0.5, 0.75, 1].map(f => '<text x="' + (PAD - 6) + '" y="' + (sy(vmax * f) + 4).toFixed(1) + '" class="tvb" text-anchor="end">' + fmt(vmax * f, 0) + '</text>').join('') +
    Array.from({ length: n }, (_, i) => band(lo + i)).join('') +
    levels + cut +
    '<path d="' + hist + '" fill="none" stroke="#2a5f96" stroke-width="2"/>' +
    '<path d="' + fc + '" fill="none" stroke="#2a5f96" stroke-width="2" stroke-dasharray="5 4"/>' +
    ticks.join('') +
    '</svg>' +
    '<p class="small">Duong dam la luu luong trung vi quan sat, duong dut la 7 ngay du bao; dai xanh nhat la khoang p25-p75 cua bo thanh vien to hop GloFAS, phan anh muc chac chan cua dong chay chu khong phai muc nuoc tinh bang met. Cac duong ngang la nguong <strong>tham chieu</strong> lay tu phan vi lich su 12 thang cua chinh tuyen nay, khong phai bao dong chinh thuc. Nguon: Global Flood Awareness System (GloFAS v4) qua Open-Meteo.</p>';
}