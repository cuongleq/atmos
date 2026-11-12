/**
 * Scoring functions: point, event, probabilistic, and ensemble scores.
 */

import { finite, meanS, quantile, sdS } from './numeric.js';
import { K_MEMBERS, crpsMembers } from './transforms.js';

/** Point forecast scores (MAE, RMSE, bias, correlation). */
export interface PointScores {
  n: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  corr: number | null;
  meanObs: number | null;
  meanPred: number | null;
}

export function pointScores(pred: Array<number | null>, obs: Array<number | null>): PointScores {
  const e: number[] = [], p: number[] = [], o: number[] = [];
  for (let i = 0; i < pred.length; i++) {
    if (!finite(pred[i]) || !finite(obs[i])) continue;
    e.push(pred[i]! - obs[i]!); p.push(pred[i]!); o.push(obs[i]!);
  }
  const n = e.length;
  if (!n) return { n: 0, mae: null, rmse: null, bias: null, corr: null, meanObs: null, meanPred: null };
  let sse = 0, mae = 0;
  for (let i = 0; i < n; i++) { sse += e[i] * e[i]; mae += Math.abs(e[i]); }
  const mp = meanS(p)!, mo = meanS(o)!;
  let cov = 0, sp = 0, so = 0;
  for (let i = 0; i < n; i++) {
    cov += (p[i] - mp) * (o[i] - mo);
    sp += (p[i] - mp) ** 2;
    so += (o[i] - mo) ** 2;
  }
  return {
    n, mae: mae / n, rmse: Math.sqrt(sse / n), bias: e.reduce((s, v) => s + v, 0) / n,
    corr: sp > 0 && so > 0 ? cov / Math.sqrt(sp * so) : null, meanObs: mo, meanPred: mp,
  };
}

/** Event scores (CSI, POD, FAR, HSS) for a threshold. */
export interface EventScores {
  n: number;
  threshold: number;
  csi: number | null;
  pod: number | null;
  far: number | null;
  hss: number | null;
  hit: number;
  miss: number;
  falseAlarm: number;
  correct: number;
  frequency: number | null;
}

export function eventScores(pred: Array<number | null>, obs: Array<number | null>, threshold: number): EventScores {
  let hit = 0, miss = 0, fa = 0, cn = 0;
  for (let i = 0; i < pred.length; i++) {
    if (!finite(pred[i]) || !finite(obs[i])) continue;
    const pe = pred[i]! >= threshold, oe = obs[i]! >= threshold;
    if (pe && oe) hit++; else if (!pe && oe) miss++; else if (pe && !oe) fa++; else cn++;
  }
  const n = hit + miss + fa + cn;
  const base = { n, threshold, csi: null, pod: null, far: null, hss: null, hit, miss, falseAlarm: fa, correct: cn, frequency: n ? (hit + miss) / n : null };
  if (!n) return base;
  const csi = (hit + miss + fa) ? hit / (hit + miss + fa) : null;
  const pod = (hit + miss) ? hit / (hit + miss) : null;
  const far = (hit + fa) ? fa / (hit + fa) : null;
  const csiRef = (hit + cn) / n;
  return { ...base, csi, pod, far, hss: csi !== null && csiRef < 1 ? (csi - csiRef) / (1 - csiRef) : null };
}

/** Brier score, Brier skill score, and reliability bins. */
export interface ProbScores {
  n: number;
  threshold: number;
  brier: number | null;
  bss: number | null;
  baseRate: number | null;
  climatology: number | null;
  reliability: Array<{ bin: number; n: number; forecast: number | null; observed: number | null }>;
}

export function probScores(probs: Array<number | null>, obs: Array<number | null>, threshold: number, climatology: number | null): ProbScores {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, sumP: 0, hits: 0 }));
  let bse = 0, n = 0, hits = 0;
  for (let i = 0; i < probs.length; i++) {
    if (!finite(probs[i]) || !finite(obs[i])) continue;
    const y = obs[i]! >= threshold ? 1 : 0;
    bse += (probs[i]! - y) ** 2; n++; hits += y;
  }
  if (!n) return { n: 0, threshold, brier: null, bss: null, baseRate: null, climatology: null, reliability: [] };
  for (let i = 0; i < probs.length; i++) {
    if (!finite(probs[i]) || !finite(obs[i])) continue;
    const y = obs[i]! >= threshold ? 1 : 0;
    const b = Math.min(9, Math.max(0, Math.floor(probs[i]! * 10)));
    bins[b].n++; bins[b].sumP += probs[i]!; bins[b].hits += y;
  }
  const p = hits / n;
  const brier = bse / n;
  const base = finite(climatology) ? climatology : p;
  const ref = base * (1 - base);
  return {
    n, threshold, brier, bss: ref > 0 ? 1 - brier / ref : null, baseRate: p, climatology: base,
    reliability: bins.map((b, i) => ({
      bin: i / 10, n: b.n, forecast: b.n ? b.sumP / b.n : null, observed: b.n ? b.hits / b.n : null,
    })).filter(b => b.n > 0),
  };
}

/** Probabilistic ensemble scores (CRPS, spread-skill, rank histogram, coverage). */
export interface ProbEnsembleScores {
  n: number;
  crps: number | null;
  pinball: Record<string, number | null>;
  spread: number | null;
  medianRmse: number | null;
  spreadSkill: number | null;
  rangeMean: number | null;
  rankHistogram: number[];
  rankDeviation: number | null;
  coverage: { n: number; p25p75: number; p10p90: number; full: number } | null;
}

