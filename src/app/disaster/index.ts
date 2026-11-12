/**
 * ATMOS App - Disaster / Radar / Typhoon
 * External data layers: radar, tropical cyclones, alerts
 */

import { selectors } from '../state/index.js';
import { $, fmt, finite, esc, distanceKm } from '../helpers/index.js';
import { api } from '../api/index.js';
import { cycloneManager, initCycloneFeature, getCycloneDisplayData } from '../../features/cyclone/api.js';

let disasterChips: string[] = [];

/** Initialize disaster module */
export function initDisaster(): void {
  setupDisasterEvents();
  syncDisasterToPlace();
}

/** Set up event listeners */
function setupDisasterEvents(): void {
  const searchForm = document.getElementById('disasterSearchForm');
  if (searchForm) {
    searchForm.addEventListener('submit', handleDisasterSearch);
  }
  
  const refreshRadar = document.getElementById('disasterRefreshRadar');
  if (refreshRadar) refreshRadar.addEventListener('click', loadRadar);
  
  const loadAlerts = document.getElementById('disasterLoadAlerts');
  if (loadAlerts) loadAlerts.addEventListener('click', loadDisasterData);
  
  const airGridToggle = document.getElementById('airGridToggle');
  if (airGridToggle) airGridToggle.addEventListener('click', toggleAirGrid);
  
  const radarPlay = document.getElementById('radarPlay');
  if (radarPlay) radarPlay.addEventListener('click', toggleRadarAnimation);
  
  const animToggle = document.getElementById('animToggle');
  if (animToggle) animToggle.addEventListener('click', toggleAnimMap);
  
  const animPlay = document.getElementById('animPlay');
  if (animPlay) animPlay.addEventListener('click', toggleAnimPlay);
  
  const animVar = document.getElementById('animVar');
  if (animVar) (animVar as HTMLSelectElement).addEventListener('change', () => refreshAnimMap());
  
  const disasterChipsContainer = document.getElementById('disasterChips');
  if (disasterChipsContainer) {
    disasterChipsContainer.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest('.chip');
      if (chip) selectDisasterChip(chip.dataset.id!);
    });
  }
}

/** Sync disaster view to current place */
export async function syncDisasterToPlace(): Promise<void> {
  const place = selectors.currentPlace();
  const noteEl = document.getElementById('disasterPlaceNote');
  const windyLink = document.getElementById('windyLink');
  
  if (noteEl) {
    noteEl.textContent = 'Radar va canh bao se gan voi vi tri: ' + place.name + ' (' + fmt(place.lat, 3) + ', ' + fmt(place.lon, 3) + ')';
  }
  
  if (windyLink) {
    (windyLink as HTMLAnchorElement).href = 'https://www.windy.com/' + place.lat + ',' + place.lon + ',8';
  }
  
  // Initialize cyclone feature if not already done
  initCycloneFeature().catch(console.error);
  
  loadDisasterChips();
  loadRadar();
  loadTropicalCyclones(); // Now uses new cyclone manager
  loadAlerts();
}

/** Load disaster location chips (saved searches) */
async function loadDisasterChips(): Promise<void> {
  const container = document.getElementById('disasterChips');
  if (!container) return;
  
  try {
    const stored = localStorage.getItem('atmos-disaster-places');
    const places = stored ? JSON.parse(stored) : [];
    
    if (!places.length) {
      container.innerHTML = '<span class="muted">Chua co vi tri yeu thich. Tim kiem de them.</span>';
      return;
    }
    
    container.innerHTML = places.map((p: any) => 
      '<span class="chip" data-id="' + esc(p.id) + '">' + esc(p.name) + ' <button class="chip-remove" data-id="' + esc(p.id) + '" title="Xoa">\u00D7</button></span>'
    ).join(' ');
    
  } catch {}
}

/** Select disaster chip */
function selectDisasterChip(id: string): void {
  try {
    const stored = localStorage.getItem('atmos-disaster-places');
    const places = stored ? JSON.parse(stored) : [];
    const place = places.find((p: any) => p.id === id);
    if (place) {
      actions.setPlace({
        id: place.id,
        name: place.name,
        lat: place.lat,
        lon: place.lon,
      });
      syncDisasterToPlace();
    }
  } catch {}
}

