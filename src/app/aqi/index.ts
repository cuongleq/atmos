/**
 * ATMOS App - Air Quality Index (AQI)
 * Renders CAMS European air quality data from Open-Meteo
 */

import { selectors } from '../state/index.js';
import { $, fmt, finite, esc } from '../helpers/index.js';
import { api } from '../api/index.js';

const POLLUTANTS = [
  { key: 'pm10', label: 'PM10', unit: 'ug/m3', who: 45 },
  { key: 'pm2_5', label: 'PM2.5', unit: 'ug/m3', who: 15 },
  { key: 'o3', label: 'O3', unit: 'ug/m3', who: 100 },
  { key: 'no2', label: 'NO2', unit: 'ug/m3', who: 25 },
  { key: 'so2', label: 'SO2', unit: 'ug/m3', who: 40 },
  { key: 'co', label: 'CO', unit: 'mg/m3', who: 4 },
];

/** Load and render AQI data */
export async function loadAqi(): Promise<void> {
  const live = selectors.currentLive();
  const place = selectors.currentPlace();
  
  const metaEl = document.getElementById('aqiMeta');
  const nowEl = document.getElementById('aqiNow');
  const stripEl = document.getElementById('aqiStrip');
  const gridEl = document.getElementById('aqiPollutants');
  const adviceEl = document.getElementById('aqiAdvice');
  
  if (!metaEl || !nowEl || !stripEl || !gridEl || !adviceEl || !live) return;
  
  try {
    const { lat, lon } = place;
    const data = await api('https://air-quality-api.open-meteo.com/v1/air-quality', {
      latitude: lat,
      longitude: lon,
      hourly: POLLUTANTS.map(p => p.key).join(','),
      current: POLLUTANTS.map(p => p.key).join(','),
      timezone: 'auto',
    });
    
    if (!data.current || !data.hourly) {
      nowEl.innerHTML = '<p class="muted">Không có dữ liệu chất lượng không khí.</p>';
      return;
    }
    
    const current = data.current;
    const hourly = data.hourly;
    const nowHour = new Date().getHours();
    
    // Update meta
    metaEl.textContent = 'Nguồn: CAMS (Copernicus) qua Open-Meteo \u00B7 Cập nhật ' + new Date().toLocaleTimeString('vi-VN');
    
    // Render current values
    let html = '<div class="aqi-current-grid">';
    for (const p of POLLUTANTS) {
      const val = current[p.key];
      const aqi = val ? calculateAQI(p.key, val) : null;
      const level = getAQILevel(aqi);
      
      html += 
        '<div class="aqi-current-item ' + level + '">' +
        '<div class="aqi-name">' + esc(p.label) + '</div>' +
        '<div class="aqi-value">' + (finite(val) ? fmt(val, p.key === 'co' ? 1 : 0) : '\u2014') + ' <span class="aqi-unit">' + esc(p.unit) + '</span></div>' +
        '<div class="aqi-index">AQI: ' + (finite(aqi) ? Math.round(aqi) : '\u2014') + '</div>' +
        '</div>';
    }
    html += '</div>';
    nowEl.innerHTML = html;
    
    renderAqiStrip(stripEl, hourly, nowHour);
    renderAqiGrid(gridEl, hourly, nowHour);
    
    const maxAQI = Math.max(...POLLUTANTS.map(p => calculateAQI(p.key, current[p.key] || 0)).filter(finite));
    adviceEl.innerHTML = getHealthAdvice(maxAQI);
    
  } catch (err) {
    console.error('AQI load failed:', err);
    nowEl.innerHTML = '<p class="muted">Không tải được dữ liệu chất lượng không khí.</p>';
    metaEl.textContent = 'Lỗi tải dữ liệu';
  }
}

/** Calculate AQI from concentration */
function calculateAQI(pollutant: string, concentration: number): number {
  // Simplified AQI calculation based on WHO guidelines
  const breakpoints: Record<string, [number, number][]> = {
    pm2_5: [[0, 15], [15, 35], [35, 55], [55, 150], [150, 250], [250, 500]],
    pm10: [[0, 45], [45, 75], [75, 150], [150, 250], [250, 350], [350, 500]],
    o3: [[0, 100], [100, 160], [160, 200], [200, 240], [240, 300], [300, 400]],
    no2: [[0, 25], [25, 50], [50, 100], [100, 200], [200, 400], [400, 500]],
    so2: [[0, 40], [40, 80], [80, 380], [380, 800], [800, 1600], [1600, 2100]],
    co: [[0, 4], [4, 7], [7, 10], [10, 14], [14, 18], [18, 22]],
  };
  
  const bp = breakpoints[pollutant];
  if (!bp) return 0;
  
  for (let i = 0; i < bp.length; i++) {
    if (concentration <= bp[i][1]) {
      const [cLow, cHigh] = bp[i];
      const aqiLow = i * 50;
      const aqiHigh = (i + 1) * 50 - 1;
      return aqiLow + (aqiHigh - aqiLow) * (concentration - cLow) / (cHigh - cLow);
    }
  }
  
  return 500;
}

/** Get AQI level class */
function getAQILevel(aqi: number | null): string {
  if (aqi === null) return 'unknown';
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthy-sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very-unhealthy';
  return 'hazardous';
}

