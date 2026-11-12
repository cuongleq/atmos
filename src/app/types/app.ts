/**
 * ATMOS App - Type Definitions
 * Centralized types for the modular app
 */

import { CalibrationBundle } from '../../engine/calibration.js';
import { VariableSpec } from '../../engine/variables.js';

/** Report structure from benchmark.json */
export interface BenchmarkReport {
  createdAt: string;
  reference: string;
  period: { start: string; end: string };
  split: { trainEnd: string; testStart: string; purgeDays: number };
  method: string;
  ensembleMethod: string;
  models: Array<{ id: string; name: string }>;
  leads: number[];
  variables: Record<string, VariableSpec>;
  headline: {
    evaluated: number;
    unscoredVariables: string[];
    meanSkillVsEqualWeight: number;
    meanSkillVsBestSingle: number;
    betterThanEqualWeight: number;
    significantImprovementVsEqualWeight: number;
    betterThanBestSingle: number;
    significantImprovementVsBestSingle: number;
    familyChosen: Record<string, number>;
  };
  pooled: Record<string, Record<number, PooledCalibration>>;
  locations: LocationReport[];
  pinnedPlaces: PinnedPlace[];
  errors: string[];
}

export interface LocationReport {
  id: string;
  name: string;
  lat: number;
  lon: number;
  utcOffset: number;
  referenceGrid: { lat: number; lon: number };
  tests: TestResult[];
}

export interface TestResult {
  variable: string;
  lead: number;
  unit: string;
  kind: string;
  group: string;
  label: string;
  short: string;
  digits: number;
  models: string[];
  modelIds: string[];
  coverage: Record<string, number>;
  trainingN: number;
  testN: number;
  coverageTest: number | null;
  purgeDays: number;
  usable: boolean;
  note?: string;
  selected: { family: string; lambda: number };
  calibration: CalibrationBundle | null;
  mean: PointScores;
  equalMean: PointScores;
  bestSingle?: { model: string; test: PointScores };
  bootstrap?: BootstrapResult;
  regime?: RegimeTable;
}

export interface PointScores {
  rmse: number;
  bias: number;
  mae: number;
  n: number;
}

export interface BootstrapResult {
  vsEqualMean: { probImprovement: number; ci: [number, number] };
  vsBestSingle: { probImprovement: number; ci: [number, number] };
}

export interface RegimeTable {
  edges: number[][];
  table: Array<{ tag: string; n: number; mean: number; spread: number }>;
}

export interface PooledCalibration {
  family: string;
  models: string[];
  calibration: CalibrationBundle;
  testN: number;
  trainingN: number;
  mean: PointScores;
  equalMean: PointScores;
  note: string;
}

export interface PinnedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  utcOffset: number;
}

/** Live forecast data from Open-Meteo */
export interface LiveForecast {
  base: any;
  models: (any | null)[];
  byId: Record<string, any>;
  downloadedAt: string;
  place: Place;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  utcOffset?: number;
}

/** Calibration lookup result */
export interface CalibrationResult {
  calib: CalibrationBundle | RegimeCalibration | null;
  source: string;
  distanceKm: number | null;
  pooled: boolean;
  note: string | null;
}

export interface RegimeCalibration {
  regime: RegimeTable;
}

/** Chart data point */
export interface ChartPoint {
  time: string;
  mean: number | null;
  median: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  low: number | null;
  high: number | null;
  sd: number | null;
  spread: number | null;
  nModels: number;
  uncalibrated: boolean;
}

/** River data from GloFAS */
export interface RiverData {
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
  levels: FloodLevels | null;
}

export interface FloodLevels {
  now: FloodLevel | null;
  peakBand: FloodLevel | null;
  thresholds: FloodThreshold[];
}

export interface FloodLevel {
  level: number;
  label: string;
  tone: 'low' | 'mid' | 'high' | 'severe';
}

export interface FloodThreshold {
  q: number;
  level: number;
  label: string;
  tone: 'low' | 'mid' | 'high' | 'severe';
}

export interface RiverRisk {
  q: number | null;
  qP25: number | null;
  qP75: number | null;
  recent: number | null;
  vsRecent: number | null;
  level: FloodLevel | null;
}

/** Air mass data */
export interface AirMassResult {
  tag: string;
  tone: 'cold' | 'warm' | 'cool' | 'mild' | 'neutral';
  advection: string | null;
  moisture: string | null;
}

/** NCHMF news item */
export interface NchmfItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  category: string;
  severity: string;
  summary: string;
}

/** International news item */
export interface IntlNewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  category: string;
  summary: string;
  translatedTitle?: string;
  translatedSummary?: string;
}

/** App state */
export interface AppState {
  place: Place;
  live: LiveForecast | null;
  report: BenchmarkReport | null;
  levels: any | null;
  rivers: RiverData[] | null;
  riverSel: number;
  requestId: number;
  calCache: Map<string, ChartPoint[]>;
  selectedDay: string | null;
}

/** UI Event handlers */
export type RenderFn = () => void;
export type AsyncRenderFn = () => Promise<void>;