/**
 * ATMOS App - State Management
 * Lightweight reactive store using signals pattern
 */

import { Place, LiveForecast, BenchmarkReport, RiverData } from '../types/app.js';

/** Signal implementation */
export class Signal<T> {
  private value: T;
  private subscribers = new Set<(value: T) => void>();
  
  constructor(initialValue: T) {
    this.value = initialValue;
  }
  
  get(): T {
    return this.value;
  }
  
  set(value: T): void {
    if (Object.is(this.value, value)) return;
    this.value = value;
    this.subscribers.forEach(cb => cb(value));
  }
  
  subscribe(cb: (value: T) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
  
  /** Derived signal */
  derive<U>(fn: (value: T) => U): Signal<U> {
    const derived = new Signal(fn(this.value));
    this.subscribe(v => derived.set(fn(v)));
    return derived;
  }
}

/** Computed signal (derived from multiple signals) */
export function computed<U>(fn: () => U, deps: Signal<any>[]): Signal<U> {
  const signal = new Signal(fn());
  deps.forEach(dep => dep.subscribe(() => signal.set(fn())));
  return signal;
}

/** App state signals */
export const state = {
  // Current place
  place: new Signal<Place>({
    id: 'hcm',
    name: 'TP. Hồ Chí Minh',
    lat: 10.8231,
    lon: 106.6297,
    utcOffset: 7,
  }),
  
  // Live forecast data
  live: new Signal<LiveForecast | null>(null),
  
  // Benchmark report
  report: new Signal<BenchmarkReport | null>(null),
  
  // Pressure level data
  levels: new Signal<any | null>(null),
  
  // River data
  rivers: new Signal<RiverData[] | null>(null),
  
  // Selected river index
  riverSel: new Signal(0),
  
  // Selected day for detail view
  selectedDay: new Signal<string | null>(null),
  
  // Request ID for race condition prevention
  requestId: new Signal(0),
  
  // Calibration cache
  calCache: new Signal<Map<string, any[]>>(new Map()),
  
  // Loading states
  loading: {
    forecast: new Signal(false),
    levels: new Signal(false),
    rivers: new Signal(false),
    aqi: new Signal(false),
    nchmf: new Signal(false),
  },
  
  // Error states
  error: new Signal<string | null>(null),
  
  // UI state
  ui: {
    activeTab: new Signal<'forecast' | 'mass' | 'news' | 'methods' | 'disaster'>('forecast'),
    chartVariable: new Signal<string>('temperature_2m'),
    chartHorizon: new Signal(48),
    showBands: new Signal(true),
    monthOffset: new Signal(0),
    disasterChips: new Signal<string[]>([]),
  },
};

/** Actions - pure functions that update state */
export const actions = {
  setPlace(place: Place): void {
    state.place.set(place);
    // Clear dependent data
    state.live.set(null);
    state.levels.set(null);
    state.rivers.set(null);
    state.calCache.set(new Map());
    state.selectedDay.set(null);
    state.ui.monthOffset.set(0);
  },
  
  setLiveForecast(live: LiveForecast): void {
    state.live.set(live);
    state.calCache.set(new Map());
  },
  
  setReport(report: BenchmarkReport): void {
    state.report.set(report);
  },
  
  setLevels(levels: any): void {
    state.levels.set(levels);
  },
  
  setRivers(rivers: RiverData[]): void {
    state.rivers.set(rivers);
    state.riverSel.set(0);
  },
  
  selectRiver(index: number): void {
    state.riverSel.set(index);
  },
  
  setSelectedDay(day: string | null): void {
    state.selectedDay.set(day);
  },
  
  nextRequestId(): number {
    const id = state.requestId.get() + 1;
    state.requestId.set(id);
    return id;
  },
  
  setLoading(key: keyof typeof state.loading, value: boolean): void {
    state.loading[key].set(value);
  },
  
  setError(message: string | null): void {
    state.error.set(message);
  },
  
  setActiveTab(tab: typeof state.ui.activeTab): void {
    state.ui.activeTab.set(tab);
  },
  
  setChartVariable(variable: string): void {
    state.ui.chartVariable.set(variable);
  },
  
  setChartHorizon(horizon: number): void {
    state.ui.chartHorizon.set(horizon);
  },
  
  toggleBands(): void {
    state.ui.showBands.set(!state.ui.showBands.get());
  },
  
  setMonthOffset(offset: number): void {
    state.ui.monthOffset.set(offset);
  },
  
  setDisasterChips(chips: string[]): void {
    state.ui.disasterChips.set(chips);
  },
};

/** Selectors - computed values */
export const selectors = {
  // Current place
  currentPlace: () => state.place.get(),
  
  // Current live forecast
  currentLive: () => state.live.get(),
  
  // Current report
  currentReport: () => state.report.get(),
  
  // Whether we have valid data
  hasData: () => state.live.get() !== null && state.report.get() !== null,
  
  // Current chart variable
  chartVariable: () => state.ui.chartVariable.get(),
  
  // Current chart horizon
  chartHorizon: () => state.ui.chartHorizon.get(),
  
  // Show bands
  showBands: () => state.ui.showBands.get(),
  
  // Selected river
  selectedRiver: () => {
    const rivers = state.rivers.get();
    const sel = state.riverSel.get();
    return rivers && rivers.length > sel ? rivers[sel] : null;
  },
  
  // All rivers
  allRivers: () => state.rivers.get() || [],
  
  // Loading state
  isLoading: () => Object.values(state.loading).some(s => s.get()),
  
  // Current error
  currentError: () => state.error.get(),
  
  // Active tab
  activeTab: () => state.ui.activeTab.get(),
  
  // Month offset
  currentMonthOffset: () => state.ui.monthOffset.get(),
};

/** Persist place to localStorage */
export function persistPlace(): void {
  try {
    localStorage.setItem('atmos-last-place', JSON.stringify(state.place.get()));
  } catch {}
}

/** Restore place from localStorage */
export function restorePlace(): Place | null {
  try {
    const stored = localStorage.getItem('atmos-last-place');
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

/** Subscribe to place changes and persist */
state.place.subscribe(persistPlace);