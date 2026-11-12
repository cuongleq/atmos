/**
 * Variable registry: metadata for each forecast variable.
 * Defines transform kind, physical units, cross-predictors, etc.
 */

import { TransformKind } from './transforms.js';

export interface VariableSpec {
  label: string;
  short: string;
  unit: string;
  kind: TransformKind;
  digits: number;
  group: string;
  cross?: string[];
  accum?: boolean;
  thresholds?: number[];
}

export const VARIABLES: Record<string, VariableSpec> = {
  temperature_2m: { label: 'Nhiệt độ 2 m', short: 'Nhiệt độ', unit: '°C', kind: 'gauss', digits: 1, group: 'nhiệt', cross: ['cloud_cover', 'relative_humidity_2m'] },
  apparent_temperature: { label: 'Nhiệt độ cảm giác', short: 'Cảm giác', unit: '°C', kind: 'gauss', digits: 1, group: 'nhiệt', cross: ['wind_speed_10m'] },
  dew_point_2m: { label: 'Nhiệt độ điểm sương', short: 'Điểm sương', unit: '°C', kind: 'gauss', digits: 1, group: 'nhiệt', cross: ['relative_humidity_2m'] },
  relative_humidity_2m: { label: 'Độ ẩm tương đối', short: 'Độ ẩm', unit: '%', kind: 'logit', digits: 0, group: 'ẩm', cross: ['cloud_cover'] },
  cloud_cover: { label: 'Độ phủ mây', short: 'Phủ mây', unit: '%', kind: 'logit', digits: 0, group: 'ẩm', cross: ['precipitation'] },
  precipitation: { label: 'Lượng mưa', short: 'Mưa', unit: 'mm', kind: 'log1p', digits: 1, group: 'mưa', accum: true, thresholds: [0.1, 1, 2, 5, 10, 20] },
  rain: { label: 'Mưa dạng lỏng', short: 'Mưa lỏng', unit: 'mm', kind: 'log1p', digits: 1, group: 'mưa', accum: true, thresholds: [0.1, 1, 5, 10] },
  snowfall: { label: 'Tuyết rơi', short: 'Tuyết', unit: 'cm', kind: 'log1p', digits: 2, group: 'mưa', accum: true, thresholds: [0.1, 1, 5] },
  wind_speed_10m: { label: 'Tốc độ gió 10 m', short: 'Gió', unit: 'km/h', kind: 'log1p', digits: 1, group: 'gió', thresholds: [10, 20, 30, 40] },
  wind_gusts_10m: { label: 'Gió giật 10 m', short: 'Gió giật', unit: 'km/h', kind: 'log1p', digits: 1, group: 'gió', thresholds: [20, 30, 40, 50, 60] },
  wind_direction_10m: { label: 'Hướng gió 10 m', short: 'Hướng gió', unit: '°', kind: 'direction', digits: 0, group: 'gió' },
  surface_pressure: { label: 'Áp suất mặt đất', short: 'Áp mặt đất', unit: 'hPa', kind: 'gauss', digits: 1, group: 'áp' },
  pressure_msl: { label: 'Áp suất mực biển', short: 'Áp mực biển', unit: 'hPa', kind: 'gauss', digits: 1, group: 'áp' },
  shortwave_radiation: { label: 'Bức xạ mặt trời', short: 'Bức xạ', unit: 'W/m²', kind: 'log1p', digits: 0, group: 'năng lượng' },
  et0_fao_evapotranspiration: { label: 'Bốc hơi FAO-56', short: 'Bốc hơi', unit: 'mm', kind: 'log1p', digits: 2, group: 'năng lượng', accum: true, thresholds: [1, 3, 5] },
  weather_code: { label: 'Mã thời tiết WMO', short: 'Thời tiết', unit: '', kind: 'code', digits: 0, group: 'mã' },
};

/** All variable IDs in order. */
export const VARIABLE_IDS = Object.keys(VARIABLES) as Array<keyof typeof VARIABLES>;

/** Default leads in days. */
export const LEADS = [1, 2, 3, 5, 7];

/** Deterministic model identifiers. */
export const DET_MODEL_IDS = [
  'gfs_global', 'ecmwf_ifs025', 'icon_global', 'jma_seamless',
  'gem_seamless', 'meteofrance_seamless', 'ukmo_seamless',
] as const;

export type DetModelId = typeof DET_MODEL_IDS[number];

/** Deterministic model display names. */
export const DET_MODEL_NAMES: Record<DetModelId, string> = {
  gfs_global: 'NOAA GFS',
  ecmwf_ifs025: 'ECMWF IFS 0,25°',
  icon_global: 'DWD ICON',
  jma_seamless: 'JMA GSM',
  gem_seamless: 'ECCC GEM',
  meteofrance_seamless: 'Météo-France',
  ukmo_seamless: 'UK Met Office',
};

/** Live ensemble model identifiers (not backtestable). */
export const LIVE_ENS_MODEL_IDS = [
  'ecmwf_ifs025_ensemble', 'ncep_gefs_seamless',
] as const;

export type LiveEnsModelId = typeof LIVE_ENS_MODEL_IDS[number];

export const LIVE_ENS_MODEL_NAMES: Record<LiveEnsModelId, string> = {
  ecmwf_ifs025_ensemble: 'ECMWF ENS',
  ncep_gefs_seamless: 'NOAA GEFS',
};