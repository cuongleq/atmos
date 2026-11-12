/**
 * ATMOS Forecast Engine - Main Entry Point
 * 
 * Modular TypeScript implementation of the EMOS calibration engine.
 * Runs identically in Node (offline backtest) and browser (live application).
 */

// Core numeric utilities
export * from './numeric.js';

// Transforms and distribution
export * from './transforms.js';

// Linear algebra
export * from './linear-algebra.js';

// Variables registry
export * from './variables.js';

// Scoring
export * from './scores.js';

// Predictors
export * from './predictors.js';

// Model selection
export * from './model-selection.js';
export * from './direction-model-selection.js';

// Evaluations
export * from './scalar-evaluation.js';
export * from './direction-evaluation.js';
export * from './code-evaluation.js';
export * from './evaluation-entry.js';

// Calibration
export * from './calibration.js';
export * from './live-calibration.js';

// Regime classification
export * from './regime.js';

// Air mass & trajectory
export * from './airmass.js';

// Hydrology
export * from './hydrology.js';

// Lightning
export * from './lightning.js';

// Logistic & isotonic calibration
export * from './logistic.js';
export * from './isotonic.js';

// Wind utilities
export * from './wind.js';

// Distance
export * from './distance.js';

// Daily accumulation
export * from './daily-accumulation.js';

// Re-export types for convenience
export type {
  Spec,
  LinearModel,
  Moments,
  Fold,
  Sigma2,
  PointScores,
  EventScores,
  ProbScores,
  ProbEnsembleScores,
  BootstrapResult,
  Candidate,
  SelectionResult,
  VariableSpec,
  DetModelId,
  LiveEnsModelId,
  TransformKind,
  PseudoMembersOptions,
  CalibrationBundle,
  LogisticCalibration,
  IsotonicCalibration,
  AirMassOpts,
  AirMassResult,
  FrontalResult,
  AirMassGridResult,
  RiverRiskOpts,
  RiverRiskResult,
  FloodLevelsOpts,
  FloodLevelsResult,
  LightningIndexOpts,
  LightningIndexResult,
  LightningVerifyOpts,
  LightningVerifyResult,
  LightningBands,
  WindBarb,
  TrajectoryOpts,
  NearestOnTrackResult,
} from './predictors.js';
export type { LinearModel as LinearModelType } from './linear-algebra.js';

/** Version of the engine. */
export const ENGINE_VERSION = '1.0.0';

/** Default configuration constants. */
export const ENGINE_CONFIG = {
  K_MEMBERS: 51,
  HARMONIC: 4,
  LAMBDA_GRID: [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3, 1, 3] as const,
  CV_FOLDS: 8,
  REGIME_EDGES: [
    [20, 50, 80, 95],
    [0.05, 0.5, 2, 5, 10],
    [5, 12, 20, 32],
    [10, 20, 26, 32],
    [45, 65, 80, 92],
  ] as const,
  REGIME_MIN_SUPPORT: 12,
  CAPE_REF: 2500,
  LI_LO: -6,
  LI_HI: 4,
  CIN_MAX: 200,
  FLOOD_BANDS: [
    { at: 0.90, level: 0, key: 'canh_bao', label: 'Cảnh báo', tone: 'low' },
    { at: 0.95, level: 1, key: 'bd1', label: 'Báo động 1', tone: 'mid' },
    { at: 0.98, level: 2, key: 'bd2', label: 'Báo động 2', tone: 'high' },
    { at: 0.995, level: 3, key: 'bd3', label: 'Báo động 3', tone: 'severe' },
  ] as const,
  LIGHTNING_LEVELS: [
    { id: 'low', name: 'Thấp', note: 'dưới trung vị của 12 tháng tại địa điểm này' },
    { id: 'p50', name: 'Trung bình', note: 'từ trung vị trở lên' },
    { id: 'p80', name: 'Khá', note: 'vượt 80% số giờ trong 12 tháng' },
    { id: 'p95', name: 'Cao', note: 'vượt 95% số giờ trong 12 tháng' },
    { id: 'p99', name: 'Rất cao', note: 'vượt 99% số giờ trong 12 tháng' },
  ] as const,
} as const;