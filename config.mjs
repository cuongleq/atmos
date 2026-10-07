// Shared configuration for the ATMOS data pipeline.
// Dependency-free so collect.mjs, bench.mjs and test.mjs can all import it.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const RAW = path.join(ROOT, 'raw');
export const DIST = path.join(ROOT, 'dist');

// Eight Vietnamese locations chosen for climatic spread:
// southern delta, northern delta, central coast, highland,
// Mekong delta, south-central coast, post-merger Dak Lak highland and
// Song Cau ward on the south-central coast. utcOffset 7 puts the diurnal
// harmonics in local solar time, which is where the daily bias cycle lives.
export const LOCATIONS = [
  { id: 'hcm', name: 'TP. Hồ Chí Minh', lat: 10.8231, lon: 106.6297, utcOffset: 7 },
  { id: 'hanoi', name: 'Hà Nội', lat: 21.0285, lon: 105.8542, utcOffset: 7 },
  { id: 'daklak', name: 'Đắk Lắk', lat: 12.6675, lon: 108.0378, utcOffset: 7 },
  { id: 'songcau', name: 'P. Sông Cầu', lat: 13.4556, lon: 109.2235, utcOffset: 7 },
  { id: 'danang', name: 'Đà Nẵng', lat: 16.0544, lon: 108.2022, utcOffset: 7 },
  { id: 'dalat', name: 'Đà Lạt', lat: 11.9469, lon: 108.4583, utcOffset: 7 },
  { id: 'cantho', name: 'Cần Thơ', lat: 10.0452, lon: 105.7469, utcOffset: 7 },
  { id: 'nhatrang', name: 'Nha Trang', lat: 12.2395, lon: 109.196, utcOffset: 7 },
];

// Deterministic systems on the Previous-Runs API. Per-variable coverage is not
// uniform (for example ECMWF publishes no 10 m gusts and Meteo-France no wind
// speed), so the engine keeps only the models that are complete on the fitting
// window instead of imputing the gaps.
export const DET_MODELS = [
  { id: 'gfs_global', name: 'NOAA GFS' },
  { id: 'ecmwf_ifs025', name: 'ECMWF IFS 0,25°' },
  { id: 'icon_global', name: 'DWD ICON' },
  { id: 'jma_seamless', name: 'JMA GSM' },
  { id: 'gem_seamless', name: 'ECCC GEM' },
  { id: 'meteofrance_seamless', name: 'Météo-France' },
  { id: 'ukmo_seamless', name: 'UK Met Office' },
];

// Native ensemble systems. These are available from the live ensemble API but
// NOT from the previous-run archive, so they cannot be backtested. The app
// therefore uses deterministic model disagreement as its spread predictor and
// labels live ensemble spread as an unverified diagnostic.
export const LIVE_ENS_MODELS = [
  { id: 'ecmwf_ifs025_ensemble', name: 'ECMWF ENS' },
  { id: 'ncep_gefs_seamless', name: 'NOAA GEFS' },
];

// Sixteen variables that every model and the ERA5 reference can be aligned on.
export const VARIABLES = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation',
  'rain',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'surface_pressure',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'shortwave_radiation',
  'et0_fao_evapotranspiration',
];

// Previous-Day offsets the archive actually serves: 24 / 48 / 72 / 120 / 168 h.
export const LEADS = [1, 2, 3, 5, 7];

// One full year so the fit sees every season rather than a single wet-season
// window. Earlier start dates only carry temperature_2m for most systems.
export const PERIOD = { start: '2024-12-01', end: '2025-11-30' };

// Frozen chronological split with a seven-day purge gap between fit and score.
export const SPLIT = { trainEnd: '2025-10-14', testStart: '2025-10-22', purgeDays: 7 };

export const API = {
  previous: 'https://previous-runs-api.open-meteo.com/v1/forecast',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
};

export const leadHours = days => days * 24;
export const leadLabel = days => days * 24 + ' giờ';
