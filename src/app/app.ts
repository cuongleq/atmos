/**
 * ATMOS App - Main Entry Point
 * Initializes all modules and coordinates the application
 */

import { state, actions, selectors } from './state/index.js';
import { initForecast, loadForecast, renderForecast } from './forecast/index.js';
import { initChart, renderChart } from './chart/index.js';
import { renderParams } from './params/index.js';
import { renderDays, renderDayDetail, clearDayDetail, getSelectedDay } from './days/index.js';
import { loadMonthCal } from './month/index.js';
import { loadAqi } from './aqi/index.js';
import { loadAirMassAndRivers } from './airmass/index.js';
import { loadStorm } from './storm/index.js';
import { renderNchmf, filterNews } from './nchmf/index.js';
import { initDisaster, syncDisasterToPlace, loadDisasterData } from './disaster/index.js';
import { DEFAULT_PLACE } from './constants/index.js';
import { initSentry, getSentryConfig } from '../monitoring/sentry.js';

/** Initialize the entire application */
export async function initApp(): Promise<void> {
  // Engine is already bundled globally as AtmosEngine
  
  // Initialize Sentry error tracking
  const sentryConfig = getSentryConfig();
  if (sentryConfig.dsn) {
    initSentry(sentryConfig);
    console.log('[Sentry] Error tracking initialized');
  } else {
    console.log('[Sentry] No DSN provided, error tracking disabled');
  }
  
  // Load benchmark report
  await loadReport();
  
  // Initialize modules
  initForecast();
  initChart();
  initDisaster();
  
  // Set up tab switching
  setupTabs();
  
  // Set up global event handlers
  setupGlobalHandlers();
  
  // Load initial forecast
  await loadForecast();
  
  // Start periodic health check (dev only)
  if (import.meta.env.DEV) {
    console.log('[ATMOS] App initialized');
  }
}

/** Load benchmark.json */
async function loadReport(): Promise<void> {
  try {
    const resp = await fetch('/benchmark.json', { cache: 'no-cache' });
    if (resp.ok) {
      const report = await resp.json();
      actions.setReport(report);
      
      // Populate chart variable selector after report loads
      const chartVar = document.getElementById('chartVariable') as HTMLSelectElement;
      if (chartVar && report.variables) {
        const variables = Object.entries(report.variables)
          .filter(([, v]: any) => v.kind !== 'code' && v.kind !== 'direction')
          .sort((a: any, b: any) => a[1].group.localeCompare(b[1].group) || a[1].label.localeCompare(b[1].label));
        
        chartVar.innerHTML = variables.map(([key, v]: any) => 
          '<option value="' + key + '">' + v.label + ' (' + v.unit + ')</option>'
        ).join('');
        
        const saved = localStorage.getItem('atmos-chart-variable');
        if (saved && variables.some(([k]: any) => k === saved)) {
          chartVar.value = saved;
          actions.setChartVariable(saved);
        } else if (variables.length) {
          chartVar.value = variables[0][0];
          actions.setChartVariable(variables[0][0]);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load benchmark:', err);
  }
}

/** Set up tab navigation */
function setupTabs(): void {
  const tabs = document.querySelectorAll('.tab');
  const views = document.querySelectorAll('.view');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const viewId = tab.dataset.view;
      if (!viewId) return;
      
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      views.forEach(v => v.hidden = true);
      const view = document.getElementById(viewId);
      if (view) view.hidden = false;
      
      actions.setActiveTab(viewId as any);
      
      // Load data for specific tabs
      if (viewId === 'mass' && !state.levels.get()) {
        loadAirMassAndRivers();
      }
      if (viewId === 'news') {
        renderNchmf();
      }
      if (viewId === 'disaster') {
        syncDisasterToPlace();
      }
    });
  });
}

/** Set up global event handlers */
function setupGlobalHandlers(): void {
  // Export button
  const exportBtn = document.getElementById('exportForecast');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportCsv);
  }
  
  // Chart variable change
  const chartVar = document.getElementById('chartVariable');
  if (chartVar) {
    chartVar.addEventListener('change', () => {
      actions.setChartVariable((chartVar as HTMLSelectElement).value);
      localStorage.setItem('atmos-chart-variable', (chartVar as HTMLSelectElement).value);
      renderChart();
    });
  }
  
  // Horizon change
  const horizon = document.getElementById('horizon');
  if (horizon) {
    horizon.addEventListener('change', () => {
      actions.setChartHorizon(parseInt((horizon as HTMLSelectElement).value));
      renderChart();
    });
  }
  
  // Show bands toggle
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
  
  // River selection
  const riverList = document.getElementById('riverList');
  if (riverList) {
    riverList.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-river]');
      if (btn) {
        state.riverSel.set(parseInt(btn.dataset.river!));
        renderRivers(state.rivers.get() || []);
        renderRiverChart();
      }
    });
  }
  
  // Refresh buttons
  const refresh = document.getElementById('refresh');
  if (refresh) refresh.addEventListener('click', loadForecast);
  
  const refreshRadar = document.getElementById('disasterRefreshRadar');
  if (refreshRadar) refreshRadar.addEventListener('click', () => { /* loadRadar() */ });
  
  const loadAlerts = document.getElementById('disasterLoadAlerts');
  if (loadAlerts) loadAlerts.addEventListener('click', loadDisasterData);
  
  // News filter buttons
  document.querySelectorAll('.news-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterNews((btn as HTMLElement).dataset.filter || 'all');
    });
  });
  
  // Reload NCHMF
  const btnReload = document.getElementById('btnReloadNews');
  if (btnReload) btnReload.addEventListener('click', renderNchmf);
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    
    switch (e.key) {
      case 'r':
      case 'R': loadForecast(); break;
      case 'ArrowLeft': 
        if (selectors.activeTab() === 'forecast') {
          const hor = document.getElementById('horizon') as HTMLSelectElement;
          if (hor) { hor.value = String(Math.max(48, parseInt(hor.value) - 48)); hor.dispatchEvent(new Event('change')); }
        }
        break;
      case 'ArrowRight':
        if (selectors.activeTab() === 'forecast') {
          const hor = document.getElementById('horizon') as HTMLSelectElement;
          if (hor) { hor.value = String(Math.min(168, parseInt(hor.value) + 48)); hor.dispatchEvent(new Event('change')); }
        }
        break;
    }
  });
  
  // Handle visibility change (pause/resume animations)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Pause animations
    } else {
      // Resume
    }
  });
  
  // Make some functions globally available for inline handlers
  (window as any).renderNchmf = renderNchmf;
  (window as any).filterNews = filterNews;
  (window as any).loadDisasterData = loadDisasterData;
  (window as any).syncDisasterToPlace = syncDisasterToPlace;
  (window as any).__ATMOS_APP__ = {
    state,
    actions,
    selectors,
    loadForecast,
    renderChart,
    renderParams,
    renderDays,
    renderDayDetail,
    clearDayDetail,
    loadMonthCal,
    loadAqi,
    loadAirMassAndRivers,
    loadStorm,
    renderRivers,
    renderRiverChart,
    renderNchmf,
    initDisaster,
    syncDisasterToPlace,
    loadDisasterData,
  };
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}