/** Render 24h AQI strip chart */
function renderAqiStrip(container: HTMLElement, hourly: any, nowHour: number): void {
  const W = container.clientWidth || 600;
  const H = 60;
  const PAD = 10;
  
  // Find PM2.5 data
  const pm25 = hourly.pm2_5;
  const time = hourly.time;
  if (!pm25 || !time) { container.innerHTML = ''; return; }
  
  // Last 24 hours
  const startIdx = Math.max(0, time.findIndex((t: string) => new Date(t + 'Z').getHours() === nowHour) - 23);
  if (startIdx < 0) { container.innerHTML = ''; return; }
  
  const slice = pm25.slice(startIdx, startIdx + 24);
  const vals = slice.filter((v: number) => finite(v));
  if (!vals.length) { container.innerHTML = ''; return; }
  
  const max = Math.max(...vals, 50);
  const min = 0;
  
  const sx = (i: number) => PAD + i / 23 * (W - PAD * 2);
  const sy = (v: number) => H - PAD - (v - min) / (max - min) * (H - PAD * 2);
  
  let path = '';
  let first = true;
  for (let i = 0; i < slice.length; i++) {
    const v = slice[i];
    if (!finite(v)) { first = true; continue; }
    if (first) { path += 'M ' + sx(i) + ' ' + sy(v); first = false; }
    else { path += ' L ' + sx(i) + ' ' + sy(v); }
  }
  
  // WHO guideline line
  const whoY = sy(15);
  
  container.innerHTML = 
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="PM2.5 24h trend">' +
    '<line x1="' + PAD + '" y1="' + whoY + '" x2="' + (W - PAD) + '" y2="' + whoY + '" stroke="#ffc107" stroke-dasharray="4 2" stroke-width="1"/>' +
    '<path d="' + path + '" fill="none" stroke="#2a5f96" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="' + sx(slice.length - 1) + '" cy="' + sy(slice[slice.length - 1]) + '" r="3" fill="#2a5f96"/>' +
    '</svg>' +
    '<div class="aqi-strip-legend"><span>24h PM2.5</span><span class="who-line">WHO: 15 ug/m3</span></div>';
}

/** Render detailed pollutant grid */
function renderAqiGrid(container: HTMLElement, hourly: any, nowHour: number): void {
  let html = '<table class="aqi-table"><thead><tr><th>Chất ô nhiễm</th><th>Hiện tại</th><th>TB 24h</th><th>Max 24h</th><th>Xu hướng</th></tr></thead><tbody>';
  
  for (const p of POLLUTANTS) {
    const data = hourly[p.key];
    const time = hourly.time;
    if (!data || !time) continue;
    
    // Last 24 hours
    const startIdx = Math.max(0, time.findIndex((t: string) => new Date(t + 'Z').getHours() === nowHour) - 23);
    const slice = data.slice(startIdx, startIdx + 24).filter(finite);
    if (!slice.length) continue;
    
    const current = slice[slice.length - 1];
    const avg = slice.reduce((a: number, b: number) => a + b, 0) / slice.length;
    const max = Math.max(...slice);
    const trend = slice.length > 1 ? (slice[slice.length - 1] - slice[0]) : 0;
    
    const aqi = calculateAQI(p.key, current);
    const level = getAQILevel(aqi);
    const trendClass = trend > 0.1 ? 'up' : trend < -0.1 ? 'down' : 'flat';
    const trendIcon = trend > 0.1 ? '\u2191' : trend < -0.1 ? '\u2193' : '\u2192';
    
    html += 
      '<tr class="' + level + '">' +
      '<td><strong>' + esc(p.label) + '</strong> <span class="unit">(' + esc(p.unit) + ')</span></td>' +
      '<td class="current">' + fmt(current, p.key === 'co' ? 1 : 0) + ' <span class="aqi-badge">' + Math.round(aqi) + '</span></td>' +
      '<td>' + fmt(avg, p.key === 'co' ? 1 : 0) + '</td>' +
      '<td>' + fmt(max, p.key === 'co' ? 1 : 0) + '</td>' +
      '<td class="trend ' + trendClass + '">' + trendIcon + ' ' + fmt(Math.abs(trend), p.key === 'co' ? 1 : 0) + '</td>' +
      '</tr>';
  }
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

/** Get health advice based on max AQI */
function getHealthAdvice(maxAQI: number): string {
  if (maxAQI <= 50) return '<strong>Tốt:</strong> Không khí trong lành, phù hợp cho mọi hoạt động ngoài trời.';
  if (maxAQI <= 100) return '<strong>Trung bình:</strong> Chất lượng không khí chấp nhận được. Người nhạy cảm nên hạn chế hoạt động nặng ngoài trời lâu.';
  if (maxAQI <= 150) return '<strong>Có hại cho nhóm nhạy cảm:</strong> Trẻ em, người già, bệnh hô hấp/tim mạch nên giảm hoạt động ngoài trời.';
  if (maxAQI <= 200) return '<strong>Có hại:</strong> Mọi người có thể cảm thấy ảnh hưởng. Nhóm nhạy cảm tránh ra ngoài. Đóng cửa sổ, dùng máy lọc không khí.';
  if (maxAQI <= 300) return '<strong>Rất có hại:</strong> Cảnh báo sức khỏe. Mọi người nên ở trong nhà, đóng kín cửa, bật máy lọc. Tránh tập thể dục ngoài trời.';
  return '<strong>Nguy hiểm:</strong> Cảnh báo khẩn cấp. Toàn bộ dân số bị ảnh hưởng. Ở trong nhà hoàn toàn, dùng máy lọc không khí, đeo khẩu trang N95 nếu buộc ra ngoài.';
}