/**
 * Main evaluation entry point.
 * Dispatches to scalar, direction, or code evaluation based on variable kind.
 */

import { finite, round } from './numeric.js';
import { VariableSpec, VARIABLES } from './variables.js';
import { evaluateScalar } from './scalar-evaluation.js';
import { evaluateDirection } from './direction-evaluation.js';
import { evaluateCode } from './code-evaluation.js';

export interface EvaluateOptions {
  times: string[];
  obs: Array<number | null>;
  series: Record<string, Array<number | null> | { u: Array<number | null>; v: Array<number | null> }>;
  variable: string;
  lead: number;
  trainEnd: string;
  testStart: string;
  purgeDays: number;
  utcOffset: number;
  modelNames: Record<string, string>;
  crossVars: string[];
  cross: Record<string, Array<number | null>>;
  obsSpeed?: Array<number | null>;
  obsDirection?: Array<number | null>;
  codeFeatures?: Array<Array<number | null>>;
}

/** Main evaluation function - dispatches based on variable kind. */
export function evaluate(opts: EvaluateOptions): any {
  const vspec = VARIABLES[opts.variable];
  if (!vspec) throw new Error('biến không hợp lệ: ' + opts.variable);
  const { times, obs, series, variable } = opts;
  const n = times.length;
  const dateOf = (i: number) => times[i].slice(0, 10);
  const modelIds = Object.keys(series);

  // Keep only systems that are effectively complete over the fitting window.
  const coverage: Record<string, number> = {};
  let window = 0;
  for (let i = 0; i < n; i++) if (dateOf(i) <= opts.trainEnd) window++;
  for (const id of modelIds) {
    const col = series[id];
    // Wind direction arrives as a u/v pair rather than a flat column.
    const at = Array.isArray(col) ? (i: number) => col[i] : (i: number) => (col.u ? col.u[i] : null);
    let ok = 0;
    for (let i = 0; i < n; i++) if (dateOf(i) <= opts.trainEnd && finite(at(i))) ok++;
    coverage[id] = window ? ok / window : 0;
  }
  // Code is classified from cross-variable context fields and does not take a
  // series at all, so the per-model coverage screen does not apply.
  const usable = vspec.kind === 'code'
    ? []
    : modelIds.filter(id => coverage[id] >= 0.97);
  // Direction passes its truth as u/v scalars rather than a single series,
  // so the presence test has to be told which array actually holds the truth.
  const truthAt = (vspec.kind === 'direction' || vspec.kind === 'code')
    ? (variable === 'weather_code'
      ? (Array.isArray(obs) ? (i: number) => finite(obs[i]) : () => false)
      : (opts.obsSpeed ? (i: number) => finite(opts.obsSpeed![i]) && finite(opts.obsDirection![i]) : () => false))
    : (Array.isArray(obs) ? (i: number) => finite(obs[i]) : () => false);
  const complete = (i: number) => {
    if (vspec.kind === 'code') return truthAt(i);
    for (const id of usable) {
      const col = series[id];
      const colAt = Array.isArray(col) ? col[i] : col.u[i];
      if (colAt == null || !finite(colAt)) return false;
    }
    return truthAt(i);
  };
  const trainIdx: number[] = [], testIdx: number[] = [];
  let eligibleTest = 0;
  for (let i = 0; i < n; i++) {
    const after = dateOf(i) >= opts.testStart;
    if (after) eligibleTest++;
    if (!after) continue;
    if (complete(i)) testIdx.push(i);
  }
  for (let i = 0; i < n; i++) if (dateOf(i) <= opts.trainEnd && complete(i)) trainIdx.push(i);

  const base = {
    variable, lead: opts.lead, unit: vspec.unit, kind: vspec.kind, group: vspec.group,
    label: vspec.label, short: vspec.short, digits: vspec.digits,
    models: usable.map(id => opts.modelNames?.[id] || id),
    modelIds: usable, coverage: round(coverage, 4),
    trainingN: trainIdx.length, testN: testIdx.length,
    coverageTest: eligibleTest ? testIdx.length / eligibleTest : null,
    purgeDays: opts.purgeDays ?? null,
  };
  if (!usable.length && vspec.kind !== 'code') return { ...base, usable: false, note: 'không mô hình nào phủ đủ biến này' };
  if (trainIdx.length < 500) return { ...base, usable: false, note: 'quá ít giờ huấn luyện' };
  if (testIdx.length < 48) return { ...base, usable: false, note: 'không đủ giờ kiểm tra chung' };

  // Direction and code are handled by dedicated fits, but only after the scalar
  // path has been proven to work on the same rows.
  if (vspec.kind === 'direction') return evaluateDirection({ ...opts, vspec, crossVars: opts.crossVars || [], cross: opts.cross || {}, base, usable, trainIdx, testIdx });
  if (vspec.kind === 'code') return evaluateCode({ ...opts, vspec, crossVars: opts.crossVars || [], cross: opts.cross || [], base, usable, trainIdx, testIdx });
  return evaluateScalar({ ...opts, vspec, crossVars: opts.crossVars || [], cross: opts.cross || {}, usable, trainIdx, testIdx, base });
}