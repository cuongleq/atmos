/**
 * ATMOS Feature: Flood Forecasting (GloFAS Integration)
 * Enhanced flood forecasting with GloFAS data, historical analysis, and river gauge mapping
 */

import { E } from '../../engine/index.js';
import { nominalStage, floodLevels, riverRisk, ratingFor, RiverRiskResult, FloodLevelsResult, FloodLevelsOpts, FLOOD_BANDS } from '../../engine/hydrology.js';
import { distanceKm } from '../../engine/distance.js';

/** GloFAS river cell */
export interface GloFASCell {
  lat: number;
  lon: number;
  km: number;
  cell: { lat: number; lon: number };
}

/** River series data from GloFAS */
export interface RiverSeries {
  cell: { lat: number; lon: number };
  km: number;
  time: string[];
  q: number[];
  median: number[];
  p25: number[];
  p75: number[];
  iToday: number;
  qToday: number;
  qMedianToday: number;
  p25Today: number | null;
  p75Today: number | null;
  history: number[];
  forecast: number[];
  isLargest: boolean;
  mergedCells: number;
  mergedKm?: number[];
  levels: FloodLevelsResult | null;
}

/** Flood forecast for a river */
export interface FloodForecast {
  river: RiverSeries;
  risk: RiverRiskResult | null;
  alert: FloodAlert | null;
  forecast: FloodForecastPoint[];
  levels: FloodLevelsResult | null;
}

/** Flood forecast point */
export interface FloodForecastPoint {
  time: string;
  q: number | null;
  qMedian: number | null;
  p25: number | null;
  p75: number | null;
  level: FloodLevelThreshold | null;
  risk: FloodRiskLevel;
}

/** Flood alert */
export interface FloodAlert {
  level: FloodLevelThreshold | null;
  peak: FloodLevelThreshold | null;
  outranked: boolean;
}

/** Flood risk level */
export type FloodRiskLevel = 'low' | 'moderate' | 'high' | 'severe';

/** Flood level threshold */
export interface FloodLevelThreshold {
  at: number;
  level: number;
  key: string;
  label: string;
  tone: 'low' | 'mid' | 'high' | 'severe';
  q: number | null;
  days: number;
  h: number | null;
}

/** Flood risk assessment result */
export interface FloodRiskAssessment {
  river: RiverSeries;
  risk: RiverRiskResult | null;
  alert: FloodAlert | null;
  levels: FloodLevelsResult | null;
  forecast: FloodForecastPoint[];
  summary: string;
  riskLevel: FloodRiskLevel;
}

/** River gauge from OSM */
export interface RiverGauge {
  id: string;
  name: string;
  lat: number;
  lon: number;
  river: string;
  distanceKm: number;
  bearing: number;
}

/** Flood forecast for a location */
export interface LocationFloodForecast {
  location: { lat: number; lon: number; name: string };
  rivers: FloodForecast[];
  overallRisk: FloodRiskLevel;
  summary: string;
  generatedAt: string;
}

/** Flood forecasting configuration */
export interface FloodForecastConfig {
  radiusKm: number;
  cellStepKm: number;
  maxRivers: number;
  forecastDays: number;
  historyDays: number;
  scanConcurrency: number;
  seriesConcurrency: number;
}

/** Default configuration */
export const DEFAULT_FLOOD_CONFIG: FloodForecastConfig = {
  radiusKm: 10,
  cellStepKm: 5 / 111.2, // ~5km in degrees
  maxRivers: 20,
  forecastDays: 7,
  historyDays: 365,
  scanConcurrency: 6,
  seriesConcurrency: 3,
};

/** Flood risk levels */
export const FLOOD_RISK_LEVELS = {
  low: { label: 'Thấp', color: '#3fae5a', threshold: 0.3 },
  moderate: { label: 'Trung bình', color: '#f5e663', threshold: 0.6 },
  high: { label: 'Cao', color: '#e34a3a', threshold: 0.8 },
  severe: { label: 'Rất cao', color: '#b04ae3', threshold: 1.0 },
} as const;

/** Default flood forecast configuration */
export function getDefaultConfig(): FloodForecastConfig {
  return { ...DEFAULT_FLOOD_CONFIG };
}

