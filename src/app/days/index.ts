/**
 * ATMOS App - 16-Day Forecast
 * Daily forecast rendering
 */

import { selectors } from '../state/index.js';
import { $, fmt, pct, finite, condition, weatherFamily, esc, dateDM } from '../helpers/index.js';

let selectedDay: string | null = null;

/** Render 16-day forecast cards */
export function renderDays(): void {
  const live = selectors.currentLive();
  const container = document.getElementById('days');
  const tzEl = document.getElementById('daysTz');
  
  if (!container || !live) return;
  
  const { base } = live;
  const daily = base.daily;
  
  if (tzEl) tzEl.textContent = 'Múi giờ: ' + base.timezone;
  
  if (!daily?.time?.length) {
    container.innerHTML = '<p class="muted">Không có dữ liệu dự báo ngày.</p>';
    return;
  }
  
  let html = '<div class="days-grid">';
  
  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i];
    const tmax = daily.temperature_2m_max?.[i];
    const tmin = daily.temperature_2m_min?.[i];
    const rain = daily.precipitation_sum?.[i];
    const prob = daily.precipitation_probability_max?.[i];
    const gust = daily.wind_gusts_10m_max?.[i];
    const code = daily.weather_code?.[i];
    
    const isSelected = selectedDay === date;
    
    html += 
      '<button class="day-card' + (isSelected ? ' selected' : '') + '" data-date="' + esc(date) + '">' +
      '<div class="day-date">' + dateDM(date) + '</div>' +
      '<div class="day-icon">' + weatherFamily(code) + '</div>' +
      '<div class="day-temp">' +
      '<span class="tmax">' + (finite(tmax) ? fmt(tmax, 0) : '\u2014') + '\u00B0</span>' +
      '<span class="tmin">' + (finite(tmin) ? fmt(tmin, 0) : '\u2014') + '\u00B0</span>' +
      '</div>' +
      '<div class="day-rain">' + (finite(rain) ? fmt(rain, 1) : '\u2014') + 'mm ' + (finite(prob) ? '(' + pct(prob/100) + ')' : '') + '</div>' +
      '<div class="day-gust">' + (finite(gust) ? fmt(gust, 0) : '\u2014') + ' km/h</div>' +
      '<div class="day-condition">' + (finite(code) ? condition(code) : '\u2014') + '</div>' +
      '</button>';
  }
  
  html += '</div>';
  container.innerHTML = html;
  
  // Add click handlers
  container.querySelectorAll('.day-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.date!;
      selectedDay = date;
      actions.setSelectedDay(date);
      renderDays(); // Re-render to update selection
      renderDayDetail(date);
    });
  });
}

/** Render day detail (hourly for selected day) */
export function renderDayDetail(date: string): void {
  const live = selectors.currentLive();
  const report = selectors.currentReport();
  const titleEl = document.getElementById('dayDetailTitle');
  const metaEl = document.getElementById('dayDetailMeta');
  const container = document.getElementById('dayDetail');
  
  if (!titleEl || !metaEl || !container || !live || !report) return;
  
  titleEl.textContent = 'Chi tiết ' + dateDM(date);
  metaEl.textContent = 'Dự báo từng giờ cho ' + dateDM(date);
  
  const { base, byId } = live;
  const hourly = base.hourly;
  
  // Find hours for this date
  const dayHours = hourly.time
    .map((t: string, i: number) => ({ time: t, idx: i }))
    .filter(({ time }) => time.startsWith(date))
    .slice(0, 24);
  
  if (!dayHours.length) {
    container.innerHTML = '<p class="muted">Không có dữ liệu giờ cho ngày này.</p>';
    return;
  }
  
  // Key variables to show
  const keyVars = [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
    'precipitation', 'precipitation_probability', 'wind_speed_10m',
    'wind_direction_10m', 'wind_gusts_10m', 'cloud_cover', 'weather_code',
  ];
  
  let html = '<table class="day-detail-table"><thead><tr><th>Giờ</th>';
  for (const v of keyVars) {
    const spec = report.variables[v];
    if (spec) html += '<th title="' + esc(spec.label) + '">' + esc(spec.short || spec.label) + '</th>';
  }
  html += '</tr></thead><tbody>';
  
  for (const { time, idx } of dayHours) {
    const hour = new Date(time + 'Z').getHours();
    html += '<tr><td class="hour">' + hour + 'h</td>';
    
    for (const v of keyVars) {
      const spec = report.variables[v];
      if (!spec) { html += '<td>\u2014</td>'; continue; }
      
      // Get multi-model value
      let vals: number[] = [];
      for (const modelData of Object.values(byId)) {
        const val = modelData?.hourly[v]?.[idx];
        if (finite(val)) vals.push(val);
      }
      
      let cell = '\u2014';
      if (vals.length) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        if (v === 'weather_code') {
          const code = Math.round(mean);
          cell = weatherFamily(code) + ' ' + condition(code);
        } else if (v === 'wind_direction_10m') {
          cell = fmt(mean, 0) + '\u00B0';
        } else if (v === 'precipitation_probability' || v === 'relative_humidity_2m' || v === 'cloud_cover') {
          cell = fmt(mean, 0) + '%';
        } else {
          cell = fmt(mean, spec.digits) + ' ' + esc(spec.unit);
        }
      }
      html += '<td>' + cell + '</td>';
    }
    html += '</tr>';
  }
  
  html += '</tbody></table>';
  html += '<p class="small">Giá trị là trung bình nhiều mô hình. Xem biểu đồ kèm khoảng tin cậy ở tab Dự báo.</p>';
  
  container.innerHTML = html;
}

/** Clear day detail */
export function clearDayDetail(): void {
  const titleEl = document.getElementById('dayDetailTitle');
  const metaEl = document.getElementById('dayDetailMeta');
  const container = document.getElementById('dayDetail');
  
  if (titleEl) titleEl.textContent = 'Chọn một ngày trong tháng';
  if (metaEl) metaEl.textContent = '\u2014';
  if (container) {
    container.innerHTML = '<p class="muted">Bấm vào một ngày có dự báo trong lịch tháng (hoặc thẻ 16 ngày) để xem chi tiết từng giờ.</p>';
  }
  
  selectedDay = null;
  actions.setSelectedDay(null);
}

/** Get selected day */
export function getSelectedDay(): string | null {
  return selectedDay;
}