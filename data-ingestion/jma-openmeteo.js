/**
 * JMA GSM Data Ingestion from Open-Meteo API
 * Free tier: open-meteo.com, no API key needed
 */

import fetch from 'node-fetch';
import { VN_BBOX } from './ncep-gfs-s3.js';

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

// JMA GSM model identifier on Open-Meteo
const JMA_MODEL = 'jma_gsm';

// Variables available from JMA on Open-Meteo
export const JMA_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation',
  'rain',
  'snowfall',
  'weather_code',
  'pressure_msl',
  'surface_pressure',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'shortwave_radiation',
  'et0_fao_evapotranspiration',
  // Pressure level variables (if available)
  'temperature_850hPa',
  'geopotential_height_850hPa',
  'geopotential_height_500hPa',
  'wind_speed_850hPa',
  'wind_direction_850hPa',
  'relative_humidity_850hPa',
];

/**
 * Fetch JMA GSM forecast from Open-Meteo
 */
export async function fetchJmaForecast(options = {}) {
  const {
    latitude = 16.0,      // Default: Da Nang (central VN)
    longitude = 108.0,
    forecastDays = 10,    // JMA GSM: 10 days on Open-Meteo
    timezone = 'Asia/Ho_Chi_Minh',
    models = JMA_MODEL,
    variables = JMA_VARS,
  } = options;

  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    hourly: variables.join(','),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,weather_code',
    forecast_days: forecastDays.toString(),
    timezone,
    models,
    past_days: 0,
  });

  const url = `${OPEN_METEO_BASE}?${params.toString()}`;
  
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Open-Meteo API error: ${error.reason || response.statusText}`);
    }

    const data = await response.json();
    return transformJmaResponse(data, { latitude, longitude });
  } catch (error) {
    console.error(`Open-Meteo JMA fetch failed:`, error.message);
    throw error;
  }
}

/**
 * Fetch JMA historical data (for calibration)
 */
export async function fetchJmaHistorical(options = {}) {
  const {
    latitude = 16.0,
    longitude = 108.0,
    startDate = '2024-01-01',
    endDate = new Date().toISOString().slice(0, 10),
    timezone = 'Asia/Ho_Chi_Minh',
    variables = JMA_VARS,
  } = options;

  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    hourly: variables.join(','),
    start_date: startDate,
    end_date: endDate,
    timezone,
    models: JMA_MODEL,
  });

  const url = `${OPEN_METEO_ARCHIVE}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Open-Meteo Archive API error: ${error.reason || response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Open-Meteo Archive JMA fetch failed:`, error.message);
    throw error;
  }
}

/**
 * Fetch JMA for multiple VN locations (batch)
 */
export async function fetchJmaBatch(locations, options = {}) {
  const results = {};
  
  for (const loc of locations) {
    try {
      results[loc.id] = await fetchJmaForecast({
        ...options,
        latitude: loc.lat,
        longitude: loc.lon,
      });
      // Rate limiting: 1 req/second to be polite
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      console.error(`Failed to fetch JMA for ${loc.name}:`, error.message);
      results[loc.id] = { error: error.message };
    }
  }
  
  return results;
}

export async function fetchJmaHistoricalBatch(locations, options = {}) {
  const results = {};
  
  for (const loc of locations) {
    try {
      const raw = await fetchJmaHistorical({
        ...options,
        latitude: loc.lat,
        longitude: loc.lon,
      });
      // Transform to match forecast format
      results[loc.id] = transformJmaResponse(raw, { latitude: loc.lat, longitude: loc.lon });
      // Rate limiting: 1 req/second to avoid "Too many concurrent requests"
      await new Promise(r => setTimeout(r, 1500));
    } catch (error) {
      console.error(`Failed to fetch JMA historical for ${loc.name}:`, error.message);
      results[loc.id] = { error: error.message };
    }
  }
  
  return results;
}

/**
 * Transform Open-Meteo response to standardized format
 */
function transformJmaResponse(data, coords) {
  console.log('[DEBUG] transformJmaResponse called, data keys:', Object.keys(data));
  
  // Handle both forecast API and archive API response structures
  const hourly = data.hourly;
  const hourlyUnits = data.hourly_units;
  
  if (!hourly) return null;

  const latitude = data.latitude ?? coords?.latitude;
  const longitude = data.longitude ?? coords?.longitude;
  const elevation = data.elevation ?? 0;
  const timezone = data.timezone ?? 'Asia/Ho_Chi_Minh';
  const timezoneAbbreviation = data.timezone_abbreviation ?? 'GMT+7';
  const utcOffsetSeconds = data.utc_offset_seconds ?? 25200;

  console.log('[DEBUG] timezoneAbbreviation:', timezoneAbbreviation);

  return {
    meta: {
      source: 'JMA GSM (Open-Meteo)',
      model: 'jma_gsm',
      coordinates: { latitude, longitude },
      elevation,
      timezone,
      timezone_abbreviation: timezoneAbbreviation,
      utc_offset_seconds: utcOffsetSeconds,
      fetchedAt: new Date().toISOString(),
    },
    hourly: {
      time: hourly.time,
      units: data.hourly_units,
      data: hourly,
    },
    daily: data.daily || null,
    daily_units: data.daily_units || null,
  };
}

/**
 * Fetch for all 8 VN calibration locations
 */
export const VN_CALIBRATION_LOCATIONS = [
  { id: 'hcm', name: 'TP. Hồ Chí Minh', lat: 10.8231, lon: 106.6297 },
  { id: 'hanoi', name: 'Hà Nội', lat: 21.0285, lon: 105.8542 },
  { id: 'danang', name: 'Đà Nẵng', lat: 16.0544, lon: 108.2022 },
  { id: 'dalat', name: 'Đà Lạt', lat: 11.9469, lon: 108.4583 },
  { id: 'cantho', name: 'Cần Thơ', lat: 10.0452, lon: 105.7469 },
  { id: 'nhatrang', name: 'Nha Trang', lat: 12.2395, lon: 109.1960 },
  { id: 'daklak', name: 'Đắk Lắk', lat: 12.6675, lon: 108.0378 },
  { id: 'songcau', name: 'P. Sông Cầu', lat: 13.4556, lon: 109.2235 },
];

export async function fetchJmaAllCalibrationLocations(options = {}) {
  return fetchJmaBatch(VN_CALIBRATION_LOCATIONS, options);
}

/**
 * Save JMA data to files (for calibration pipeline)
 */
export async function saveJmaData(data, outputDir, prefix = 'jma') {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  
  await fs.mkdir(outputDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${prefix}_${timestamp}.json`;
  const filepath = path.join(outputDir, filename);
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return filepath;
}

export default {
  fetchJmaForecast,
  fetchJmaHistorical,
  fetchJmaBatch,
  fetchJmaAllCalibrationLocations,
  saveJmaData,
  VN_CALIBRATION_LOCATIONS,
  JMA_VARS,
  VN_BBOX,
};