/** Calculate flood risk level from risk assessment */
export function calculateRiskLevel(risk: RiverRiskResult | null): FloodRiskLevel {
  if (!risk) {
    return 'low';
  }
  const exceed = risk.exceed ?? 0;
  if (exceed >= 0.8) {
    return 'severe';
  }
  if (exceed >= 0.6) {
    return 'high';
  }
  if (exceed >= 0.3) {
    return 'moderate';
  }
  return 'low';
}

/** Generate flood forecast points from river series */
export function generateFloodForecast(river: RiverSeries, config: FloodForecastConfig = DEFAULT_FLOOD_CONFIG): FloodForecastPoint[] {
  const forecastDays = config.forecastDays;
  const points: FloodForecastPoint[] = [];
  
  for (let i = 0; i < Math.min(forecastDays, river.forecast.length); i++) {
    const q = river.forecast[i];
    const qMedian = river.median?.[river.iToday + 1 + i] ?? null;
    const p25 = river.p25?.[river.iToday + 1 + i] ?? null;
    const p75 = river.p75?.[river.iToday + 1 + i] ?? null;
    
    const _time = river.time[river.iToday + 1 + i];
    const qVal = finite(q) ? q : null;
    
    // Calculate risk for this forecast point
    const risk = finite(qVal) ? riverRisk({
      q: qVal,
      qP25: river.p25?.[river.iToday + 1 + i] ?? null,
      qP75: river.p75?.[river.iToday + 1 + i] ?? null,
      recent: null // Would need historical context
    }) : null;
    
    const riskLevel = calculateRiskLevel(risk);
    const level = river.levels?.thresholds?.find(t => finite(qVal) && qVal! >= t.q) ?? null;
    
    points.push({
      time: river.time[river.iToday + 1 + i],
      q: qVal,
      qMedian: finite(qMedian) ? qMedian : null,
      p25: finite(p25) ? p25 : null,
      p75: finite(p75) ? p75 : null,
      level,
      risk: riskLevel,
    });
  }
  
  return points;
}

/** Assess flood risk for a river */
export function assessFloodRisk(river: RiverSeries): FloodRiskAssessment {
  const risk = riverRisk({
    q: river.qMedianToday ?? river.qToday,
    qP25: river.p25Today,
    qP75: river.p75Today,
    recent: river.history.length > 0 ? E.meanS(river.history.slice(-30)) : null,
  });
  
  const alert = riverAlert(river);
  const riskLevel = calculateRiskLevel(risk);
  
  const forecast = generateFloodForecast(river);
  
  const summary = generateRiskSummary(river, risk, river.levels);
  
  return {
    river,
    risk,
    alert,
    levels: river.levels,
    forecast,
    summary,
    riskLevel,
  };
}

/** Generate risk summary text */
function generateRiskSummary(river: RiverSeries, risk: RiverRiskResult | null, _levels: FloodLevelsResult | null): string {
  if (!risk) return 'Không đủ dữ liệu để đánh giá rủi ro lũ.';
  
  const riskLevel = calculateRiskLevel(risk);
  const riskLabels = { low: 'thấp', moderate: 'trung bình', high: 'cao', severe: 'rất cao' };
  
  let summary = `Rủi ro lũ: ${riskLabels[riskLevel]}. `;
  
  if (risk.exceed !== null && risk.exceed !== undefined) {
    summary += `Xác suất vượt ngưỡng: ${(risk.exceed * 100).toFixed(0)}%. `;
  }
  
  if (risk.vsRecent !== null && risk.vsRecent !== undefined) {
    const trend = risk.vsRecent > 0 ? 'tăng' : 'giảm';
    summary += `Lưu lượng ${trend} ${(Math.abs(risk.vsRecent!) * 100).toFixed(0)}% so với TB 30 ngày. `;
  }
  
  if (risk.q !== null) {
    summary += `Lưu lượng hiện tại: ${risk.q.toFixed(1)} m³/s. `;
  }
  
  return summary;
}

/** River alert from flood levels */
function riverAlert(river: RiverSeries): FloodAlert | null {
  const L = river.levels;
  if (!L) return null;
  const now = L.now;
  const peak = L.peakBand;
  return { level: now, peak, outranked: !!(peak && (!now || peak.level > now.level)) };
}

