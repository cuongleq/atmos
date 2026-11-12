/**
 * ATMOS App - API Layer
 * Handles all Open-Meteo API calls with retry logic and rate limiting
 */

import { LIVE_VARS, LEVEL_VARS, FETCH_CONCURRENCY, RETRY_CONFIG } from '../constants/index.js';
import { sleep } from '../helpers/index.js';

// Get MODELS from global E namespace
const MODELS = (window as any).AtmosEngine?.MODELS || [
  { id: 'gfs_global', name: 'NOAA GFS' },
  { id: 'ecmwf_ifs025', name: 'ECMWF IFS 0,25°' },
  { id: 'icon_global', name: 'DWD ICON' },
  { id: 'jma_seamless', name: 'JMA GSM' },
  { id: 'gem_seamless', name: 'ECCC GEM' },
  { id: 'meteofrance_seamless', name: 'Météo-France' },
  { id: 'ukmo_seamless', name: 'UK Met Office' },
];

// Level models are the same as MODELS (all deterministic models)
const LEVEL_MODELS = MODELS.map(m => m.id);

export { MODELS, LIVE_VARS, LEVEL_VARS, LEVEL_MODELS };

/** Rate limiter for Open-Meteo API */
class RateLimiter {
  private lastRequest = 0;
  private interval: number;
  private queue: Array<() => Promise<any>> = [];
  private processing = false;

  constructor(intervalMs = 100) {
    this.interval = intervalMs;
  }

  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const wait = this.lastRequest + this.interval - now;
      if (wait > 0) await sleep(wait);
      
      this.lastRequest = Date.now();
      const fn = this.queue.shift()!;
      await fn();
    }
    
    this.processing = false;
  }

  setInterval(ms: number): void {
    this.interval = ms;
  }
}

const rateLimiter = new RateLimiter(150); // ~6-7 req/sec max

/** Fetch with timeout and retry */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = RETRY_CONFIG.maxAttempts
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      
      // Handle rate limiting
      if (response.status === 429 || response.status === 503) {
        const retryAfter = response.headers.get('retry-after');
        let waitMs = 60000;
        
        if (retryAfter) {
          const sec = parseInt(retryAfter, 10);
          if (!isNaN(sec)) waitMs = sec * 1000;
        }
        
        if (waitMs > 0 && waitMs < 300000) {
          console.log('[API] Rate limited, waiting ' + Math.round(waitMs / 1000) + 's');
          await sleep(waitMs);
          continue;
        }
      }
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.reason || 'HTTP ' + response.status);
      }
      
      return response;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      
      // Don't retry on abort or client errors (except 429)
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      if (e instanceof Error && e.message.startsWith('HTTP 4')) {
        if (!e.message.includes('429')) throw e;
      }
      
      if (attempt < retries - 1) {
        const delay = Math.min(
          RETRY_CONFIG.baseDelay * 2 ** attempt + Math.random() * 1000,
          RETRY_CONFIG.maxDelay
        );
        await sleep(delay);
      }
    }
  }
  
  throw lastError || new Error('Fetch failed after retries');
}

/** Main API call with rate limiting */
export async function api(baseUrl: string, params: Record<string, any>): Promise<any> {
  const url = baseUrl + '?' + new URLSearchParams(params);
  return rateLimiter.throttle(() => fetchWithRetry(url).then(r => r.json()));
}

/** Fetch forecast for a place (base + all models) */
export async function fetchPlaceData(place: any, models: any[]): Promise<any> {
  const baseParams = {
    latitude: place.lat,
    longitude: place.lon,
    timezone: 'auto',
    forecast_days: 16,
  };

  // Fetch base (multi-model) forecast
  const basePromise = api('https://api.open-meteo.com/v1/forecast', {
    ...baseParams,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
    hourly: [...LIVE_VARS, 'weather_code', 'wind_gusts_10m', 'precipitation_probability'].join(','),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,weather_code,sunrise,sunset',
  });

  // Fetch individual model forecasts
  const modelPromises = models.map(m => 
    api('https://api.open-meteo.com/v1/forecast', {
      ...baseParams,
      models: m.id,
      hourly: LIVE_VARS.join(','),
    }).catch(() => null) // Individual model failure shouldn't fail entire request
  );

  const [baseResult, ...modelResults] = await Promise.all([basePromise, ...modelPromises]);

  const byId: Record<string, any> = {};
  modelResults.forEach((m, i) => {
    if (m) byId[models[i].id] = m;
  });

  return {
    base: baseResult,
    models: modelResults,
    byId,
    downloadedAt: new Date().toISOString(),
    place: { ...place },
  };
}

/** Fetch pressure level data for air mass analysis */
export async function fetchLevels(place: any, modelIds: string[]): Promise<any> {
  const params = {
    latitude: place.lat,
    longitude: place.lon,
    hourly: LEVEL_VARS.join(','),
    models: modelIds.join(','),
    past_days: 7,
    forecast_days: 7,
    timezone: 'auto',
  };

  const data = await api('https://api.open-meteo.com/v1/forecast', params);
  const hourly = data.hourly || {};
  
  const series: Record<string, any> = {};
  for (const id of modelIds) {
    const cols: Record<string, any> = {};
    for (const v of LEVEL_VARS) {
      cols[v] = hourly[v + '_' + id] || null;
    }
    if (Object.values(cols).some(c => c && c.length)) series[id] = cols;
  }
  
  return {
    time: hourly.time || [],
    series,
    offsetSeconds: data.utc_offset_seconds || 0,
  };
}

/** Fetch river data from GloFAS Flood API */
export async function fetchRiverCell(lat: number, lon: number): Promise<any | null> {
  const params = {
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    daily: 'river_discharge',
    forecast_days: 1,
  };
  
  try {
    const data = await api('https://flood-api.open-meteo.com/v1/flood', params);
    const q = data.daily?.river_discharge || [];
    if (!q.some((v: number) => typeof v === 'number' && isFinite(v) && v > 0)) return null;
    return { lat: data.latitude, lon: data.longitude };
  } catch {
    return null;
  }
}

/** Fetch detailed river series for a known cell */
export async function fetchRiverSeries(cell: { lat: number; lon: number }): Promise<any | null> {
  const params = {
    latitude: cell.lat.toFixed(4),
    longitude: cell.lon.toFixed(4),
    daily: 'river_discharge,river_discharge_median,river_discharge_p25,river_discharge_p75',
    past_days: 365,
    forecast_days: 7,
  };
  
  try {
    const data = await api('https://flood-api.open-meteo.com/v1/flood', params);
    return data;
  } catch {
    return null;
  }
}

/** Fetch NCHMF news */
export async function fetchNchmfNews(): Promise<any> {
  try {
    // This would need a proxy or CORS-enabled endpoint
    // For now, return empty - the actual implementation uses collect-nchmf.mjs
    return { categories: [], collectedAt: null };
  } catch {
    return { categories: [], collectedAt: null, errors: ['fetch_failed'] };
  }
}

/** Batch fetch with concurrency control */
export async function pLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length);
  let next = 0;
  
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch {
        results[i] = null;
      }
    }
  });
  
  await Promise.all(workers);
  return results;
}

/** Update rate limiter interval (called on success/failure) */
export function setApiInterval(ms: number): void {
  rateLimiter.setInterval(ms);
}