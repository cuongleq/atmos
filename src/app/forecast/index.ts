/**
 * ATMOS App - Forecast Rendering
 * Main forecast display logic
 */

import { E } from '../../engine/index.js';
import { state, actions, selectors } from '../state/index.js';
import { 
  calibrationFor, 
  computePooledForecast, 
  majorityWeatherCode 
} from '../calibration/index.js';
import { 
  fetchPlaceData, 
  MODELS, 
  LIVE_VARS 
} from '../api/index.js';
import { 
  Place, 
  LiveForecast 
} from '../types/app.js';
import { 
  $, 
  notice, 
  fmt, 
  pct, 
  bearing, 
  condition, 
  weatherFamily, 
  activeTimes,
  esc 
} from '../helpers/index.js';
import { DEFAULT_PLACE, CHART_HORIZONS } from '../constants/index.js';
import { loadFloodData } from '../../features/flood/api.js';

/** Initialize forecast module */
export function initForecast(): void {
  // Set up event listeners
  setupEventListeners();
  
  // Load last place or default
  const saved = restorePlace() || DEFAULT_PLACE;
  actions.setPlace(saved);
  
  // Initial load
  loadForecast();
}

/** Restore place from localStorage */
function restorePlace(): Place | null {
  try {
    const stored = localStorage.getItem('atmos-last-place');
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

/** Set up DOM event listeners */
function setupEventListeners(): void {
  // Search form
  const searchForm = document.getElementById('searchForm');
  if (searchForm) {
    searchForm.addEventListener('submit', handleSearch);
  }
  
  // Geo button
  const geoBtn = document.getElementById('geoBtn');
  if (geoBtn) {
    geoBtn.addEventListener('click', handleGeoLocation);
  }
  
  // Refresh button
  const refreshBtn = document.getElementById('refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadForecast());
  }
  
  // Export button
  const exportBtn = document.getElementById('exportForecast');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportCsv);
  }
  
  // Chart variable selector
  const chartVar = document.getElementById('chartVariable');
  if (chartVar) {
    chartVar.addEventListener('change', () => {
      actions.setChartVariable((chartVar as HTMLSelectElement).value);
      renderChart();
    });
  }
  
  // Horizon selector
  const horizon = document.getElementById('horizon');
  if (horizon) {
    horizon.addEventListener('change', () => {
      actions.setChartHorizon(parseInt((horizon as HTMLSelectElement).value));
      renderChart();
    });
  }
  
  // Show bands checkbox
  const showBands = document.getElementById('showBands');
  if (showBands) {
    showBands.addEventListener('change', () => {
      actions.toggleBands();
      renderChart();
    });
  }
  
  // Month navigation
  const monthPrev = document.getElementById('monthPrev');
  const monthNext = document.getElementById('monthNext');
  const monthPicker = document.getElementById('monthPicker');
  
  if (monthPrev) monthPrev.addEventListener('click', () => {
    actions.setMonthOffset(state.ui.monthOffset.get() - 1);
    loadMonthCal();
  });
  if (monthNext) monthNext.addEventListener('click', () => {
    actions.setMonthOffset(state.ui.monthOffset.get() + 1);
    loadMonthCal();
  });
  if (monthPicker) monthPicker.addEventListener('change', () => {
    const val = (monthPicker as HTMLInputElement).value;
    const [year, month] = val.split('-').map(Number);
    const now = new Date();
    const current = now.getFullYear() * 12 + now.getMonth();
    const target = year * 12 + (month - 1);
    actions.setMonthOffset(target - current);
    loadMonthCal();
  });
}

/** Handle search form submission */
async function handleSearch(e: Event): Promise<void> {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const input = form.querySelector('input') as HTMLInputElement;
  const query = input.value.trim();
  if (query.length < 2) return;
  
  // Use Open-Meteo geocoding
  try {
    actions.setLoading('forecast', true);
    const resp = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=10&language=vi&format=json');
    const data = await resp.json();
    
    if (data.results?.length) {
      // Show results dropdown
      showSearchResults(data.results);
    } else {
      notice('liveStatus', 'Không tìm thấy địa điểm: ' + query, 'error');
    }
  } catch (err) {
    notice('liveStatus', 'Lỗi tìm kiếm: ' + err.message, 'error');
  } finally {
    actions.setLoading('forecast', false);
  }
}