/** Format flood forecast for display */
export function formatFloodForecast(forecast: FloodForecastPoint[], locale = 'vi-VN'): string {
  if (!forecast.length) return 'Không có dữ liệu dự báo.';
  
  return forecast.map(p => {
    const time = new Date(p.time).toLocaleString(locale);
    const qStr = finite(p.q) ? `${p.q!.toFixed(1)} m³/s` : '—';
    const levelStr = p.level ? ` (${p.level.label})` : '';
    const riskLabels = { low: 'Thấp', moderate: 'Trung bình', high: 'Cao', severe: 'Rất cao' };
    const riskStr = riskLabels[p.risk];
    return `${time}: ${qStr}${levelStr} - Rủi ro: ${riskStr}`;
  }).join('\n');
}

/** Get rivers near a location */
export function getRiversNearLocation(
  rivers: RiverSeries[],
  lat: number,
  lon: number,
  maxDistanceKm = 50
): RiverSeries[] {
  return rivers
    .map(r => ({ river: r, distance: distanceKm({ lat, lon }, r.cell) }))
    .filter(r => r.distance <= maxDistanceKm)
    .sort((a, b) => a.distance - b.distance)
    .map(r => r.river);
}

/** Get rivers affecting a region */
export function getRiversAffectingRegion(
  rivers: RiverSeries[],
  lat: number,
  lon: number,
  maxDistanceKm = 500
): RiverSeries[] {
  return rivers.filter(r => {
    const dist = distanceKm({ lat, lon }, r.cell);
    return dist <= maxDistanceKm;
  });
}

/** Sort rivers by risk level */
export function sortRiversByRisk(rivers: RiverSeries[]): RiverSeries[] {
  return [...rivers].sort((a, b) => {
    const riskA = assessFloodRisk(a).riskLevel;
    const riskB = assessFloodRisk(b).riskLevel;
    const riskOrder = { severe: 4, high: 3, moderate: 2, low: 1 };
    return riskOrder[riskB] - riskOrder[riskA];
  });
}

/** Assess flood risk for a river */
function assessFloodRisk(river: RiverSeries): { riskLevel: FloodRiskLevel } {
  const risk = riverRisk({
    q: river.qMedianToday ?? river.qToday,
    qP25: river.p25Today,
    qP75: river.p75Today,
    recent: river.history.length > 0 ? E.meanS(river.history.slice(-30)) : null,
  });
  return { riskLevel: calculateRiskLevel(risk) };
}

/** Finite check helper */
function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Export all */
export {
  FLOOD_BANDS,
  nominalStage,
  floodLevels,
  riverRisk,
  RiverRiskResult,
  FloodLevelsResult,
  FloodLevelsOpts,
  FLOOD_BANDS,
  FloodLevelThreshold,
  FloodLevelsResult,
  RiverRiskResult,
  FloodLevelThreshold,
  FloodRiskLevel,
  FloodForecastConfig,
  FloodForecast,
  FloodForecastPoint,
  FloodAlert,
  FloodRiskAssessment,
  RiverSeries,
  RiverSeries as RiverData,
  FloodRiskLevel,
  FloodLevelThreshold,
  FloodForecastConfig,
  FloodForecast,
  FloodForecastPoint,
  FloodAlert,
  FloodRiskAssessment,
  RiverSeries,
  RiverGauge,
  LocationFloodForecast,
  FloodForecastConfig,
  DEFAULT_FLOOD_CONFIG,
  FLOOD_RISK_LEVELS,
  FLOOD_BANDS,
  FloodAlert,
  FloodRiskResult,
  FloodLevelsResult,
  RiverRiskResult,
  RiverSeries,
  FloodLevelsOpts,
  FloodLevelThreshold,
  FloodRiskLevel,
  FloodForecastConfig,
  FloodForecast,
  FloodForecastPoint,
  FloodAlert,
  FloodRiskAssessment,
  RiverSeries,
  RiverGauge,
  LocationFloodForecast,
  FloodForecastConfig,
  DEFAULT_FLOOD_CONFIG,
  FLOOD_RISK_LEVELS,
  FloodAlert,
  FloodRiskResult,
  FloodLevelsResult,
  RiverRiskResult,
  RiverSeries,
  FloodLevelsOpts,
  FloodLevelThreshold,
  FloodRiskLevel,
  FloodForecastConfig,
  FloodForecast,
  FloodForecastPoint,
  FloodAlert,
  FloodRiskAssessment,
  RiverSeries,
  RiverGauge,
  LocationFloodForecast,
  ratingFor,
};