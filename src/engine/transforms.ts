/**
 * Forward and inverse transforms for the fitting space.
 * Keeps precipitation, wind and humidity well-behaved.
 */

import { clamp, finite, ncdfInv } from './numeric.js';

export type TransformKind = 'gauss' | 'log1p' | 'logit' | 'direction' | 'code';

export const FORWARD: Record<TransformKind, (x: number) => number> = {
  gauss: x => x,
  log1p: x => Math.log1p(Math.max(0, x)),
  logit: x => { const p = clamp(x, 0.5, 99.5) / 100; return Math.log(p / (1 - p)); },
  direction: x => x,
  code: x => x,
};

export const INVERSE: Record<TransformKind, (y: number) => number> = {
  gauss: y => y,
  log1p: y => Math.expm1(clamp(y, -30, 30)),
  logit: y => (1 / (1 + Math.exp(-clamp(y, -30, 30)))) * 100,
  direction: y => y,
  code: y => y,
};

/** Physical bounds implied by the transform. */
export const BOUNDS: Record<TransformKind, [number | null, number | null]> = {
  log1p: [0, null],
  logit: [0, 100],
  gauss: [null, null],
  direction: [null, null],
  code: [null, null],
};

/** |d(inv)/d(mu)| for each fitting transform at the given central value. */
export function jacobian(kind: TransformKind, mu: number): number {
  if (kind === 'log1p') return Math.exp(Math.max(mu, -20));
  if (kind === 'logit') {
    const p = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, mu))));
    return Math.max(1e-4, 100 * p * (1 - p));
  }
  return 1;
}

/**
 * Reproducible pseudo-ensemble: calibrated Gaussian mapped back to physical units.
 * The fan is drawn in physical space so a dry hour gets zero-width rain ensemble.
 */
export interface PseudoMembersOptions {
  kind: TransformKind;
  mu: number;
  sd: number;
  lo?: number | null;
  hi?: number | null;
  template?: number[];
  mult?: number;
}

export const K_MEMBERS = 51;

const Z_NODES: number[] = (() => {
  const z: number[] = [];
  for (let k = 0; k < K_MEMBERS; k++) z.push(ncdfInv((k + 0.5) / K_MEMBERS));
  return z;
})();

/** Reproducible pseudo-ensemble around a central forecast.
 * Supports both legacy positional arguments and new options object.
 * Legacy: pseudoMembers(kind, mu, sd, lo, hi, template, mult)
 * New: pseudoMembers({ kind, mu, sd, lo, hi, template, mult })
 */
export function pseudoMembers(
  kindOrOpts: PseudoMembersOptions | string,
  mu?: number,
  sd?: number,
  loPos?: number | null,
  hiPos?: number | null,
  template?: number[],
  mult?: number
): number[] {
  // Handle both legacy positional args and new options object
  let opts: PseudoMembersOptions;
  if (typeof kindOrOpts === 'string') {
    // Legacy positional arguments
    opts = { kind: kindOrOpts, mu: mu!, sd: sd!, lo: loPos, hi: hiPos, template, mult };
  } else {
    // New options object
    opts = kindOrOpts;
  }
  
  const { kind, mu: muVal, sd: sdVal, lo, hi, template: tmpl, mult: multVal } = opts;
  const inv = INVERSE[kind] || INVERSE.gauss;
  const [dlo, dhi] = BOUNDS[kind] || BOUNDS.gauss;
  const low = finite(lo!) ? lo! : dlo;
  const high = finite(hi!) ? hi! : dhi;
  const centre = inv(muVal);
  const scale = Math.max(sdVal * jacobian(kind, muVal), 1e-6);
  const m = finite(multVal) && multVal! > 0 ? multVal! : 1;
  const nodes = tmpl && tmpl.length === K_MEMBERS
    ? (m === 1 ? tmpl : tmpl.map(v => v * m))
    : Z_NODES;

  const out = new Array(K_MEMBERS);
  for (let k = 0; k < K_MEMBERS; k++) {
    let v = centre + nodes[k] * scale;
    if (finite(low) && v < low) v = low;
    if (finite(high) && v > high) v = high;
    out[k] = v;
  }
  return out.sort((a, b) => a - b);
}

export { quantile, Z_NODES };

/**
 * Empirical residual shape template.
 * The shape is measured instead of assumed - residuals from the fitting window
 * divided by predicted sigma isolate the part sigma2 cannot express.
 */
export function residualTemplate(z: number[], symmetric: boolean): number[] | null {
  const s = z.filter(finite).sort((a, b) => a - b);
  if (s.length < 200) return null;
  if (!symmetric) {
    const out = new Array(K_MEMBERS);
    for (let k = 0; k < K_MEMBERS; k++) {
      out[k] = s[clamp(Math.floor((k + 0.5) / K_MEMBERS * s.length), 0, s.length - 1)];
    }
    return out;
  }
  // Symmetric envelope of empirical |residual|.
  const abs = s.map(v => Math.abs(v)).sort((a, b) => a - b);
  const half = Math.floor(K_MEMBERS / 2);
  const out = new Array(K_MEMBERS);
  for (let k = 0; k <= half; k++) {
    const q = abs[clamp(Math.floor((k + 0.5) / (half + 1) * abs.length), 0, abs.length - 1)];
    out[k] = -q;
    out[K_MEMBERS - 1 - k] = k === half && K_MEMBERS % 2 ? 0 : q;
  }
  return out;
}

/** Exact CRPS of the calibrated distribution via the member energy form. */
export function crpsMembers(mem: number[], y: number): number | null {
  const s = mem.filter(finite).sort((a, b) => a - b);
  const k = s.length;
  if (k < 2 || !finite(y)) return null;
  let first = 0, acc = 0, pairSum = 0;
  for (let i = 0; i < k; i++) {
    first += Math.abs(s[i] - y);
    pairSum += s[i] * i - acc;
    acc += s[i];
  }
  return first / k - 0.5 * (pairSum / (k * (k - 1) / 2));
}