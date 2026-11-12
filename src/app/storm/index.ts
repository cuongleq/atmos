/**
 * ATMOS App - Storm/Lightning Index
 * Convective energy index (CAPE, LI, CIN)
 */

import { selectors, state } from '../state/index.js';
import { $, fmt, finite, esc } from '../helpers/index.js';
import { api, MODELS } from '../api/index.js';

/** Load storm/lightning data */
export async function loadStorm(): Promise<void> {
  const place = selectors.currentPlace();
  const box = $('stormBox');
  const metaEl = $('stormMeta');
  const limitsEl = $('stormLimits');
  
  if (!box || !metaEl || !limitsEl) return;
  
  box.innerHTML = '<p class="muted">Đang tải chỉ số đối lưu\u2026</p>';
  
  try {
    const u = new URLSearchParams({
      latitude: place.lat.toFixed(4),
      longitude: place.lon.toFixed(4),
      hourly: 'cape,li,cin',
      models: MODELS.map(m => m.id).join(','),
      past_days: 7,
      forecast_days: 7,
      timezone: 'auto',
    });
    
    const data = await api('https://api.open-meteo.com/v1/forecast', u);
    const hourly = data.hourly || {};
    
    // Process each model
    const series: Record<string, any> = {};
    for (const m of MODELS) {
      const cape = hourly['cape_' + m.id];
      const li = hourly['li_' + m.id];
      const cin = hourly['cin_' + m.id];
      if (cape || li || cin) series[m.id] = { cape, li, cin };
    }
    
    if (!Object.keys(series).length) {
      box.innerHTML = '<p class="muted">Không có hệ thống nào trả dữ liệu CAPE/LI/CIN.</p>';
      return;
    }
    
    // Mean fields
    const time = hourly.time || [];
    const meanCape = meanField(series, 'cape');
    const meanLi = meanField(series, 'li');
    const meanCin = meanField(series, 'cin');
    
    // Current index
    const now = findNowIndex(time, data.utc_offset_seconds || 0);
    if (now == null) {
      box.innerHTML = '<p class="muted">Không xác định được giờ hiện tại.</p>';
      return;
    }
    
    const cape = meanCape[now];
    const li = meanLi[now];
    const cin = meanCin[now];
    
    // Compute index
    const idx = computeStormIndex(cape, li, cin);
    
    // Model agreement
    const modelIdx: Record<string, number> = {};
    for (const [id, s] of Object.entries(series)) {
      const c = s.cape?.[now], l = s.li?.[now], cn = s.cin?.[now];
      if (finite(c) && finite(l) && finite(cn)) modelIdx[id] = computeStormIndex(c, l, cn);
    }
    
    const votes: Record<number, number> = {};
    for (const v of Object.values(modelIdx)) {
      const band = Math.floor(v / 20) * 20;
      votes[band] = (votes[band] || 0) + 1;
    }
    const agree = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || [0, 0];
    
    // Spread
    const vals = Object.values(modelIdx).filter(finite);
    const spread = vals.length > 1 ? Math.sqrt(E.varS(vals)) : 0;
    
    // Next 24h trend
    const next24 = meanCape.slice(now, now + 24).filter(finite);
    const dCape = next24.length ? E.meanS(next24) - (cape || 0) : 0;
    
    // Render
    const levelClass = idx >= 80 ? 'high' : idx >= 60 ? 'moderate' : idx >= 40 ? 'elevated' : 'low';
    
    box.innerHTML = 
      '<div class="storm-head">' +
        '<div><span class="small">CHI SO DOI LUU</span>' +
          '<div class="storm-index ' + levelClass + '">' + Math.round(idx) + '/100</div></div>' +
        '<div class="storm-consensus"><strong>' + agree[1] + '/' + Object.keys(series).length + '</strong><span class="small">he thong dong y</span></div>' +
      '</div>' +
      '<div class="metric-grid compact" style="margin:14px 0 0">' +
        '<div class="metric"><span class="small">CAPE</span><strong>' + (finite(cape) ? fmt(cape, 0) : '—') + '<em> J/kg</em></strong>' +
          '<span class="small">' + (finite(dCape) ? (dCape >= 0 ? '+' : '') + fmt(dCape, 0) + ' J/kg trong 24h' : '—') + '</span></div>' +
        '<div class="metric"><span class="small">Lifted Index</span><strong>' + (finite(li) ? fmt(li, 1) : '—') + '</strong>' +
          '<span class="small">' + (finite(li) && li < 0 ? 'Bat on' : 'An dinh') + '</span></div>' +
        '<div class="metric"><span class="small">CIN</span><strong>' + (finite(cin) ? fmt(cin, 0) : '—') + '<em> J/kg</em></strong>' +
          '<span class="small">' + (finite(cin) && cin > 50 ? 'Nap manh' : 'Nap yeu/khong') + '</span></div>' +
        '<div class="metric"><span class="small">Do lech giua ' + Object.keys(series).length + ' mo hinh</span><strong>' + fmt(spread, 1) + '</strong></div>' +
      '</div>' +
      '<p class="small" style="margin-top:12px">Chi so nay duoc tinh tu CAPE (can bac 2), LI, CIN voi trong so 0.6/0.25/0.15. Chi GFS co du 3 thanh phan; cac mo hinh khac thieu LI hoac CIN nen diem nam tren thang khac. Chi so nay <strong>khong phai du bao dong set</strong> va <strong>khong phai canh bao</strong>. Khi co bao, hay theo dai khien cua tinh va canh bao chinh thuc.</p>';
    
    if (metaEl) metaEl.textContent = 'Cap nhat: ' + new Date().toLocaleTimeString('vi-VN');
    
    // Limits
    if (limitsEl) {
      const missing = MODELS.filter(m => !series[m.id]).map(m => m.name);
      limitsEl.textContent = missing.length ? 'Thieu du lieu tu: ' + missing.join(', ') : 'Tat ca ' + MODELS.length + ' mo hinh co du lieu.';
    }
    
  } catch (err) {
    console.error('Storm load failed:', err);
    box.innerHTML = '<p class="muted">Loi tai chi so doi luu.</p>';
  }
}