/** Handle disaster search */
async function handleDisasterSearch(e: Event): Promise<void> {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const input = form.querySelector('input') as HTMLInputElement;
  const query = input.value.trim();
  if (query.length < 2) return;
  
  try {
    const resp = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(query) + '&count=10&language=vi&format=json');
    const data = await resp.json();
    
    const container = document.getElementById('disasterSearchResults');
    if (!container) return;
    
    if (data.results?.length) {
      container.innerHTML = data.results.slice(0, 8).map((r: any) => 
        '<button class="search-result" data-lat="' + r.latitude + '" data-lon="' + r.longitude + '" data-name="' + esc(r.name) + '" data-admin="' + esc(r.admin1 || '') + '" data-country="' + esc(r.country) + '">' +
        '<strong>' + esc(r.name) + '</strong> ' + (r.admin1 ? ', ' + esc(r.admin1) : '') + (r.country ? ', ' + esc(r.country) : '') +
        '</button>'
      ).join('');
      
      container.style.display = 'block';
      
      container.querySelectorAll('.search-result').forEach(btn => {
        btn.addEventListener('click', () => {
          const place = {
            id: 'disaster-' + Date.now(),
            name: btn.dataset.name!,
            lat: parseFloat(btn.dataset.lat!),
            lon: parseFloat(btn.dataset.lon!),
          };
          actions.setPlace(place);
          syncDisasterToPlace();
          container.style.display = 'none';
          container.innerHTML = '';
        });
      });
    } else {
      container.innerHTML = '<p class="muted">Khong tim thay: ' + esc(query) + '</p>';
      container.style.display = 'block';
    }
  } catch (err) {
    const container = document.getElementById('disasterSearchResults');
    if (container) container.innerHTML = '<p class="muted">Loi tim kiem: ' + err + '</p>';
  }
}

/** Load radar from RainViewer */
let radarFrames: any[] = [];
let radarPlaying = false;
let radarTimer: ReturnType<typeof setInterval> | null = null;
let currentRadarFrame = 12;

async function loadRadar(): Promise<void> {
  const place = selectors.currentPlace();
  const mapEl = document.getElementById('radarMap');
  const msgEl = document.getElementById('radarMsg');
  const slider = document.getElementById('radarFrameSlider') as HTMLInputElement;
  const timeEl = document.getElementById('radarFrameTime');
  
  if (!mapEl) return;
  
  if (msgEl) msgEl.textContent = 'Dang tai radar...';
  
  try {
    // RainViewer API
    const resp = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await resp.json();
    
    radarFrames = data.radar?.past || [];
    if (!radarFrames.length) {
      if (msgEl) msgEl.textContent = 'Khong co khung radar.';
      return;
    }
    
    // Update slider max
    if (slider) {
      slider.max = String(radarFrames.length - 1);
      slider.value = String(radarFrames.length - 1);
      currentRadarFrame = radarFrames.length - 1;
    }
    
    // Render latest frame
    renderRadarFrame(radarFrames.length - 1);
    
    if (timeEl) {
      const frame = radarFrames[radarFrames.length - 1];
      timeEl.textContent = 'Khung radar \u2014 ' + new Date(frame.time * 1000).toLocaleString('vi-VN');
    }
    
    if (msgEl) msgEl.textContent = '';
    
  } catch (err) {
    console.error('Radar load failed:', err);
    if (msgEl) msgEl.textContent = 'Loi tai radar: ' + err;
  }
}

/** Render specific radar frame */
function renderRadarFrame(index: number): void {
  const mapEl = document.getElementById('radarMap');
  const place = selectors.currentPlace();
  if (!mapEl || !radarFrames.length) return;
  
  const frame = radarFrames[index];
  if (!frame) return;
  
  // Leaflet map with radar overlay
  const tileUrl = 'https://tilecache.rainviewer.com/v2/radar/{z}/{x}/{y}/' + frame.path + '/256.png';
  
  // Initialize map if needed
  if (!(mapEl as any)._leafletMap) {
    const L = (window as any).L;
    if (!L) { mapEl.innerHTML = '<p class="muted">Leaflet chua tai.</p>'; return; }
    
    const map = L.map(mapEl, { center: [place.lat, place.lon], zoom: 7, zoomControl: true });
    (mapEl as any)._leafletMap = map;
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '\u00A9 OpenStreetMap' }).addTo(map);
    L.tileLayer(tileUrl, { maxZoom: 10, opacity: 0.7, attribution: 'RainViewer' }).addTo(map);
    
    // Location marker
    L.marker([place.lat, place.lon]).addTo(map).bindPopup(place.name).openPopup();
  } else {
    // Update radar layer
    const map = (mapEl as any)._leafletMap;
    map.eachLayer((layer: any) => { if (layer._url && layer._url.includes('rainviewer')) map.removeLayer(layer); });
    L.tileLayer(tileUrl, { maxZoom: 10, opacity: 0.7, attribution: 'RainViewer' }).addTo(map);
  }
}

