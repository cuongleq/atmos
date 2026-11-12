/**
 * ATMOS App - Month Calendar
 * Monthly calendar with observations and forecasts
 */

import { selectors } from '../state/index.js';
import { $, fmt, finite, dateDM, todayISO, esc } from '../helpers/index.js';
import { MONTH_NAMES, DAY_NAMES_SHORT } from '../constants/index.js';
import { actions } from '../state/index.js';

/** Load and render month calendar */
export function loadMonthCal(): void {
  const live = selectors.currentLive();
  const report = selectors.currentReport();
  const container = document.getElementById('monthCal');
  const titleEl = document.getElementById('monthTitle');
  const metaEl = document.getElementById('monthMeta');
  const picker = document.getElementById('monthPicker') as HTMLInputElement;
  
  if (!container || !titleEl || !metaEl || !picker) return;
  
  const offset = selectors.currentMonthOffset?.() ?? 0;
  const now = new Date();
  const targetMonth = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  
  // Update title and picker
  titleEl.textContent = MONTH_NAMES[targetMonth.getMonth()] + ' ' + targetMonth.getFullYear();
  picker.value = targetMonth.getFullYear() + '-' + String(targetMonth.getMonth() + 1).padStart(2, '0');
  
  if (!live || !report) {
    container.innerHTML = '<p class="muted">Chờ dữ liệu.</p>';
    return;
  }
  
  const { base } = live;
  const hourly = base.hourly;
  const daily = base.daily;
  
  // Get ERA5 observations (from report period)
  // For now, use daily forecast data
  const startOfMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
  const endOfMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
  const today = todayISO();
  
  // Build day data
  const daysInMonth = endOfMonth.getDate();
  const firstDayOfWeek = startOfMonth.getDay(); // 0 = Sunday
  
  // Get daily forecast data for this month
  const forecastByDate: Record<string, any> = {};
  if (daily?.time) {
    for (let i = 0; i < daily.time.length; i++) {
      const date = daily.time[i];
      forecastByDate[date] = {
        tmax: daily.temperature_2m_max?.[i],
        tmin: daily.temperature_2m_min?.[i],
        rain: daily.precipitation_sum?.[i],
        prob: daily.precipitation_probability_max?.[i],
        gust: daily.wind_gusts_10m_max?.[i],
        code: daily.weather_code?.[i],
      };
    }
  }
  
  let html = '<table class="month-calendar"><thead><tr>';
  for (const d of DAY_NAMES_SHORT) {
    html += '<th' + (d === 'CN' || d === 'T7' ? ' class="weekend"' : '') + '>' + d + '</th>';
  }
  html += '</tr></thead><tbody><tr>';
  
  // Empty cells before first day
  for (let i = 0; i < firstDayOfWeek; i++) {
    html += '<td class="empty"></td>';
  }
  
  let dayOfWeek = firstDayOfWeek;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = targetMonth.getFullYear() + '-' + String(targetMonth.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const fc = forecastByDate[dateStr];
    const isToday = dateStr === today;
    const isPast = dateStr < today;
    const hasForecast = !!fc;
    
    let classes = 'day';
    if (isToday) classes += ' today';
    if (isPast) classes += ' past';
    if (!hasForecast) classes += ' no-forecast';
    if (dayOfWeek === 0 || dayOfWeek === 6) classes += ' weekend';
    
    let content = '<div class="day-num">' + day + '</div>';
    
    if (fc) {
      const tmax = finite(fc.tmax) ? fmt(fc.tmax, 0) : '\u2014';
      const tmin = finite(fc.tmin) ? fmt(fc.tmin, 0) : '\u2014';
      const rain = finite(fc.rain) ? fmt(fc.rain, 1) : '\u2014';
      const prob = finite(fc.prob) ? Math.round(fc.prob) : 0;
      const icon = fc.code ? '<span class="weather-icon">' + (finite(fc.code) ? (finite(fc.code) ? '\u2600' : '') : '') + '</span>' : '';
      
      content += 
        '<div class="day-temps">' + tmax + '\u00B0/' + tmin + '\u00B0</div>' +
        '<div class="day-rain">' + rain + 'mm ' + (prob > 0 ? '(' + prob + '%)' : '') + '</div>';
    }
    
    if (isToday) {
      content += '<div class="today-badge">Hôm nay</div>';
    }
    
    html += '<td class="' + classes + '" data-date="' + esc(dateStr) + '">' + content + '</td>';
    
    dayOfWeek++;
    if (dayOfWeek === 7) {
      dayOfWeek = 0;
      if (day < daysInMonth) html += '</tr><tr>';
    }
  }
  
  // Empty cells after last day
  while (dayOfWeek !== 0) {
    html += '<td class="empty"></td>';
    dayOfWeek = (dayOfWeek + 1) % 7;
  }
  
  html += '</tr></tbody></table>';
  container.innerHTML = html;
  
  // Add click handlers for days with forecast
  container.querySelectorAll('td.day[data-date]').forEach(td => {
    td.addEventListener('click', () => {
      const date = td.dataset.date!;
      if (forecastByDate[date]) {
        actions.setSelectedDay(date);
        renderDayDetail(date);
      }
    });
  });
  
  // Meta info
  const forecastDays = Object.keys(forecastByDate).filter(d => {
    const dt = new Date(d);
    return dt >= startOfMonth && dt <= endOfMonth;
  }).length;
  
  const pastDays = Object.keys(forecastByDate).filter(d => d < today && new Date(d) >= startOfMonth).length;
  
  if (metaEl) {
    metaEl.textContent = forecastDays + ' ngày có dự báo trong tháng \u00B7 ' + pastDays + ' ngày đã qua \u00B7 Chỉ có dự báo đến 16 ngày';
  }
}

/** Get current month offset from state */
function currentMonthOffset(): number {
  return actions as any; // Access via state.ui.monthOffset
}

/** Render day detail (imported from days module) */
function renderDayDetail(date: string): void {
  // This is handled by days module
  // Just trigger the event
  const event = new CustomEvent('daySelected', { detail: { date } });
  window.dispatchEvent(event);
}