/**
 * Calibration bundle serialization for browser application.
 */

import { round } from './numeric.js';
import { LinearModel } from './linear-algebra.js';
import { Spec } from './predictors.js';
import { Sigma2 } from './linear-algebra.js';
import { TransformKind } from './transforms.js';

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface CalibrationBundle {
  family: string;
  kind: TransformKind;
  intercept?: number;
  beta?: number[];
  centre?: number[];
  scale?: number[];
  modelIds: string[];
  crossVars: string[];
  crossMean?: number[];
  sigma2: Sigma2 & { template?: number[]; mult?: number };
  labels: string[];
  singleModel?: string;
  components?: number;
  u?: CalibrationBundle;
  v?: CalibrationBundle;
}

/** Serializable calibration the browser applies to a live forecast. */
export function calibrationBundle(
  sel: { model: any; winner: any; family: string },
  spec: Spec,
  usable: string[],
  crossVars: string[],
  crossFill: number[],
  sg: Sigma2 & { template?: number[]; mult?: number },
  kind: TransformKind
): CalibrationBundle {
  const labels = ['mean', 'spread', ...usable, ...crossVars, 'sinHour', 'cosHour', 'sinYear', 'cosYear'];
  const sigma: CalibrationBundle['sigma2'] = { alpha: round(sg.alpha, 8)!, beta: round(sg.beta, 8)! };
  if (sg.template) sigma.template = sg.template.map(v => round(v, 5)!);
  if (sg.mult && Math.abs(sg.mult - 1) > 1e-4) sigma.mult = round(sg.mult, 5)!;

  if (sel.model.family === 'emos' || sel.model.family === 'nnls') {
    const m = sel.model as LinearModel;
    return {
      family: sel.model.family, kind,
      intercept: round(m.b0, 6)!,
      beta: m.beta.map(v => round(v, 6)!),
      centre: m.mu.map(v => round(v, 6)!),
      scale: m.sd.map(v => round(v, 6)!),
      modelIds: usable, crossVars, crossMean: crossFill.map(v => round(v, 6)!),
      sigma2: sigma,
      labels,
    };
  }
  if (sel.model.family === 'best') {
    return { family: 'best', kind, singleModel: (sel.model as any).singleModel, modelIds: usable, sigma2: sigma, labels, crossVars: [] };
  }
  return { family: 'mean', kind, modelIds: usable, sigma2: sigma, labels, crossVars: [] };
}

/** Predict from stored calibration (browser path). */
export function predictFromCalibration(
  calib: CalibrationBundle,
  values: { mean: number; byId: Array<number | null> },
  spread: number,
  hour: number,
  doy: number,
  crossVals: Array<number | null>
): number | null {
  if (calib.family === 'emos' || calib.family === 'nnls') {
    const row = [values.mean, spread];
    for (let j = 0; j < calib.modelIds.length; j++) {
      const v = values.byId[j];
      row.push(isFiniteNum(v) ? v! : values.mean);
    }
    for (let j = 0; j < (calib.crossVars || []).length; j++) {
      const v = crossVals && j < crossVals.length ? crossVals[j] : null;
      const isFinite = typeof v === 'number' && Number.isFinite(v);
      const fallback = calib.crossMean ? calib.crossMean[j] : 0;
      const val: number = isFinite ? (v as number) : (fallback ?? 0);
      row.push(val);
    }
    row.push(Math.sin(2 * Math.PI * hour / 24), Math.cos(2 * Math.PI * hour / 24));
    row.push(Math.sin(2 * Math.PI * doy / 365.25), Math.cos(2 * Math.PI * doy / 365.25));
    const SD = (calib.scale!.length >= calib.beta!.length ? calib.scale! : calib.beta!.map(() => 1));
    let mu = calib.intercept!;
    for (let j = 0; j < calib.beta!.length; j++) {
      const sd = SD[j]!;
      const rowVal: number = row[j]!;
      const centreVal = calib.centre![j]!;
      mu += calib.beta![j] * ((rowVal - centreVal) / sd);
    }
    return mu;
  }
  if (calib.family === 'best') {
    const j = calib.modelIds.indexOf(calib.singleModel!);
    return j >= 0 && isFiniteNum(values.byId[j]) ? values.byId[j]! : values.mean;
  }
  return values.mean;
}