/** Toggle radar animation */
function toggleRadarAnimation(): void {
  const btn = document.getElementById('radarPlay');
  if (!btn) return;
  
  if (radarPlaying) {
    radarPlaying = false;
    btn.textContent = '\u25B6 Phat radar';
    if (radarTimer) { clearInterval(radarTimer); radarTimer = null; }
  } else {
    radarPlaying = true;
    btn.textContent = '\u23F8 Tam dung';
    radarTimer = setInterval(() => {
      currentRadarFrame = (currentRadarFrame - 1 + radarFrames.length) % radarFrames.length;
      renderRadarFrame(currentRadarFrame);
      const slider = document.getElementById('radarFrameSlider') as HTMLInputElement;
      if (slider) slider.value = String(currentRadarFrame);
      const timeEl = document.getElementById('radarFrameTime');
      if (timeEl) {
        const frame = radarFrames[currentRadarFrame];
        timeEl.textContent = 'Khung radar \u2014 ' + new Date(frame.time * 1000).toLocaleString('vi-VN');
      }
    }, 1000);
  }
}

/** Tropical cyclones from JTWC + GDACS */
async function loadTropicalCyclones(): Promise<void> {
  const listEl = document.getElementById('tcList');
  const metaEl = document.getElementById('tcMeta');
  if (!listEl) return;
  
  try {
    // Use new cyclone manager
    await cycloneManager.refresh();
    const cyclones = cycloneManager.getCyclones();
    
    if (!cyclones.length) {
      // Fallback to GDACS
      const resp = await fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/TC?fromDate=' + new Date(Date.now() - 7*86400000).toISOString().slice(0,10) + '&format=json');
      const data = await resp.json();
      const events = data.features || [];
      
      if (!events.length) {
        listEl.innerHTML = '<p class="muted">Khong co xoay nhiet do nao dang hoat dong.</p>';
        return;
      }
      
      const place = selectors.currentPlace();
      listEl.innerHTML = events.slice(0, 10).map((e: any) => {
        const props = e.properties;
        const coords = e.geometry?.coordinates;
        let dist = '\u2014';
        if (coords && coords.length >= 2) {
          dist = fmt(distanceKm(place, { lat: coords[1], lon: coords[0] }), 0) + ' km';
        }
        
        return '<div class="tc-item">' +
          '<strong>' + esc(props.eventname || 'TC') + '</strong> ' + esc(props.alertlevel || '') +
          '<br><small>' + esc(props.fromdate) + ' \u2192 ' + esc(props.todate) + ' \u00B7 ' + dist + ' tu vi tri hien tai</small>' +
          '<br><a href="' + esc(props.url || '#') + '" target="_blank" rel="noopener" class="btn-ghost" style="padding:2px 8px;font-size:11px;">Xem chi tiet</a>' +
        '</div>';
      }).join('');
      
      if (metaEl) metaEl.textContent = events.length + ' xoay nhiet do \u00B7 Cap nhat ' + new Date().toLocaleString('vi-VN');
      return;
    }
    
    // Render JTWC cyclones
    const place = selectors.currentPlace();
    listEl.innerHTML = cyclones.slice(0, 10).map((cyclone) => {
      const display = getCycloneDisplayData(cyclone);
      const coords = cyclone.positions[0];
      let dist = '\u2014';
      if (coords) {
        dist = fmt(distanceKm(place, { lat: coords.lat, lon: coords.lon }), 0) + ' km';
      }
      
      return '<div class="tc-item">' +
        '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">' +
          '<span style="font-size: 20px;">' + display.icon + '</span>' +
          '<div>' +
            '<strong>' + esc(cyclone.name) + '</strong> ' +
            '<span style="background: ' + display.categoryColor + '; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">' +
              display.categoryLabel +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div style="font-size: 12px; color: #666; margin-left: 28px;">' +
          'Gió max: ' + display.intensity + ' kt (' + display.intensityKmh + ' km/h)' +
          (display.pressure ? ' | Áp suất: ' + display.pressure + ' hPa' : '') +
          (display.movement ? ' | Di chuyển: ' + display.movement.speed.toFixed(1) + ' km/h @ ' + display.movement.direction.toFixed(0) + '°' : '') +
        '</div>' +
        '<br><small>' + 
          'Bản tin: ' + display.lastUpdate + 
          ' | Cập nhật tới: ' + display.nextAdvisory +
        '</small>' +
        '<br><a href="https://www.jtwc.navy.mil/" target="_blank" rel="noopener" class="btn-ghost" style="padding:2px 8px;font-size:11px;">Xem chi tiết JTWC</a>' +
        '<br><a href="https://www.gdacs.org/" target="_blank" rel="noopener" class="btn-ghost" style="padding:2px 8px;font-size:11px;">Xem chi tiết GDACS</a>' +
      '</div>';
    }).join('');
    
    if (metaEl) metaEl.textContent = cyclones.length + ' xoay nhiệt đới · Cập nhật ' + new Date().toLocaleString('vi-VN');
    
  } catch (err) {
    listEl.innerHTML = '<p class="muted">Loi tai xoay nhiet do: ' + err + '</p>';
  }
}