const E = (window as any).AtmosEngine;

/** Compute storm index (0-100) */
function computeStormIndex(cape: number | null, li: number | null, cin: number | null): number {
  if (!finite(cape) || !finite(li) || !finite(cin)) return 0;
  
  // Normalize each component
  const capeNorm = Math.min(1, Math.sqrt(Math.max(0, cape)) / 100); // sqrt(10000) = 100
  const liNorm = Math.min(1, Math.max(0, -li) / 6); // -6 to 0
  const cinNorm = Math.min(1, Math.max(0, 200 - cin) / 200); // 0 to 200 (lower CIN = higher risk)
  
  // Weighted geometric mean
  return Math.round(100 * Math.pow(capeNorm, 0.6) * Math.pow(liNorm, 0.25) * Math.pow(cinNorm, 0.15));
}

/** Mean field across models */
function meanField(series: Record<string, any>, field: string): (number | null)[] {
  const ids = Object.keys(series);
  if (!ids.length) return [];
  
  const first = series[ids[0]];
  const len = first[field]?.length || 0;
  if (!len) return [];
  
  const out: (number | null)[] = new Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0, c = 0;
    for (const id of ids) {
      const v = series[id][field]?.[i];
      if (finite(v)) { s += v; c++; }
    }
    out[i] = c ? s / c : null;
  }
  return out;
}

/** Find current time index */
function findNowIndex(time: string[], offsetSeconds: number): number | null {
  if (!time.length) return null;
  const local = new Date(Date.now() + offsetSeconds * 1000);
  const iso = local.toISOString().slice(0, 13) + ':00';
  let i = time.indexOf(iso);
  if (i >= 0) return i;
  
  let best = 0, bestGap = Infinity;
  const t0 = local.getTime();
  for (let k = 0; k < time.length; k++) {
    const gap = Math.abs(new Date(time[k] + 'Z').getTime() - t0);
    if (gap < bestGap) { bestGap = gap; best = k; }
  }
  return best;
}