export function probEnsembleScores(members: Array<number[] | null>, obs: Array<number | null>): ProbEnsembleScores {
  let crpsSum = 0, n = 0, sqSpread = 0, sqErr = 0, en = 0, loSum = 0, hiSum = 0;
  const pin: Record<string, number> = { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  const pinN: Record<string, number> = { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  const rank = new Array(K_MEMBERS + 1).fill(0);
  let rankN = 0;
  const targets = [['p10', 0.1], ['p25', 0.25], ['p50', 0.5], ['p75', 0.75], ['p90', 0.9]] as const;
  const cov = { '50': 0, '80': 0, full: 0 };
  let coverN = 0;

  for (let i = 0; i < members.length; i++) {
    const mem = members[i], y = obs[i];
    if (!mem || !finite(y)) continue;
    const c = crpsMembers(mem, y);
    if (c === null) continue;
    crpsSum += c; n++; rankN++;
    const s = mem.filter(finite).sort((a, b) => a - b);
    const mu = meanS(s), sd = sdS(s);
    if (mu !== null && sd !== null) { sqSpread += sd * sd; }
    loSum += s[0]; hiSum += s[s.length - 1];
    let below = 0;
    for (const v of s) if (v <= y) below++;
    rank[Math.min(below, K_MEMBERS)]++;
    for (const [k, q] of targets) {
      const pred = quantile(s, q);
      if (pred === null) continue;
      pin[k] += (y >= pred ? q : 1 - q) * (y - pred);
      pinN[k]++;
    }
    const med = quantile(s, 0.5);
    if (med !== null) { sqErr += (med - y) ** 2; en++; }
    const q10 = quantile(s, 0.1), q25 = quantile(s, 0.25), q75 = quantile(s, 0.75), q90 = quantile(s, 0.9);
    if (q10 !== null && q25 !== null && q75 !== null && q90 !== null) {
      cov['50'] += (y >= q25 && y <= q75) ? 1 : 0;
      cov['80'] += (y >= q10 && y <= q90) ? 1 : 0;
      cov['full'] += (y >= s[0] && y <= s[s.length - 1]) ? 1 : 0;
      coverN++;
    }
  }

  const step = Math.max(1, Math.floor(K_MEMBERS / 10));
  const rankHistogram = new Array(11).fill(0);
  if (rankN) {
    for (let r = 0; r <= K_MEMBERS; r++) {
      rankHistogram[Math.min(10, Math.floor(r * 11 / (K_MEMBERS + 1)))] += rank[r];
    }
    for (let b = 0; b <= 10; b++) rankHistogram[b] /= rankN;
  }
  const pinball: Record<string, number | null> = {};
  for (const k in pin) pinball[k] = pinN[k] ? pin[k] / pinN[k] : null;
  const spread = n ? Math.sqrt(sqSpread / n) : null;
  const rmse = en ? Math.sqrt(sqErr / en) : null;
  let chi = 0;
  if (rankN) for (const r of rankHistogram) chi += (r - 1 / 11) ** 2;
  return {
    n, crps: n ? crpsSum / n : null, pinball,
    spread, medianRmse: rmse,
    spreadSkill: (spread !== null && rmse) ? spread / rmse : null,
    rangeMean: n ? (hiSum - loSum) / n : null,
    rankHistogram, rankDeviation: rankN ? Math.sqrt(chi) : null,
    coverage: coverN ? {
      n: coverN,
      p25p75: cov['50'] / coverN,
      p10p90: cov['80'] / coverN,
      full: cov.full / coverN,
    } : null,
  };
}

/** Moving-block bootstrap on paired squared-error difference. */
export interface BootstrapResult {
  deltaRmse: number;
  ci95: [number, number];
  ci80: [number, number];
  probImprovement: number;
  skill: number | null;
  reps: number;
  blockHours: number;
}

export function pairedBootstrap(
  baseSq: number[], modelSq: number[], blockHours: number, reps: number, seed: number
): BootstrapResult | null {
  const n = Math.min(baseSq.length, modelSq.length);
  if (n < blockHours * 2) return null;
  const fb = baseSq.filter(finite), fm = modelSq.filter(finite);
  if (fb.length < blockHours * 2 || fb.length !== fm.length) return null;
  const rmseB = Math.sqrt(fb.reduce((s, v) => s + v, 0) / fb.length);
  const rmseM = Math.sqrt(fm.reduce((s, v) => s + v, 0) / fm.length);
  if (!(rmseB > 0)) return null;
  const blocks = Math.ceil(n / blockHours);
  const rand = (() => {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const diffs: number[] = [];
  for (let r = 0; r < reps; r++) {
    let sb = 0, sm = 0, cnt = 0;
    for (let b = 0; b < blocks; b++) {
      const start = Math.floor(rand() * (n - blockHours + 1));
      for (let k = 0; k < blockHours; k++) { sb += baseSq[start + k]; sm += modelSq[start + k]; cnt++; }
    }
    diffs.push(Math.sqrt(sb / cnt) - Math.sqrt(sm / cnt));
  }
  if (diffs.length < 20) return null;
  diffs.sort((a, b) => a - b);
  const q = (p: number) => diffs[Math.min(Math.floor(p * (diffs.length - 1)), diffs.length - 1)];
  return {
    deltaRmse: rmseB - rmseM, ci95: [q(0.025), q(0.975)], ci80: [q(0.1), q(0.9)],
    probImprovement: diffs.filter(d => d > 0).length / diffs.length,
    skill: rmseB > 0 ? 1 - rmseM / rmseB : null, reps: diffs.length, blockHours,
  };
}