/** Load alerts from GDACS */
async function loadAlerts(): Promise<void> {
  const listEl = document.getElementById('alertsList');
  const metaEl = document.getElementById('alertsMeta');
  if (!listEl) return;
  
  try {
    const resp = await fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/ALL?fromDate=' + new Date(Date.now() - 7*86400000).toISOString().slice(0,10) + '&format=json');
    const data = await resp.json();
    
    const events = data.features || [];
    if (!events.length) {
      listEl.innerHTML = '<p class="muted">Khong co canh bao nao trong 7 ngay qua.</p>';
      return;
    }
    
    listEl.innerHTML = events.slice(0, 15).map((e: any) => {
      const props = e.properties;
      const type = props.eventtype || 'UNKNOWN';
      const icon = { EQ: '\uD83C\uDF0D', TC: '\uD83C\uDF00', FL: '\uD83C\uDF0A', DR: '\u2600\uFE0F', WF: '\uD83D\uDD25', VO: '\uD83C\uDF0B' }[type] || '\u26A0\uFE0F';
      
      return '<div class="alert-item">' +
        icon + ' <strong>' + esc(props.eventname || type) + '</strong> ' + esc(props.alertlevel || '') +
        '<br><small>' + esc(props.fromdate) + ' \u00B7 ' + esc(props.country || '') + '</small>' +
        '<br><a href="' + esc(props.url || '#') + '" target="_blank" rel="noopener" class="btn-ghost" style="padding:2px 8px;font-size:11px;">Chi tiet</a>' +
      '</div>';
    }).join('');
    
    if (metaEl) metaEl.textContent = events.length + ' su kien \u00B7 Cap nhat ' + new Date().toLocaleString('vi-VN');
    
  } catch (err) {
    listEl.innerHTML = '<p class="muted">Loi tai canh bao: ' + err + '</p>';
  }
}

/** Load all disaster data */
export function loadDisasterData(): void {
  loadTropicalCyclones();
  loadAlerts();
}

/** Air mass grid on map */
let airGridLayer: any = null;

function toggleAirGrid(): void {
  const btn = document.getElementById('airGridToggle');
  const mapEl = document.getElementById('radarMap');
  if (!btn || !mapEl) return;
  
  if (airGridLayer) {
    const map = (mapEl as any)._leafletMap;
    if (map) map.removeLayer(airGridLayer);
    airGridLayer = null;
    btn.textContent = 'Bat khoi khi tren ban do';
  } else {
    // Would add air mass overlay - simplified for now
    btn.textContent = 'Dang phat trien...';
  }
}

/** Animated forecast map */
let animMap: any = null;
let animPlaying = false;
let animTimer: ReturnType<typeof setInterval> | null = null;
let animFrame = 0;
const animFrames = 36;

function toggleAnimMap(): void {
  const controls = document.getElementById('animControls');
  if (!controls) return;
  controls.hidden = !controls.hidden;
  if (!controls.hidden && !animMap) initAnimMap();
}

function initAnimMap(): void {
  const place = selectors.currentPlace();
  const canvas = document.getElementById('animCanvas');
  if (!canvas) return;
  
  const L = (window as any).L;
  if (!L) return;
  
  if (!animMap) {
    animMap = L.map('animCanvas', { center: [place.lat, place.lon], zoom: 7 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(animMap);
  }
  
  refreshAnimMap();
}

function refreshAnimMap(): void {
  // Simplified - would fetch forecast grids from Open-Meteo
  const frameEl = document.getElementById('animTime');
  if (frameEl) frameEl.textContent = 'Frame ' + animFrame + '/' + animFrames;
}

function toggleAnimPlay(): void {
  const btn = document.getElementById('animPlay');
  if (!btn) return;
  
  if (animPlaying) {
    animPlaying = false;
    btn.textContent = '\u25B6 Phat';
    if (animTimer) { clearInterval(animTimer); animTimer = null; }
  } else {
    animPlaying = true;
    btn.textContent = '\u23F8 Tam dung';
    animTimer = setInterval(() => {
      animFrame = (animFrame + 1) % animFrames;
      refreshAnimMap();
    }, 500);
  }
}