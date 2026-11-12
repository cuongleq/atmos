/**
 * Wind direction evaluation (joint u/v fitting).
 */

import { finite, round, meanS } from './numeric.js';
import { pointScores } from './scores.js';
import { toDir, toSpeed, circularAbs } from './wind.js';
import { calibrationBundle } from './calibration.js';
import { directionSpecs, selectDirectionPair } from './direction-model-selection.js';
import { buildCrossFill } from './predictors.js';
import { Spec, makeSpec } from './predictors.js';
import { Sigma2 } from './linear-algebra.js';
import { VariableSpec } from './variables.js';

export function evaluateDirection(opts: {
  times: string[];
  series: Record<string, { u: Array<number | null>; v: Array<number | null> }>;
  obsSpeed: Array<number | null>;
  obsDirection: Array<number | null>;
  variable: string;
  lead: number;
  trainEnd: string;
  testStart: string;
  purgeDays: number;
  utcOffset: number;
  modelNames: Record<string, string>;
  crossVars: string[];
  cross: Record<string, Array<number | null>>;
  vspec: VariableSpec;
  base: any;
  usable: string[];
  trainIdx: number[];
  testIdx: number[];
}): any {
  const { times, series, obsSpeed, obsDirection, variable, lead, trainEnd, testStart, purgeDays, utcOffset, modelNames, crossVars, cross, vspec, base, usable, trainIdx, testIdx } = opts;

  const uObs = new Array(times.length), vObs = new Array(times.length);
  const truthDir = new Array(times.length);
  for (let i = 0; i < times.length; i++) {
    if (!finite(obsSpeed[i]) || !finite(obsDirection[i])) {
      uObs[i] = null; vObs[i] = null; truthDir[i] = null; continue;
    }
    const r = obsDirection[i]! * Math.PI / 180;
    uObs[i] = obsSpeed[i]! * Math.cos(r);
    vObs[i] = obsSpeed[i]! * Math.sin(r);
    truthDir[i] = obsDirection[i];
  }
  const { cols, fill } = buildCrossFill(times, crossVars, cross, trainIdx);
  const built = directionSpecs(times, series, usable, crossVars, cols, fill, utcOffset, uObs, vObs, truthDir, trainIdx);
  const su = built.su, sv = built.sv;
  const sel = selectDirectionPair(su, sv);
  if (!sel) return { ...base, usable: false, note: 'không tạo được bộ dự báo hướng gió' };
  const pu = (i: number) => componentPredict(sel.model.u, su, i);
  const pv = (i: number) => componentPredict(sel.model.v, sv, i);

  const testSpeed = testIdx.map(i => obsSpeed[i]);
  const testDir = testIdx.map(i => obsDirection[i]);
  const uArr = testIdx.map(pu), vArr = testIdx.map(pv);
  const predSpeed = uArr.map((u, k) => (finite(u) && finite(vArr[k]) ? toSpeed(u!, vArr[k]!) : null));
  const predDir = uArr.map((u, k) => (finite(u) && finite(vArr[k]) ? toDir(u!, vArr[k]!) : null));

  const circErr: number[] = [], vecSq: number[] = [];
  for (let k = 0; k < testIdx.length; k++) {
    if (!finite(predDir[k]) || !finite(testDir[k])) continue;
    circErr.push(circularAbs(predDir[k]!, testDir[k]!));
    const r = testDir[k]! * Math.PI / 180;
    const du = predSpeed[k]! * Math.cos(predDir[k]! * Math.PI / 180) - testSpeed[k]! * Math.cos(r);
    const dv = predSpeed[k]! * Math.sin(predDir[k]! * Math.PI / 180) - testSpeed[k]! * Math.sin(r);
    vecSq.push(du * du + dv * dv);
  }
  const cnt = circErr.length;

  return {
    ...base, usable: true,
    method: 'Hai hồi quy riêng trên thành phần u và v của gió, sau đó ghép thành tốc độ và hướng. Không hồi quy trực tiếp lên độ. Tốc độ gió được chấm riêng ở biến wind_speed_10m.',
    selected: {
      family: sel.winner.family, lambda: sel.winner.lambda,
      cvAngle: round(sel.winner.cvAngle, 4), cvN: sel.winner.cvN,
      cvStandardError: round(sel.winner.gapSe ?? 0, 4), cvGap: round(sel.winner.gap ?? 0, 4),
      withinOneSE: (sel.winner.gap ?? 0) <= (sel.winner.gapSe ?? 0) + 1e-12,
      bestCvFamily: sel.table[0].family, bestCvAngle: round(sel.table[0].cvAngle, 4),
      shared: true,
    },
    candidates: sel.table.map(c => ({
      family: c.family, lambda: c.lambda, cvAngle: round(c.cvAngle, 4), cvN: c.cvN,
      cvGap: round(c.gap!, 4), cvGapSe: round(c.gapSe === Infinity ? null : c.gapSe!, 4),
      chosen: c.family === sel.winner.family && c.lambda === sel.winner.lambda,
    })),
    calibration: {
      family: sel.winner.family,
      modelIds: usable,
      components: 2,
      sigma2: { alpha: 0, beta: 0 },
      labels: ['mean', 'spread', ...usable, ...crossVars, 'sinHour', 'cosHour', 'sinYear', 'cosYear'],
      u: calibrationBundle({ model: sel.model.u, winner: { family: sel.winner.family, lambda: sel.winner.lambda, cvRmse: sel.winner.cvAngle } }, su, usable, crossVars, fill, { alpha: 0, beta: 0 }, 'gauss'),
      v: calibrationBundle({ model: sel.model.v, winner: { family: sel.winner.family, lambda: sel.winner.lambda, cvRmse: sel.winner.cvAngle } }, sv, usable, crossVars, fill, { alpha: 0, beta: 0 }, 'gauss'),
    },
    vectorSpeed: pointScores(predSpeed, testSpeed),
    direction: {
      n: cnt,
      circularMae: cnt ? circErr.reduce((s, v) => s + v, 0) / cnt : null,
      within30: cnt ? circErr.filter(v => v <= 30).length / cnt : null,
      within45: cnt ? circErr.filter(v => v <= 45).length / cnt : null,
      vectorRmse: vecSq.length ? Math.sqrt(vecSq.reduce((s, v) => s + v, 0) / vecSq.length) : null,
    },
  };
}

function componentPredict(model: { family: string; beta?: number[] }, spec: Spec, i: number): number | null {
  if (model.family === 'mean') return spec.mean[i];
  const row = spec.row(i);
  return row ? applyLinear(model as any, row) : null;
}

import { applyLinear } from './linear-algebra.js';