/** Show search results dropdown */
function showSearchResults(results: any[]): void {
  const container = document.getElementById('searchResults');
  if (!container) return;
  
  container.innerHTML = results.slice(0, 8).map(r => 
    '<button class="search-result" data-lat="' + r.latitude + '" data-lon="' + r.longitude + '" data-name="' + esc(r.name) + '" data-admin="' + esc(r.admin1 || '') + '" data-country="' + esc(r.country) + '">' +
    '<strong>' + esc(r.name) + '</strong> ' + (r.admin1 ? ', ' + esc(r.admin1) : '') + (r.country ? ', ' + esc(r.country) : '') +
    '</button>'
  ).join('');
  
  container.style.display = 'block';
  
  container.querySelectorAll('.search-result').forEach(btn => {
    btn.addEventListener('click', () => {
      const place: Place = {
        id: 'search-' + Date.now(),
        name: btn.dataset.name!,
        lat: parseFloat(btn.dataset.lat!),
        lon: parseFloat(btn.dataset.lon!),
        utcOffset: 7,
      };
      actions.setPlace(place);
      container.style.display = 'none';
      container.innerHTML = '';
      loadForecast();
    });
  });
  
  // Close on outside click
  const closeHandler = (e: MouseEvent) => {
    if (!container.contains(e.target as Node)) {
      container.style.display = 'none';
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

/** Handle geolocation */
function handleGeoLocation(): void {
  if (!navigator.geolocation) {
    notice('liveStatus', 'Trình duyệt không hỗ trợ GPS', 'error');
    return;
  }
  
  notice('liveStatus', 'Đang lấy vị trí GPS…');
  
  navigator.geolocation.getCurrentPosition(
    pos => {
      const place: Place = {
        id: 'gps-' + Date.now(),
        name: 'Vị trí GPS',
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        utcOffset: 7,
      };
      actions.setPlace(place);
      loadForecast();
    },
    err => {
      notice('liveStatus', 'Không lấy được vị trí: ' + err.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

/** Main forecast loading function */
export async function loadForecast(): Promise<void> {
  const token = actions.nextRequestId();
  const place = selectors.currentPlace();
  const report = selectors.currentReport();
  
  // Clear UI
  clearForecastUI();
  notice('liveStatus', 'Đang lấy dữ liệu cho ' + place.name + '…');
  
  try {
    const fc = await fetchPlaceData(place, MODELS);
    
    // Check if request is stale
    if (token !== state.requestId.get()) return;
    
    actions.setLiveForecast(fc);
    actions.setLoading('forecast', false);
    
    // Render all components
    renderForecast();
    renderChart();
    renderParams();
    renderDays();
    actions.setSelectedDay(null);
    clearDayDetail();
    renderNchmf();
    loadMonthCal();
    loadAqi();
    loadAirMassAndRivers();
    
    // Load flood data
    const floodRivers = await loadFloodData(place);
    if (floodRivers.length > 0) {
      console.log('[Flood] Loaded', floodRivers.length, 'rivers for', place.name);
    }
    
    syncDisasterToPlace();
    
    // Status message
    const failed = fc.models.filter(m => !m).length;
    notice('liveStatus', failed
      ? MODELS.length - failed + '/' + MODELS.length + ' hệ thống có dữ liệu. Hệ thống thiếu được bỏ qua, giá trị thiếu không được coi là 0.'
      : 'Đã tải ' + MODELS.length + ' hệ thống và hiệu chỉnh bằng hệ số đã kiểm thử. Múi giờ ' + fc.base.timezone + '.',
      failed ? 'warning' : '');
    
  } catch (err) {
    if (token !== state.requestId.get()) return;
    actions.setLoading('forecast', false);
    handleForecastError(err);
  }
}

/** Clear forecast UI elements */
function clearForecastUI(): void {
  const elements = ['temp', 'humidity', 'wind', 'feels', 'rain24', 'rainRange', 'probHeavy', 'gustRisk'];
  for (const id of elements) {
    const el = document.getElementById(id);
    if (el) el.textContent = '\u2014';
  }
  
  const placeEl = document.getElementById('place');
  if (placeEl) placeEl.textContent = '\u2014';
  
  const coordEl = document.getElementById('coordinates');
  if (coordEl) coordEl.textContent = '\u2014';
  
  const conditionEl = document.getElementById('condition');
  if (conditionEl) conditionEl.textContent = 'Đang tải';
  
  const chartEl = document.getElementById('chart');
  if (chartEl) chartEl.textContent = 'Đang lấy dự báo…';
  
  const daysEl = document.getElementById('days');
  if (daysEl) daysEl.textContent = 'Đang tải…';
  
  const paramsEl = document.getElementById('paramGrid');
  if (paramsEl) paramsEl.innerHTML = '<p class="muted">Đang tải…</p>';
  
  const exportBtn = document.getElementById('exportForecast');
  if (exportBtn) (exportBtn as HTMLButtonElement).disabled = true;
  
  notice('riskMessage', 'Chờ dữ liệu để đánh giá.');
}

/** Handle forecast loading error */
function handleForecastError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  
  if (msg.includes('429') || msg.toLowerCase().includes('limit exceeded') || msg.includes('403')) {
    notice('liveStatus', 'Đã hết lượt API miễn phí của Open-Meteo (10,000 lượt/ngày). Xin thử lại vào ngày mai.', 'error');
  } else {
    notice('liveStatus', 'Không tải được dự báo: ' + msg + '. Kiểm tra kết nối rồi chọn Cập nhật.', 'error');
  }
  
  const conditionEl = document.getElementById('condition');
  if (conditionEl) conditionEl.textContent = 'Chưa có dữ liệu';
  
  const chartEl = document.getElementById('chart');
  if (chartEl) chartEl.textContent = 'Không có dữ liệu trực tiếp.';
  
  const daysEl = document.getElementById('days');
  if (daysEl) daysEl.textContent = 'Không có dữ liệu.';
  
  const paramsEl = document.getElementById('paramGrid');
  if (paramsEl) paramsEl.innerHTML = '<p class="muted">Không có dữ liệu trực tiếp.</p>';
}

/** Render current conditions */
export function renderForecast(): void {
  const live = selectors.currentLive();
  const report = selectors.currentReport();
  const place = selectors.currentPlace();
  
  if (!live || !report) return;
  
  const { base, byId } = live;
  const current = base.current;
  const hourly = base.hourly;
  const daily = base.daily;
  
  // Update place info
  const placeEl = document.getElementById('place');
  if (placeEl) placeEl.textContent = place.name;
  
  const coordEl = document.getElementById('coordinates');
  if (coordEl) coordEl.textContent = fmt(place.lat, 4) + '\u00B0 B \u00B7 ' + fmt(place.lon, 4) + '\u00B0 \u0110';
  
  // Current weather
  if (current) {
    const tempEl = document.getElementById('temp');
    if (tempEl && finite(current.temperature_2m)) tempEl.textContent = fmt(current.temperature_2m, 1);
    
    const humidityEl = document.getElementById('humidity');
    if (humidityEl && finite(current.relative_humidity_2m)) humidityEl.textContent = fmt(current.relative_humidity_2m, 0) + '%';
    
    const windEl = document.getElementById('wind');
    if (windEl && finite(current.wind_speed_10m)) windEl.textContent = fmtWind(current.wind_speed_10m) + ' ' + bearing(current.wind_direction_10m);
    
    const feelsEl = document.getElementById('feels');
    if (feelsEl && finite(current.apparent_temperature)) feelsEl.textContent = fmt(current.apparent_temperature, 1) + '\u00B0C';
    
    const conditionEl = document.getElementById('condition');
    if (conditionEl) {
      const code = current.weather_code;
      conditionEl.textContent = condition(code) + ' ' + weatherFamily(code);
    }
  }
  
  // Calibration note
  const calibNote = document.getElementById('calibNote');
  if (calibNote) {
    const loc = report.locations.find(l => l.id === place.id);
    const hasCalib = loc?.tests.some(t => t.usable) ?? false;
    calibNote.textContent = hasCalib 
      ? 'Đã hiệu chỉnh EMOS tại địa điểm này.'
      : 'Dùng hiệu chỉnh gộp 6 địa điểm (chưa có hiệu chỉnh riêng).';
    calibNote.className = hasCalib ? 'small' : 'small muted';
  }
  
  // 24h rain summary
  renderRain24();
  
  // Enable export
  const exportBtn = document.getElementById('exportForecast');
  if (exportBtn) (exportBtn as HTMLButtonElement).disabled = false;
}

/** Render 24h rain risk */
function renderRain24(): void {
  const live = selectors.currentLive();
  if (!live) return;
  
  const { base } = live;
  const hourly = base.hourly;
  const times = activeTimes(base);
  
  // Sum next 24 hours
  let sum24 = 0, min24 = Infinity, max24 = -Infinity;
  let probHeavy = 0, probGust = 0;
  let count = 0;
  
  for (let i = 0; i < Math.min(24, times.length); i++) {
    const t = times[i];
    const idx = hourly.time.indexOf(t);
    if (idx < 0) continue;
    
    const rain = hourly.precipitation?.[idx];
    const gust = hourly.wind_gusts_10m?.[idx];
    const prob = hourly.precipitation_probability?.[idx];
    
    if (finite(rain)) {
      sum24 += rain;
      min24 = Math.min(min24, rain);
      max24 = Math.max(max24, rain);
    }
    if (finite(prob) && prob >= 50) probHeavy++;
    if (finite(gust) && gust >= 60) probGust++;
    count++;
  }
  
  const rain24 = document.getElementById('rain24');
  if (rain24) rain24.textContent = count ? fmt(sum24, 1) : '\u2014';
  
  const rainRange = document.getElementById('rainRange');
  if (rainRange && count) {
    rainRange.textContent = fmt(min24, 1) + ' \u2192 ' + fmt(max24, 1) + ' mm/gi\u1EDD';
  }
  
  const probHeavyEl = document.getElementById('probHeavy');
  if (probHeavyEl) probHeavyEl.textContent = count ? pct(probHeavy / count) : '\u2014';
  
  const gustRisk = document.getElementById('gustRisk');
  if (gustRisk) gustRisk.textContent = count ? pct(probGust / count) : '\u2014';
  
  // Risk message
  let msg = '';
  if (sum24 >= 50) msg = 'Tổng mưa 24h tới cao. ';
  else if (sum24 >= 20) msg = 'Có mưa đáng kể trong 24h tới. ';
  else if (sum24 > 0) msg = 'Mưa nhẹ rải rác. ';
  else msg = 'Không mưa trong 24h tới. ';
  
  if (probGust > 0) msg += 'Có gió giật mạnh (≥60 km/h). ';
  
  notice('riskMessage', msg || 'Đang đánh giá…');
}

/** Export forecast to CSV */
function exportCsv(): void {
  const live = selectors.currentLive();
  const report = selectors.currentReport();
  if (!live || !report) return;
  
  const { base } = live;
  const hourly = base.hourly;
  const times = activeTimes(base);
  const variables = Object.keys(report.variables);
  
  let csv = 'Thời gian';
  for (const v of variables) csv += ',' + v;
  csv += '\n';
  
  for (const t of times) {
    const idx = hourly.time.indexOf(t);
    if (idx < 0) continue;
    
    let row = t.replace('T', ' ');
    for (const v of variables) {
      const val = hourly[v]?.[idx];
      row += ',' + (finite(val) ? fmt(val, 2) : '');
    }
    csv += row + '\n';
  }
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'atmos-forecast-' + selectors.currentPlace().id + '-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}