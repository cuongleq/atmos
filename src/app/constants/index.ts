/**
 * ATMOS App - Constants
 * Centralized constants to avoid magic numbers
 */

import { Place } from '../types/app.js';

/** Default place (Ho Chi Minh City) */
export const DEFAULT_PLACE: Place = {
  id: 'hcm',
  name: 'TP. Hồ Chí Minh',
  lat: 10.8231,
  lon: 106.6297,
  utcOffset: 7,
};

/** Live variables to fetch from Open-Meteo */
export const LIVE_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation',
  'rain',
  'snowfall',
  'cloud_cover',
  'surface_pressure',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'shortwave_radiation',
  'et0_fao_evapotranspiration',
];

/** Pressure level variables for air mass analysis */
export const LEVEL_VARS = [
  'temperature_850hPa',
  'geopotential_height_850hPa',
  'geopotential_height_500hPa',
  'wind_speed_850hPa',
  'wind_direction_850hPa',
  'relative_humidity_850hPa',
];

/** Chart horizon options (hours) */
export const CHART_HORIZONS = [48, 96, 168];

/** River scanning constants */
export const RIVER_RADIUS_KM = 10;
export const RIVER_DEG = RIVER_RADIUS_KM / 111.2;
export const RIVER_STEP = 5 / 111.2; // 5km grid step in degrees

/** River chart display days */
export const RIVER_CHART_DAYS = 120;

/** Request concurrency limits */
export const FETCH_CONCURRENCY = {
  models: 7,
  levels: 7,
  riverScan: 6,
  riverSeries: 3,
};

/** Retry configuration */
export const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
};

/** Compass bearings (Vietnamese) */
export const BEARINGS = [
  'B', 'BBL', 'ĐB', 'Đ', 'ĐN', 'N', 'NTN', 'TN',
  'TTN', 'T', 'TTB', 'TB', 'BTB', 'BT', 'BTN', 'BNB', 'B',
];

export const COMPASS8 = ['Bắc', 'Đông bắc', 'Đông', 'Đông nam', 'Nam', 'Nam tây nam', 'Tây', 'Tây bắc'];

/** Level colors for flood thresholds */
export const LEVEL_COLOR = {
  low: '#3fae5a',     // Cảnh báo - green
  mid: '#f5e663',     // Báo động 1 - yellow
  high: '#e34a3a',    // Báo động 2 - red
  severe: '#b04ae3',  // Báo động 3 - purple
};

/** Weather code groups */
export const WEATHER_FAMILY_ICON = {
  0: '☀',  // Clear
  1: '⛅',  // Partly cloudy
  2: '🌫',  // Fog
  3: '🌦',  // Light rain
  4: '🌧',  // Rain
  5: '❄',  // Snow
  6: '🌦',  // Freezing rain
  7: '❄',  // Ice pellets
  8: '⛈',  // Thunderstorm
} as const;

/** Flood rating keys */
export const FLOOD_BANDS = [
  { at: 0.90, level: 0, key: 'canh_bao', label: 'Cảnh báo', tone: 'low' as const },
  { at: 0.95, level: 1, key: 'bd1', label: 'Báo động 1', tone: 'mid' as const },
  { at: 0.98, level: 2, key: 'bd2', label: 'Báo động 2', tone: 'high' as const },
  { at: 0.995, level: 3, key: 'bd3', label: 'Báo động 3', tone: 'severe' as const },
];

/** Month names (Vietnamese) */
export const MONTH_NAMES = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

/** Day names (Vietnamese short) */
export const DAY_NAMES_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** Storage keys */
export const STORAGE_KEYS = {
  lastPlace: 'atmos-last-place',
  chartVariable: 'atmos-chart-variable',
  chartHorizon: 'atmos-chart-horizon',
  showBands: 'atmos-show-bands',
  theme: 'atmos-theme',
} as const;

/** CSS class names */
export const CSS_CLASSES = {
  notice: 'notice',
  noticeError: 'notice error',
  noticeWarning: 'notice warning',
  noticeInfo: 'notice info',
  selected: 'selected',
  hidden: 'hidden',
  muted: 'muted',
  small: 'small',
} as const;