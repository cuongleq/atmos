/**
 * ATMOS App - Helpers
 * Formatters, utilities, and small helper functions
 */

import { Place } from '../types/app.js';
import { BEARINGS, COMPASS8, WEATHER_FAMILY_ICON } from '../constants/index.js';

// Get E from global namespace (set by engine bundle)
const E = (window as any).AtmosEngine;

/** Format number with Vietnamese locale */
export const fmt = (v: number | null | undefined, n = 1): string => {
  if (!E.finite(v)) return '\u2014';
  return v.toLocaleString('vi-VN', { minimumFractionDigits: n, maximumFractionDigits: n });
};

/** Format percentage */
export const pct = (v: number | null | undefined, n = 0): string => {
  if (!E.finite(v)) return '\u2014';
  return fmt(v * 100, n) + ' %';
};

/** Escape HTML */
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => {
  if (c === '&') return '&';
  if (c === '<') return '<';
  if (c === '>') return '>';
  if (c === '"') return '"';
  return '\'';
});

/** Get variable digits from report */
export const getDigits = (report: any, variable: string): number =>
  report.variables[variable]?.digits ?? 1;

/** Get variable unit from report */
export const getUnit = (report: any, variable: string): string =>
  report.variables[variable]?.unit ?? '';

/** Get variable range [min, max] */
export const getRange = (report: any, variable: string): [number | null, number | null] => {
  const s = report.variables[variable];
  if (!s) return [null, null];
  if (s.kind === 'logit') return [0, 100];
  if (s.kind === 'log1p') return [0, null];
  return [null, null];
};

/** Get weather condition text from code */
export const condition = (code: number | null | undefined): string => E.conditionOf(code);

/** Convert bearing degrees to Vietnamese compass */
export const bearing = (deg: number | null | undefined): string => {
  if (!E.finite(deg)) return '\u2014';
  const d = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return `${Math.round(deg!)}\u00B0 ${BEARINGS[d]}`;
};

/** Get compass direction (8-point) */
export const compass = (deg: number | null | undefined): string => {
  if (!E.finite(deg)) return '\u2014';
  const d = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS8[d];
};

/** Get weather family icon from code */
export const weatherFamily = (code: number | null | undefined): string => {
  const g = E.condGroup(code);
  return WEATHER_FAMILY_ICON[g as keyof typeof WEATHER_FAMILY_ICON] || '\u2014';
};

/** Format distance */
export const fmtDistance = (km: number | null | undefined): string => {
  if (!E.finite(km)) return '\u2014';
  return fmt(km, km < 10 ? 1 : 0);
};

/** Format temperature with °C */
export const fmtTemp = (v: number | null | undefined): string => {
  if (!E.finite(v)) return '\u2014';
  return `${fmt(v, 1)}\u00B0C`;
};

/** Format wind speed with km/h */
export const fmtWind = (v: number | null | undefined): string => {
  if (!E.finite(v)) return '\u2014';
  return `${fmt(v, 0)} km/h`;
};

/** Format humidity with % */
export const fmtHumidity = (v: number | null | undefined): string => {
  if (!E.finite(v)) return '\u2014';
  return `${fmt(v, 0)}%`;
};

/** Show notice message */
export function notice(id: string, text: string, type = ''): void {
  const n = document.getElementById(id);
  if (!n) return;
  n.textContent = text;
  n.className = 'notice ' + type;
}

/** Get element by ID with type safety */
export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('Element #' + id + ' not found');
  return el;
}

/** Check if value is finite number */
export const finite = (v: unknown): v is number => E.finite(v);

/** Safe array access */
export const safeGet = <T>(arr: T[] | null | undefined, i: number): T | null => {
  if (!arr || i < 0 || i >= arr.length) return null;
  const v = arr[i];
  return finite(v) ? v : null;
};

/** Mean of finite values */
export const meanFinite = (arr: (number | null)[]): number | null => {
  let s = 0, c = 0;
  for (const v of arr) if (finite(v)) { s += v; c++; }
  return c ? s / c : null;
};

/** Variance of finite values */
export const varFinite = (arr: (number | null)[]): number | null => {
  const m = meanFinite(arr);
  if (m === null) return null;
  let s = 0, c = 0;
  for (const v of arr) if (finite(v)) { s += (v - m) ** 2; c++; }
  return c ? s / c : null;
};

/** Distance between two places in km */
export const distanceKm = (a: Place, b: Place): number => E.distanceKm(a, b);

/** Convert to m/s from km/h */
export const toUms = (spd: number | null | undefined, dir: number | null | undefined): { u: number; v: number } => {
  if (!finite(spd) || !finite(dir)) return { u: 0, v: 0 };
  return E.toUms(spd, dir);
};

/** Get current time index in levels array */
export function levelNowIndex(levels: any): number | null {
  if (!levels?.time?.length) return null;
  const local = new Date(Date.now() + (levels.offsetSeconds || 0) * 1000);
  const iso = local.toISOString().slice(0, 13) + ':00';
  let i = levels.time.indexOf(iso);
  if (i >= 0) return i;
  
  // Fallback: nearest time
  let best = 0, bestGap = Infinity;
  const t0 = local.getTime();
  for (let k = 0; k < levels.time.length; k++) {
    const gap = Math.abs(new Date(levels.time[k] + 'Z').getTime() - t0);
    if (gap < bestGap) { bestGap = gap; best = k; }
  }
  return best;
}

/** Get series aligned to target time array */
export function levelSeries(levels: any, id: string, variable: string, time: string[]): (number | null)[] {
  const col = levels?.series?.[id]?.[variable];
  if (!col) return time.map(() => null);
  const idx = new Map(levels.time.map((t: string, i: number) => [t, i]));
  return time.map(t => {
    const k = idx.get(t);
    return k == null ? null : col[k];
  });
}

/** Debounce function */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/** Throttle function */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/** Generate unique ID */
export const uid = (): string => Math.random().toString(36).slice(2, 9);

/** Sleep/delay */
export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Format ISO time to HH:mm */
export const timeHM = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
};

/** Format ISO date to DD/MM */
export const dateDM = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  } catch {
    return iso.slice(5, 10);
  }
};

/** Get today's ISO date */
export const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** Check if running in browser */
export const isBrowser = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined';

/** Get base URL for assets */
export const getBaseUrl = (): string => {
  if (!isBrowser()) return '';
  return window.location.origin;
};

/** Get active forecast times */
export function activeTimes(base: any, horizonHours = 168): string[] {
  const h = base.hourly;
  const now = base.current?.time || h.time[0];
  const key = now.slice(0, 13) + ':00';
  let idx = h.time.findIndex((t: string) => t >= key);
  if (idx < 0) idx = 0;
  return h.time.slice(idx, idx + horizonHours);
}