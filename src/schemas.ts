/**
 * Zod schemas for Open-Meteo API responses.
 * Used for runtime validation in the browser and Node data pipeline.
 */
import { z } from 'zod';

/** Base coordinate and timezone info. */
export const GeoSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  generationtime_ms: z.number().optional(),
  utc_offset_seconds: z.number(),
  timezone: z.string(),
  timezone_abbreviation: z.string(),
  elevation: z.number().optional(),
});

/** Current weather conditions. */
export const CurrentWeatherSchema = z.object({
  temperature_2m: z.number().nullable().optional(),
  relative_humidity_2m: z.number().nullable().optional(),
  apparent_temperature: z.number().nullable().optional(),
  weather_code: z.number().nullable().optional(),
  wind_speed_10m: z.number().nullable().optional(),
  wind_direction_10m: z.number().nullable().optional(),
  wind_gusts_10m: z.number().nullable().optional(),
  precipitation: z.number().nullable().optional(),
  pressure_msl: z.number().nullable().optional(),
  surface_pressure: z.number().nullable().optional(),
  cloud_cover: z.number().nullable().optional(),
  shortwave_radiation: z.number().nullable().optional(),
  et0_fao_evapotranspiration: z.number().nullable().optional(),
  time: z.string(),
  interval: z.number().optional(),
});

/** Hourly forecast data. */
export const HourlySchema = z.object({
  time: z.array(z.string()),
  temperature_2m: z.array(z.number().nullable()).optional(),
  relative_humidity_2m: z.array(z.number().nullable()).optional(),
  apparent_temperature: z.array(z.number().nullable()).optional(),
  weather_code: z.array(z.number().nullable()).optional(),
  wind_speed_10m: z.array(z.number().nullable()).optional(),
  wind_direction_10m: z.array(z.number().nullable()).optional(),
  wind_gusts_10m: z.array(z.number().nullable()).optional(),
  precipitation: z.array(z.number().nullable()).optional(),
  rain: z.array(z.number().nullable()).optional(),
  snowfall: z.array(z.number().nullable()).optional(),
  pressure_msl: z.array(z.number().nullable()).optional(),
  surface_pressure: z.array(z.number().nullable()).optional(),
  cloud_cover: z.array(z.number().nullable()).optional(),
  shortwave_radiation: z.array(z.number().nullable()).optional(),
  et0_fao_evapotranspiration: z.array(z.number().nullable()).optional(),
  precipitation_probability: z.array(z.number().nullable()).optional(),
  // Model-specific fields (suffixed with _modelName) - use catchall
}).catchall(z.union([
  z.array(z.number().nullable()),
  z.array(z.string()),
  z.undefined(),
]));

/** Daily forecast data. */
export const DailySchema = z.object({
  time: z.array(z.string()),
  temperature_2m_max: z.array(z.number().nullable()).optional(),
  temperature_2m_min: z.array(z.number().nullable()).optional(),
  precipitation_sum: z.array(z.number().nullable()).optional(),
  precipitation_probability_max: z.array(z.number().nullable()).optional(),
  wind_gusts_10m_max: z.array(z.number().nullable()).optional(),
  weather_code: z.array(z.number().nullable()).optional(),
  sunrise: z.array(z.string()).optional(),
  sunset: z.array(z.string()).optional(),
}).passthrough();

/** Full forecast response from Open-Meteo. */
export const ForecastResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  generationtime_ms: z.number(),
  utc_offset_seconds: z.number(),
  timezone: z.string(),
  timezone_abbreviation: z.string(),
  elevation: z.number(),
  current: CurrentWeatherSchema.optional(),
  current_weather: CurrentWeatherSchema.optional(), // legacy field name
  hourly: HourlySchema.optional(),
  daily: DailySchema.optional(),
  // Model-specific responses may have different structure
  models: z.array(z.string()).optional(),
}).passthrough();

/** Previous-runs API response (deterministic models with lead times). */
export const PreviousRunsResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  generationtime_ms: z.number(),
  utc_offset_seconds: z.number(),
  timezone: z.string(),
  timezone_abbreviation: z.string(),
  elevation: z.number(),
  hourly: z.object({
    time: z.array(z.string()),
    // Fields are like: temperature_2m_previous_day1, temperature_2m_previous_day2, etc.
  }).catchall(z.union([
    z.array(z.number().nullable()),
    z.array(z.string()),
  ])),
});

/** Archive API response (ERA5 reanalysis). */
export const ArchiveResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  generationtime_ms: z.number(),
  utc_offset_seconds: z.number(),
  timezone: z.string(),
  timezone_abbreviation: z.string(),
  elevation: z.number(),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number().nullable()),
    relative_humidity_2m: z.array(z.number().nullable()),
    apparent_temperature: z.array(z.number().nullable()),
    weather_code: z.array(z.number().nullable()),
    wind_speed_10m: z.array(z.number().nullable()),
    wind_direction_10m: z.array(z.number().nullable()),
    wind_gusts_10m: z.array(z.number().nullable()),
    precipitation: z.array(z.number().nullable()),
    rain: z.array(z.number().nullable()),
    snowfall: z.array(z.number().nullable()),
    pressure_msl: z.array(z.number().nullable()),
    surface_pressure: z.array(z.number().nullable()),
    cloud_cover: z.array(z.number().nullable()),
    shortwave_radiation: z.array(z.number().nullable()),
    et0_fao_evapotranspiration: z.array(z.number().nullable()),
  }),
});

/** Error response from Open-Meteo. */
export const ErrorResponseSchema = z.object({
  error: z.boolean(),
  reason: z.string(),
});

/** Type inference helpers. */
export type ForecastResponse = z.infer<typeof ForecastResponseSchema>;
export type PreviousRunsResponse = z.infer<typeof PreviousRunsResponseSchema>;
export type ArchiveResponse = z.infer<typeof ArchiveResponseSchema>;
export type HourlyData = z.infer<typeof HourlySchema>;
export type DailyData = z.infer<typeof DailySchema>;
export type CurrentWeather = z.infer<typeof CurrentWeatherSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Validate and parse Open-Meteo forecast response.
 * Throws ZodError if validation fails.
 */
export function parseForecastResponse(data: unknown): ForecastResponse {
  return ForecastResponseSchema.parse(data);
}

/**
 * Validate and parse Open-Meteo previous-runs response.
 * Throws ZodError if validation fails.
 */
export function parsePreviousRunsResponse(data: unknown): PreviousRunsResponse {
  return PreviousRunsResponseSchema.parse(data);
}

/**
 * Validate and parse Open-Meteo archive (ERA5) response.
 * Throws ZodError if validation fails.
 */
export function parseArchiveResponse(data: unknown): ArchiveResponse {
  return ArchiveResponseSchema.parse(data);
}

/**
 * Check if response is an error response.
 */
export function isErrorResponse(data: unknown): data is ErrorResponse {
  return ErrorResponseSchema.safeParse(data).success;
}

/**
 * Safe parse with detailed error info.
 */
export function safeParseForecastResponse(data: unknown) {
  return ForecastResponseSchema.safeParse(data);
}