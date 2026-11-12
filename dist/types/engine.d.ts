// src/engine/numeric.ts
var EPS = 1e-9;
function finite(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function round(v, d) {
  if (!finite(v)) return v;
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}
function meanS(a) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (finite(a[i])) {
    s += a[i];
    n++;
  }
  return n ? s / n : null;
}
function varS(a) {
  const m = meanS(a);
  if (m === null) return null;
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (finite(a[i])) {
    s += (a[i] - m) ** 2;
    n++;
  }
  return n > 1 ? s / (n - 1) : 0;
}
function sdS(a) {
  const v = varS(a);
  return v === null ? null : Math.sqrt(v);
}
function quantile2(a, q) {
  const f = a.filter(finite).sort((x, y) => x - y);
  if (!f.length) return null;
  if (f.length === 1) return f[0];
  const p = clamp(q, 0, 1) * (f.length - 1);
  const lo = Math.floor(p), hi = Math.ceil(p);
  return f[lo] + (p - lo) * (f[hi] - f[lo]);
}
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
var ncdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
var pdf = (z) => 0.3989422804014327 * Math.exp(-0.5 * z * z);
function ncdfInv(p) {
  if (!finite(p)) return NaN;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const A = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239
  ];
  const B = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572
  ];
  const C = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783
  ];
  const D = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416
  ];
  const tailNum = (c, q2) => ((((c[0] * q2 + c[1]) * q2 + c[2]) * q2 + c[3]) * q2 + c[4]) * q2 + c[5];
  const tailDen = (d, q2) => (((d[0] * q2 + d[1]) * q2 + d[2]) * q2 + d[3]) * q2 + 1;
  const cenNum = (a, r) => ((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5];
  const cenDen = (b, r) => ((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1;
  if (p < 0.02425) {
    const q2 = Math.sqrt(-2 * Math.log(p));
    return tailNum(C, q2) / tailDen(D, q2);
  }
  if (p <= 1 - 0.02425) {
    const q2 = p - 0.5, r = q2 * q2;
    return q2 * cenNum(A, r) / cenDen(B, r);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -tailNum(C, q) / tailDen(D, q);
}
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, 1 | t);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// src/engine/transforms.ts
var FORWARD = {
  gauss: (x) => x,
  log1p: (x) => Math.log1p(Math.max(0, x)),
  logit: (x) => {
    const p = clamp(x, 0.5, 99.5) / 100;
    return Math.log(p / (1 - p));
  }
};
var INVERSE = {
  gauss: (y) => y,
  log1p: (y) => Math.expm1(clamp(y, -30, 30)),
  logit: (y) => 1 / (1 + Math.exp(-clamp(y, -30, 30))) * 100
};
var BOUNDS = {
  log1p: [0, null],
  logit: [0, 100],
  gauss: [null, null]
};
function jacobian(kind, mu) {
  if (kind === "log1p") return Math.exp(Math.max(mu, -20));
  if (kind === "logit") {
    const p = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, mu))));
    return Math.max(1e-4, 100 * p * (1 - p));
  }
  return 1;
}
var K_MEMBERS = 51;
var Z_NODES = (() => {
  const z = [];
  for (let k = 0; k < K_MEMBERS; k++) z.push(ncdfInv((k + 0.5) / K_MEMBERS));
  return z;
})();
function pseudoMembers(kindOrOpts, mu, sd, loPos, hiPos, template, mult) {
  let opts;
  if (typeof kindOrOpts === "string") {
    opts = { kind: kindOrOpts, mu, sd, lo: loPos, hi: hiPos, template, mult };
  } else {
    opts = kindOrOpts;
  }
  const { kind, mu: muVal, sd: sdVal, lo, hi, template: tmpl, mult: multVal } = opts;
  const inv = INVERSE[kind] || INVERSE.gauss;
  const [dlo, dhi] = BOUNDS[kind] || BOUNDS.gauss;
  const low = finite(lo) ? lo : dlo;
  const high = finite(hi) ? hi : dhi;
  const centre = inv(muVal);
  const scale = Math.max(sdVal * jacobian(kind, muVal), 1e-6);
  const m = finite(multVal) && multVal > 0 ? multVal : 1;
  const nodes = tmpl && tmpl.length === K_MEMBERS ? m === 1 ? tmpl : tmpl.map((v) => v * m) : Z_NODES;
  const out = new Array(K_MEMBERS);
  for (let k = 0; k < K_MEMBERS; k++) {
    let v = centre + nodes[k] * scale;
    if (finite(low) && v < low) v = low;
    if (finite(high) && v > high) v = high;
    out[k] = v;
  }
  return out.sort((a, b) => a - b);
}
function residualTemplate(z, symmetric) {
  const s = z.filter(finite).sort((a, b) => a - b);
  if (s.length < 200) return null;
  if (!symmetric) {
    const out2 = new Array(K_MEMBERS);
    for (let k = 0; k < K_MEMBERS; k++) {
      out2[k] = s[clamp(Math.floor((k + 0.5) / K_MEMBERS * s.length), 0, s.length - 1)];
    }
    return out2;
  }
  const abs = s.map((v) => Math.abs(v)).sort((a, b) => a - b);
  const half = Math.floor(K_MEMBERS / 2);
  const out = new Array(K_MEMBERS);
  for (let k = 0; k <= half; k++) {
    const q = abs[clamp(Math.floor((k + 0.5) / (half + 1) * abs.length), 0, abs.length - 1)];
    out[k] = -q;
    out[K_MEMBERS - 1 - k] = k === half && K_MEMBERS % 2 ? 0 : q;
  }
  return out;
}
function crpsMembers(mem, y) {
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

// src/engine/linear-algebra.ts
function gaussSolve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => r.slice().concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    if (p !== c) {
      const t = M[p];
      M[p] = M[c];
      M[c] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}
function moments(X, y) {
  const n = X.length, p = X[0].length;
  const mu = new Array(p).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mu[j] += X[i][j];
  for (let j = 0; j < p; j++) mu[j] /= n;
  let ym = 0;
  for (let i = 0; i < n; i++) ym += y[i];
  ym /= n;
  const sd = new Array(p).fill(1);
  for (let j = 0; j < p; j++) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = X[i][j] - mu[j];
      v += d * d;
    }
    const s = Math.sqrt(v / Math.max(1, n - 1));
    sd[j] = s > 1e-12 ? s : 1;
  }
  const XtX = [];
  const Xty = new Array(p).fill(0);
  for (let a = 0; a < p; a++) {
    const row = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const za = (X[i][a] - mu[a]) / sd[a];
      for (let c = a; c < p; c++) row[c] += za * ((X[i][c] - mu[c]) / sd[c]);
      Xty[a] += za * (y[i] - ym);
    }
    XtX.push(row);
  }
  for (let a = 0; a < p; a++) for (let c = 0; c < a; c++) XtX[a][c] = XtX[c][a];
  let tr = 0;
  for (let a = 0; a < p; a++) tr += XtX[a][a];
  return { XtX, Xty, mu, ym, sd, p, n, scale: p ? tr / p : 1 };
}
function solveRidge(m, lambda) {
  const A = m.XtX.map((r) => r.slice());
  for (let a = 0; a < m.p; a++) A[a][a] += lambda * (m.scale || 1) + 1e-12;
  const beta = gaussSolve(A, m.Xty);
  return beta && beta.every(finite) ? beta : null;
}
function solveNNLS(m, lambda) {
  const p = m.p;
  const A = m.XtX.map((r) => r.slice());
  for (let a = 0; a < p; a++) A[a][a] += lambda * (m.scale || 1) + 1e-12;
  const w = new Array(p).fill(0);
  const inSet = new Array(p).fill(false);
  const idx = [];
  const limit = 4 * p + 10;
  for (let guard = 0; guard < limit; guard++) {
    let t = -1, best = 1e-10;
    for (let a = 0; a < p; a++) {
      if (inSet[a]) continue;
      let g = m.Xty[a];
      for (let c = 0; c < p; c++) g -= A[a][c] * w[c];
      if (g > best) {
        best = g;
        t = a;
      }
    }
    if (t < 0) break;
    inSet[t] = true;
    for (let inner = 0; inner < limit; inner++) {
      idx.length = 0;
      for (let a = 0; a < p; a++) if (inSet[a]) idx.push(a);
      const As = idx.map((a) => idx.map((c) => A[a][c]));
      const bs = idx.map((a) => m.Xty[a]);
      const z = gaussSolve(As, bs);
      if (!z) {
        inSet[t] = false;
        break;
      }
      let alpha = 1;
      for (let s = 0; s < idx.length; s++) {
        if (z[s] <= 0) {
          const denom = w[idx[s]] - z[s];
          alpha = Math.min(alpha, denom > 1e-12 ? w[idx[s]] / denom : 0);
        }
      }
      if (alpha < 1) {
        for (let s = 0; s < idx.length; s++) w[idx[s]] += alpha * (z[s] - w[idx[s]]);
        for (let s = 0; s < idx.length; s++) if (w[idx[s]] <= 1e-12) {
          w[idx[s]] = 0;
          inSet[idx[s]] = false;
        }
      } else {
        for (let s = 0; s < idx.length; s++) w[idx[s]] = z[s];
        break;
      }
    }
  }
  for (let a = 0; a < p; a++) if (w[a] < 0) w[a] = 0;
  return w;
}
function linearModel(family, beta, m) {
  return { family, beta: beta.slice(), b0: m.ym, mu: m.mu.slice(), sd: m.sd.slice() };
}
function applyLinear(model, row) {
  let v = model.b0;
  for (let j = 0; j < model.beta.length; j++) {
    v += model.beta[j] * ((row[j] - model.mu[j]) / model.sd[j]);
  }
  return v;
}
function rollingFolds(n, k) {
  const chunk = Math.floor(n / (k + 2));
  const folds = [];
  for (let f = 0; f < k; f++) {
    const trEnd = chunk * (f + 1);
    const vaStart = trEnd + chunk;
    const vaEnd = Math.min(n, vaStart + chunk);
    if (vaEnd - vaStart < 8) break;
    folds.push({ train: trEnd, valid: [vaStart, vaEnd] });
  }
  return folds;
}
function sigma2(spreadSq, sq) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 0; i < spreadSq.length; i++) {
    const x = spreadSq[i], y = sq[i];
    if (!finite(x) || !finite(y)) continue;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    n++;
  }
  if (n < 20) return { alpha: Math.max(0, sy / Math.max(1, n)), beta: 0 };
  const denom = n * sxx - sx * sx;
  let beta = Math.abs(denom) > 1e-14 ? (n * sxy - sx * sy) / denom : 0;
  let alpha = (sy - beta * sx) / n;
  if (beta < 0) {
    beta = 0;
    alpha = sy / n;
  }
  if (alpha < 0) {
    alpha = 0;
    beta = 0;
  }
  return { alpha, beta };
}

// src/engine/variables.ts
var VARIABLES = {
  temperature_2m: { label: "Nhi\u1EC7t \u0111\u1ED9 2 m", short: "Nhi\u1EC7t \u0111\u1ED9", unit: "\xB0C", kind: "gauss", digits: 1, group: "nhi\u1EC7t", cross: ["cloud_cover", "relative_humidity_2m"] },
  apparent_temperature: { label: "Nhi\u1EC7t \u0111\u1ED9 c\u1EA3m gi\xE1c", short: "C\u1EA3m gi\xE1c", unit: "\xB0C", kind: "gauss", digits: 1, group: "nhi\u1EC7t", cross: ["wind_speed_10m"] },
  dew_point_2m: { label: "Nhi\u1EC7t \u0111\u1ED9 \u0111i\u1EC3m s\u01B0\u01A1ng", short: "\u0110i\u1EC3m s\u01B0\u01A1ng", unit: "\xB0C", kind: "gauss", digits: 1, group: "nhi\u1EC7t", cross: ["relative_humidity_2m"] },
  relative_humidity_2m: { label: "\u0110\u1ED9 \u1EA9m t\u01B0\u01A1ng \u0111\u1ED1i", short: "\u0110\u1ED9 \u1EA9m", unit: "%", kind: "logit", digits: 0, group: "\u1EA9m", cross: ["cloud_cover"] },
  cloud_cover: { label: "\u0110\u1ED9 ph\u1EE7 m\xE2y", short: "Ph\u1EE7 m\xE2y", unit: "%", kind: "logit", digits: 0, group: "\u1EA9m", cross: ["precipitation"] },
  precipitation: { label: "L\u01B0\u1EE3ng m\u01B0a", short: "M\u01B0a", unit: "mm", kind: "log1p", digits: 1, group: "m\u01B0a", accum: true, thresholds: [0.1, 1, 2, 5, 10, 20] },
  rain: { label: "M\u01B0a d\u1EA1ng l\u1ECFng", short: "M\u01B0a l\u1ECFng", unit: "mm", kind: "log1p", digits: 1, group: "m\u01B0a", accum: true, thresholds: [0.1, 1, 5, 10] },
  snowfall: { label: "Tuy\u1EBFt r\u01A1i", short: "Tuy\u1EBFt", unit: "cm", kind: "log1p", digits: 2, group: "m\u01B0a", accum: true, thresholds: [0.1, 1, 5] },
  wind_speed_10m: { label: "T\u1ED1c \u0111\u1ED9 gi\xF3 10 m", short: "Gi\xF3", unit: "km/h", kind: "log1p", digits: 1, group: "gi\xF3", thresholds: [10, 20, 30, 40] },
  wind_gusts_10m: { label: "Gi\xF3 gi\u1EADt 10 m", short: "Gi\xF3 gi\u1EADt", unit: "km/h", kind: "log1p", digits: 1, group: "gi\xF3", thresholds: [20, 30, 40, 50, 60] },
  wind_direction_10m: { label: "H\u01B0\u1EDBng gi\xF3 10 m", short: "H\u01B0\u1EDBng gi\xF3", unit: "\xB0", kind: "direction", digits: 0, group: "gi\xF3" },
  surface_pressure: { label: "\xC1p su\u1EA5t m\u1EB7t \u0111\u1EA5t", short: "\xC1p m\u1EB7t \u0111\u1EA5t", unit: "hPa", kind: "gauss", digits: 1, group: "\xE1p" },
  pressure_msl: { label: "\xC1p su\u1EA5t m\u1EF1c bi\u1EC3n", short: "\xC1p m\u1EF1c bi\u1EC3n", unit: "hPa", kind: "gauss", digits: 1, group: "\xE1p" },
  shortwave_radiation: { label: "B\u1EE9c x\u1EA1 m\u1EB7t tr\u1EDDi", short: "B\u1EE9c x\u1EA1", unit: "W/m\xB2", kind: "log1p", digits: 0, group: "n\u0103ng l\u01B0\u1EE3ng" },
  et0_fao_evapotranspiration: { label: "B\u1ED1c h\u01A1i FAO-56", short: "B\u1ED1c h\u01A1i", unit: "mm", kind: "log1p", digits: 2, group: "n\u0103ng l\u01B0\u1EE3ng", accum: true, thresholds: [1, 3, 5] },
  weather_code: { label: "M\xE3 th\u1EDDi ti\u1EBFt WMO", short: "Th\u1EDDi ti\u1EBFt", unit: "", kind: "code", digits: 0, group: "m\xE3" }
};
var VARIABLE_IDS = Object.keys(VARIABLES);
var LEADS = [1, 2, 3, 5, 7];
var DET_MODEL_IDS = [
  "gfs_global",
  "ecmwf_ifs025",
  "icon_global",
  "jma_seamless",
  "gem_seamless",
  "meteofrance_seamless",
  "ukmo_seamless"
];
var DET_MODEL_NAMES = {
  gfs_global: "NOAA GFS",
  ecmwf_ifs025: "ECMWF IFS 0,25\xB0",
  icon_global: "DWD ICON",
  jma_seamless: "JMA GSM",
  gem_seamless: "ECCC GEM",
  meteofrance_seamless: "M\xE9t\xE9o-France",
  ukmo_seamless: "UK Met Office"
};
var LIVE_ENS_MODEL_IDS = [
  "ecmwf_ifs025_ensemble",
  "ncep_gefs_seamless"
];
var LIVE_ENS_MODEL_NAMES = {
  ecmwf_ifs025_ensemble: "ECMWF ENS",
  ncep_gefs_seamless: "NOAA GEFS"
};

// src/engine/scores.ts
function pointScores(pred, obs) {
  const e = [], p = [], o = [];
  for (let i = 0; i < pred.length; i++) {
    if (!finite(pred[i]) || !finite(obs[i])) continue;
    e.push(pred[i] - obs[i]);
    p.push(pred[i]);
    o.push(obs[i]);
  }
  const n = e.length;
  if (!n) return { n: 0, mae: null, rmse: null, bias: null, corr: null, meanObs: null, meanPred: null };
  let sse = 0, mae = 0;
  for (let i = 0; i < n; i++) {
    sse += e[i] * e[i];
    mae += Math.abs(e[i]);
  }
  const mp = meanS(p), mo = meanS(o);
  let cov = 0, sp = 0, so = 0;
  for (let i = 0; i < n; i++) {
    cov += (p[i] - mp) * (o[i] - mo);
    sp += (p[i] - mp) ** 2;
    so += (o[i] - mo) ** 2;
  }
  return {
    n,
    mae: mae / n,
    rmse: Math.sqrt(sse / n),
    bias: e.reduce((s, v) => s + v, 0) / n,
    corr: sp > 0 && so > 0 ? cov / Math.sqrt(sp * so) : null,
    meanObs: mo,
    meanPred: mp
  };
}
function eventScores(pred, obs, threshold) {
  let hit = 0, miss = 0, fa = 0, cn = 0;
  for (let i = 0; i < pred.length; i++) {
    if (!finite(pred[i]) || !finite(obs[i])) continue;
    const pe = pred[i] >= threshold, oe = obs[i] >= threshold;
    if (pe && oe) hit++;
    else if (!pe && oe) miss++;
    else if (pe && !oe) fa++;
    else cn++;
  }
  const n = hit + miss + fa + cn;
  const base = { n, threshold, csi: null, pod: null, far: null, hss: null, hit, miss, falseAlarm: fa, correct: cn, frequency: n ? (hit + miss) / n : null };
  if (!n) return base;
  const csi = hit + miss + fa ? hit / (hit + miss + fa) : null;
  const pod = hit + miss ? hit / (hit + miss) : null;
  const far = hit + fa ? fa / (hit + fa) : null;
  const csiRef = (hit + cn) / n;
  return { ...base, csi, pod, far, hss: csi !== null && csiRef < 1 ? (csi - csiRef) / (1 - csiRef) : null };
}
function probScores(probs, obs, threshold, climatology) {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, sumP: 0, hits: 0 }));
  let bse = 0, n = 0, hits = 0;
  for (let i = 0; i < probs.length; i++) {
    if (!finite(probs[i]) || !finite(obs[i])) continue;
    const y = obs[i] >= threshold ? 1 : 0;
    bse += (probs[i] - y) ** 2;
    n++;
    hits += y;
  }
  if (!n) return { n: 0, threshold, brier: null, bss: null, baseRate: null, climatology: null, reliability: [] };
  for (let i = 0; i < probs.length; i++) {
    if (!finite(probs[i]) || !finite(obs[i])) continue;
    const y = obs[i] >= threshold ? 1 : 0;
    const b = Math.min(9, Math.max(0, Math.floor(probs[i] * 10)));
    bins[b].n++;
    bins[b].sumP += probs[i];
    bins[b].hits += y;
  }
  const p = hits / n;
  const brier = bse / n;
  const base = finite(climatology) ? climatology : p;
  const ref = base * (1 - base);
  return {
    n,
    threshold,
    brier,
    bss: ref > 0 ? 1 - brier / ref : null,
    baseRate: p,
    climatology: base,
    reliability: bins.map((b, i) => ({
      bin: i / 10,
      n: b.n,
      forecast: b.n ? b.sumP / b.n : null,
      observed: b.n ? b.hits / b.n : null
    })).filter((b) => b.n > 0)
  };
}
function probEnsembleScores(members, obs) {
  let crpsSum = 0, n = 0, sqSpread = 0, sqErr = 0, en = 0, loSum = 0, hiSum = 0;
  const pin = { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  const pinN = { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  const rank = new Array(K_MEMBERS + 1).fill(0);
  let rankN = 0;
  const targets = [["p10", 0.1], ["p25", 0.25], ["p50", 0.5], ["p75", 0.75], ["p90", 0.9]];
  const cov = { "50": 0, "80": 0, full: 0 };
  let coverN = 0;
  for (let i = 0; i < members.length; i++) {
    const mem = members[i], y = obs[i];
    if (!mem || !finite(y)) continue;
    const c = crpsMembers(mem, y);
    if (c === null) continue;
    crpsSum += c;
    n++;
    rankN++;
    const s = mem.filter(finite).sort((a, b) => a - b);
    const mu = meanS(s), sd = sdS(s);
    if (mu !== null && sd !== null) {
      sqSpread += sd * sd;
    }
    loSum += s[0];
    hiSum += s[s.length - 1];
    let below = 0;
    for (const v of s) if (v <= y) below++;
    rank[Math.min(below, K_MEMBERS)]++;
    for (const [k, q] of targets) {
      const pred = quantile2(s, q);
      if (pred === null) continue;
      pin[k] += (y >= pred ? q : 1 - q) * (y - pred);
      pinN[k]++;
    }
    const med = quantile2(s, 0.5);
    if (med !== null) {
      sqErr += (med - y) ** 2;
      en++;
    }
    const q10 = quantile2(s, 0.1), q25 = quantile2(s, 0.25), q75 = quantile2(s, 0.75), q90 = quantile2(s, 0.9);
    if (q10 !== null && q25 !== null && q75 !== null && q90 !== null) {
      cov["50"] += y >= q25 && y <= q75 ? 1 : 0;
      cov["80"] += y >= q10 && y <= q90 ? 1 : 0;
      cov["full"] += y >= s[0] && y <= s[s.length - 1] ? 1 : 0;
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
  const pinball = {};
  for (const k in pin) pinball[k] = pinN[k] ? pin[k] / pinN[k] : null;
  const spread = n ? Math.sqrt(sqSpread / n) : null;
  const rmse = en ? Math.sqrt(sqErr / en) : null;
  let chi = 0;
  if (rankN) for (const r of rankHistogram) chi += (r - 1 / 11) ** 2;
  return {
    n,
    crps: n ? crpsSum / n : null,
    pinball,
    spread,
    medianRmse: rmse,
    spreadSkill: spread !== null && rmse ? spread / rmse : null,
    rangeMean: n ? (hiSum - loSum) / n : null,
    rankHistogram,
    rankDeviation: rankN ? Math.sqrt(chi) : null,
    coverage: coverN ? {
      n: coverN,
      p25p75: cov["50"] / coverN,
      p10p90: cov["80"] / coverN,
      full: cov.full / coverN
    } : null
  };
}
function pairedBootstrap(baseSq, modelSq, blockHours, reps, seed) {
  const n = Math.min(baseSq.length, modelSq.length);
  if (n < blockHours * 2) return null;
  const fb = baseSq.filter(finite), fm = modelSq.filter(finite);
  if (fb.length < blockHours * 2 || fb.length !== fm.length) return null;
  const rmseB = Math.sqrt(fb.reduce((s, v) => s + v, 0) / fb.length);
  const rmseM = Math.sqrt(fm.reduce((s, v) => s + v, 0) / fm.length);
  if (!(rmseB > 0)) return null;
  const blocks = Math.ceil(n / blockHours);
  const rand = (() => {
    let a = seed >>> 0 || 1;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, 1 | t);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  })();
  const diffs = [];
  for (let r = 0; r < reps; r++) {
    let sb = 0, sm = 0, cnt = 0;
    for (let b = 0; b < blocks; b++) {
      const start = Math.floor(rand() * (n - blockHours + 1));
      for (let k = 0; k < blockHours; k++) {
        sb += baseSq[start + k];
        sm += modelSq[start + k];
        cnt++;
      }
    }
    diffs.push(Math.sqrt(sb / cnt) - Math.sqrt(sm / cnt));
  }
  if (diffs.length < 20) return null;
  diffs.sort((a, b) => a - b);
  const q = (p) => diffs[Math.min(Math.floor(p * (diffs.length - 1)), diffs.length - 1)];
  return {
    deltaRmse: rmseB - rmseM,
    ci95: [q(0.025), q(0.975)],
    ci80: [q(0.1), q(0.9)],
    probImprovement: diffs.filter((d) => d > 0).length / diffs.length,
    skill: rmseB > 0 ? 1 - rmseM / rmseB : null,
    reps: diffs.length,
    blockHours
  };
}

// src/engine/predictors.ts
var HARMONIC = 4;
var LAMBDA_GRID = [1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3, 1, 3];
var CV_FOLDS = 8;
function hourOf(times, i, utcOffset) {
  const h = Number(times[i].slice(11, 13));
  return ((h + (utcOffset || 0)) % 24 + 24) % 24;
}
function dayOfYear(times, i) {
  const d = Date.UTC(+times[i].slice(0, 4), +times[i].slice(5, 7) - 1, +times[i].slice(8, 10));
  return Math.round((d - Date.UTC(+times[i].slice(0, 4), 0, 1)) / 864e5);
}
function buildCrossFill(times, crossVars, cross, trainIdx) {
  if (!crossVars.length) return { cols: [], fill: [] };
  const cols = crossVars.map((v) => cross[v]);
  const fill = cols.map((col) => {
    let s = 0, c = 0;
    for (const i of trainIdx) if (finite(col[i])) {
      s += col[i];
      c++;
    }
    return c ? s / c : 0;
  });
  return { cols, fill };
}
function makeSpec(opts) {
  const { times, obs, series, modelIds, cross, crossFill, utcOffset, forward, kind } = opts;
  const n = times.length;
  const vals = modelIds.map((id) => series[id].map((v) => finite(v) ? forward(v) : null));
  const mean = new Array(n).fill(null).map(() => null);
  const spread = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0, s2 = 0, c = 0;
    for (let j = 0; j < vals.length; j++) if (finite(vals[j][i])) {
      s += vals[j][i];
      s2 += vals[j][i] ** 2;
      c++;
    }
    mean[i] = c ? s / c : null;
    spread[i] = c > 1 ? Math.sqrt(Math.max(0, s2 / c - mean[i] ** 2)) : 0;
  }
  const hour = new Array(n), doy = new Array(n);
  for (let i = 0; i < n; i++) {
    hour[i] = hourOf(times, i, utcOffset);
    doy[i] = dayOfYear(times, i);
  }
  const nCross = cross.length;
  const spec = {
    n,
    times,
    obs,
    modelIds,
    vals,
    mean,
    spread,
    hour,
    doy,
    forward,
    kind,
    nModels: modelIds.length,
    nCross,
    p: 2 + modelIds.length + nCross + HARMONIC,
    crossCols: [],
    row: () => null
    // placeholder, filled below
  };
  for (let j = 0; j < nCross; j++) {
    spec.crossCols.push(cross[j].map((v) => finite(v) ? forward(v) : crossFill[j] !== void 0 ? crossFill[j] : null));
  }
  spec.row = (i) => {
    if (!finite(spec.mean[i])) return null;
    const row = new Array(spec.p);
    row[0] = spec.mean[i];
    row[1] = spec.spread[i];
    let k = 2;
    for (let j = 0; j < spec.nModels; j++) {
      row[k] = spec.vals[j][i];
      k++;
    }
    for (let j = 0; j < nCross; j++) {
      row[k] = spec.crossCols[j][i];
      k++;
    }
    row[k++] = Math.sin(2 * Math.PI * spec.hour[i] / 24);
    row[k++] = Math.cos(2 * Math.PI * spec.hour[i] / 24);
    row[k++] = Math.sin(2 * Math.PI * spec.doy[i] / 365.25);
    row[k++] = Math.cos(2 * Math.PI * spec.doy[i] / 365.25);
    for (let j = 0; j < spec.p; j++) if (!finite(row[j])) return null;
    return row;
  };
  return spec;
}
function bestSingle(spec, idx, inverse) {
  let bestId = null, bestRmse = Infinity;
  for (let j = 0; j < spec.nModels; j++) {
    let se = 0, c = 0;
    for (const i of idx) {
      const v = spec.vals[j][i];
      if (!finite(v) || !finite(spec.obs[i])) continue;
      se += (inverse(v) - spec.obs[i]) ** 2;
      c++;
    }
    if (c > 20 && se / c < bestRmse) {
      bestRmse = se / c;
      bestId = spec.modelIds[j];
    }
  }
  return { id: bestId, rmse: finite(bestRmse) ? Math.sqrt(bestRmse) : null };
}

// src/engine/model-selection.ts
function selectModel(spec, trainIdx, inverse, forward) {
  const yAll = trainIdx.map((i) => forward(spec.obs[i]));
  const rowsAll = trainIdx.map((i) => spec.row(i));
  const keep = [];
  for (let t = 0; t < trainIdx.length; t++) if (rowsAll[t] && finite(yAll[t])) keep.push(t);
  if (keep.length < spec.p * 12) return null;
  const fitIdx = keep.map((t) => trainIdx[t]);
  const fitRows = keep.map((t) => rowsAll[t]);
  const fitY = keep.map((t) => yAll[t]);
  const mAll = moments(fitRows, fitY);
  const foldSE = /* @__PURE__ */ new Map();
  const folds = rollingFolds(fitIdx.length, CV_FOLDS);
  for (let f = 0; f < folds.length; f++) {
    const trEnd = folds[f].train;
    if (trEnd < spec.p * 12) continue;
    const m = moments(fitRows.slice(0, trEnd), fitY.slice(0, trEnd));
    const trIdx = fitIdx.slice(0, trEnd);
    const best = bestSingle(spec, trIdx, inverse);
    const cands = [{ key: "mean:-", predict: (i) => spec.mean[i] }];
    if (best.id !== null) cands.push({ key: "best:-", predict: (i) => spec.vals[spec.modelIds.indexOf(best.id)][i] });
    if (spec.modelIds.length >= 2) {
      for (const lam of LAMBDA_GRID) {
        const w = solveNNLS(m, lam);
        if (w) {
          const mo = linearModel("nnls", w, m);
          cands.push({ key: `nnls:${lam}`, predict: (i) => applyLinear(mo, spec.row(i)) });
        }
        const b = solveRidge(m, lam);
        if (b) {
          const mo = linearModel("emos", b, m);
          cands.push({ key: `emos:${lam}`, predict: (i) => applyLinear(mo, spec.row(i)) });
        }
      }
    }
    for (let t = folds[f].valid[0]; t < folds[f].valid[1]; t++) {
      const i = fitIdx[t], target = spec.obs[i];
      if (!finite(target)) continue;
      if (!spec.row(i)) continue;
      for (const c of cands) {
        const p = c.predict(i);
        if (!finite(p)) continue;
        if (!foldSE.has(c.key)) foldSE.set(c.key, []);
        const arr = foldSE.get(c.key);
        if (arr.length <= f) arr.push([0, 0]);
        arr[f][0] += (inverse(p) - target) ** 2;
        arr[f][1] += 1;
      }
    }
  }
  const table = [];
  for (const [key, per] of foldSE) {
    let se = 0, n = 0;
    const rmses = [];
    for (const [s, c] of per) {
      if (c < 8) continue;
      se += s;
      n += c;
      rmses.push(Math.sqrt(s / c));
    }
    if (n < 40 || rmses.length < 2) continue;
    const j = key.indexOf(":");
    const lambda = key.slice(j + 1) === "-" ? null : Number(key.slice(j + 1));
    table.push({
      family: key.slice(0, j),
      lambda,
      cvRmse: Math.sqrt(se / n),
      cvN: n,
      fv: rmses
    });
  }
  if (!table.length) return null;
  table.sort((a, b) => a.cvRmse - b.cvRmse || (b.lambda ?? 0) - (a.lambda ?? 0));
  const COMPLEXITY = { mean: 0, best: 1, nnls: 2, emos: 3 };
  const top = table[0];
  for (const c of table) {
    const diffs = [];
    for (let f = 0; f < top.fv.length; f++) {
      if (!c.fv[f] || !top.fv[f]) continue;
      diffs.push(c.fv[f] - top.fv[f]);
    }
    if (diffs.length < 2) {
      c.gap = 0;
      c.gapSe = Infinity;
      continue;
    }
    const mu = diffs.reduce((s, v) => s + v, 0) / diffs.length;
    const variance = diffs.reduce((s, v) => s + (v - mu) ** 2, 0) / (diffs.length - 1);
    c.gap = mu;
    c.gapSe = Math.sqrt(variance / diffs.length);
  }
  const eligible = table.filter((c) => c.gap <= c.gapSe + 1e-12);
  eligible.sort((a, b) => COMPLEXITY[a.family] - COMPLEXITY[b.family] || (b.lambda ?? 0) - (a.lambda ?? 0) || a.cvRmse - b.cvRmse);
  const winner = eligible[0] || top;
  const bestOnAll = bestSingle(spec, fitIdx, inverse);
  let model;
  if (winner.family === "emos" && spec.modelIds.length >= 2) {
    const b = solveRidge(mAll, winner.lambda);
    if (b) model = linearModel("emos", b, mAll);
    else model = { family: "mean", modelIds: spec.modelIds };
  } else if (winner.family === "nnls" && spec.modelIds.length >= 2) {
    model = linearModel("nnls", solveNNLS(mAll, winner.lambda), mAll);
  } else if (winner.family === "best" && bestOnAll.id !== null) {
    model = { family: "best", singleModel: bestOnAll.id };
  } else {
    model = { family: "mean", modelIds: spec.modelIds };
  }
  const family = model.family;
  return {
    model,
    winner,
    table,
    family,
    fitRows: fitIdx.length,
    bestSingle: bestOnAll,
    cvStandardError: winner.gapSe ?? 0,
    cvThreshold: top.cvRmse + (winner.gap ?? 0),
    cvGap: winner.gap ?? 0
  };
}

// src/engine/wind.ts
function toSpeed(u, v) {
  return Math.hypot(u, v) * 3.6;
}
function toDir(u, v) {
  return (Math.atan2(v, u) * 180 / Math.PI + 360) % 360;
}
function circularAbs(a, b) {
  return Math.abs(((a - b) % 360 + 540) % 360 - 180);
}
function windBarb(speedKmh, dirDeg) {
  if (!finite(speedKmh) || !finite(dirDeg)) return null;
  const level = Math.min(5, Math.floor(speedKmh / 10));
  const half = Math.floor(level / 2), full = level % 2;
  return { level, half, full, dirDeg: round(clamp((dirDeg % 360 + 360) % 360, 0, 360), 1), speedKmh: round(speedKmh, 1) };
}

// src/engine/direction-model-selection.ts
function componentPredict(model, spec, i) {
  if (model.family === "mean") return spec.mean[i];
  const row = spec.row(i);
  return row ? applyLinear(model, row) : null;
}
function directionCandidates(su, sv, foldEnd) {
  const mu = moments(su.fitRows.slice(0, foldEnd), su.fitY.slice(0, foldEnd));
  const mv = moments(sv.fitRows.slice(0, foldEnd), sv.fitY.slice(0, foldEnd));
  const list = [{ family: "mean", lambda: null }];
  for (const lam of LAMBDA_GRID) {
    list.push({ family: "nnls", lambda: lam });
    list.push({ family: "emos", lambda: lam });
  }
  return list.map((c) => {
    if (c.family === "mean") {
      return { ...c, fit: () => ({ u: { family: "mean" }, v: { family: "mean" } }) };
    }
    const fu = c.family === "nnls" ? solveNNLS(mu, c.lambda) : solveRidge(mu, c.lambda);
    const fv = c.family === "nnls" ? solveNNLS(mv, c.lambda) : solveRidge(mv, c.lambda);
    if (!fu || !fv) return null;
    return {
      ...c,
      fit: () => ({
        u: linearModel(c.family, fu, mu),
        v: linearModel(c.family, fv, mv)
      })
    };
  }).filter(Boolean);
}
function selectDirectionPair(su, sv) {
  if (!su.ok || !sv.ok) return null;
  const foldSE = /* @__PURE__ */ new Map();
  const folds = rollingFolds(su.fitIdx.length, CV_FOLDS);
  for (let f = 0; f < folds.length; f++) {
    const trEnd = folds[f].train;
    if (trEnd < Math.max(su.p, sv.p) * 12) continue;
    const cands = directionCandidates(su, sv, trEnd);
    const [vaStart, vaEnd] = folds[f].valid;
    for (let t = vaStart; t < vaEnd; t++) {
      const i = su.fitIdx[t];
      if (!finite(su.truthDir[i])) continue;
      if (!su.row(i) || !sv.row(i)) continue;
      for (const c of cands) {
        const fitted = c.fit();
        const mu = componentPredict(fitted.u, su, i);
        const mv = componentPredict(fitted.v, sv, i);
        if (!finite(mu) || !finite(mv)) continue;
        const err = circularAbs(toDir(mu, mv), su.truthDir[i]);
        const key = c.family + ":" + c.lambda;
        if (!foldSE.has(key)) foldSE.set(key, []);
        const arr = foldSE.get(key);
        if (arr.length <= f) arr.push([0, 0]);
        arr[f][0] += err;
        arr[f][1] += 1;
      }
    }
  }
  const table = [];
  for (const [key, per] of foldSE) {
    let sum = 0, n = 0;
    const fv = [];
    for (const [s, c] of per) {
      if (c < 8) continue;
      sum += s;
      n += c;
      fv.push(s / c);
    }
    if (n < 40 || fv.length < 2) continue;
    const j = key.indexOf(":");
    table.push({
      family: key.slice(0, j),
      lambda: key.slice(j + 1) === "null" ? null : Number(key.slice(j + 1)),
      cvAngle: sum / n,
      cvN: n,
      fv
    });
  }
  if (!table.length) return null;
  table.sort((a, b) => a.cvAngle - b.cvAngle || (b.lambda ?? 0) - (a.lambda ?? 0));
  const COMPLEXITY = { mean: 0, best: 1, nnls: 2, emos: 3 };
  const top = table[0];
  for (const c of table) {
    const diffs = [];
    for (let f = 0; f < top.fv.length; f++) {
      if (!c.fv[f] || !top.fv[f]) continue;
      diffs.push(c.fv[f] - top.fv[f]);
    }
    if (diffs.length < 2) {
      c.gap = 0;
      c.gapSe = Infinity;
      continue;
    }
    const m = diffs.reduce((s, v) => s + v, 0) / diffs.length;
    c.gap = m;
    c.gapSe = Math.sqrt(diffs.reduce((s, v) => s + (v - m) ** 2, 0) / (diffs.length - 1) / diffs.length);
  }
  const eligible = table.filter((c) => c.gap <= c.gapSe + 1e-12);
  eligible.sort((a, b) => COMPLEXITY[a.family] - COMPLEXITY[b.family] || (b.lambda ?? 0) - (a.lambda ?? 0) || a.cvAngle - b.cvAngle);
  const winner = eligible[0] || top;
  const all = directionCandidates(su, sv, su.fitRows.length).find((c) => c.family === winner.family && c.lambda === winner.lambda);
  const model = all ? all.fit() : { u: { family: "mean" }, v: { family: "mean" } };
  return { model, winner, table };
}
function directionSpecs(times, series, usable, crossVars, cols, fill, utcOffset, uObs, vObs, truthDir, trainIdx) {
  const subU = Object.fromEntries(usable.map((id) => [id, series[id].u]));
  const subV = Object.fromEntries(usable.map((id) => [id, series[id].v]));
  const mk = (target, sub) => makeSpec({
    times,
    obs: target,
    series: sub,
    modelIds: usable,
    cross: cols,
    crossFill: fill,
    utcOffset,
    forward: (x) => x,
    kind: "gauss"
  });
  const raw = { su: mk(uObs, subU), sv: mk(vObs, subV), truthDir };
  for (const key of ["su", "sv"]) {
    const spec = raw[key];
    spec.truthDir = truthDir;
    spec.fitRows = [];
    spec.fitY = [];
    spec.fitIdx = [];
    spec.ok = true;
    for (const i of trainIdx) {
      const y = spec.obs[i];
      const row = spec.row(i);
      if (!finite(y) || !finite(truthDir[i]) || !row) continue;
      spec.fitRows.push(row);
      spec.fitY.push(y);
      spec.fitIdx.push(i);
    }
    if (spec.fitRows.length < spec.p * 12) spec.ok = false;
  }
  return raw;
}

// src/engine/daily-accumulation.ts
function dailyAccumulation(spec, predict, testIdx, obs, inverse) {
  const days = /* @__PURE__ */ new Map();
  for (let k = 0; k < testIdx.length; k++) {
    const i = testIdx[k];
    const day = spec.times[i].slice(0, 10);
    if (!days.has(day)) days.set(day, { pred: [], obs: [] });
    const p = predict(i);
    const rec = days.get(day);
    rec.pred.push(finite(p) ? inverse(p) : null);
    rec.obs.push(obs[i]);
  }
  const rows = [];
  for (const [day, r] of days) {
    const p = r.pred.filter(finite), o = r.obs.filter(finite);
    if (p.length < 20 || o.length < 20) continue;
    rows.push({ day, pred: p.reduce((s, v) => s + v, 0), obs: o.reduce((s, v) => s + v, 0) });
  }
  if (rows.length < 5) return null;
  const events = {};
  for (const th of [10, 25, 50, 100]) events[th] = eventScores(rows.map((r) => r.pred), rows.map((r) => r.obs), th);
  return {
    days: rows.length,
    meanPred: round(meanS(rows.map((r) => r.pred)), 1),
    meanObs: round(meanS(rows.map((r) => r.obs)), 1),
    bias: round(meanS(rows.map((r) => r.pred - r.obs)), 1),
    ...pointScores(rows.map((r) => r.pred), rows.map((r) => r.obs)),
    events
  };
}

// src/engine/calibration.ts
function calibrationBundle(sel, spec, usable, crossVars, crossFill, sg, kind) {
  const labels = ["mean", "spread", ...usable, ...crossVars, "sinHour", "cosHour", "sinYear", "cosYear"];
  const sigma = { alpha: round(sg.alpha, 8), beta: round(sg.beta, 8) };
  if (sg.template) sigma.template = sg.template.map((v) => round(v, 5));
  if (sg.mult && Math.abs(sg.mult - 1) > 1e-4) sigma.mult = round(sg.mult, 5);
  if (sel.model.family === "emos" || sel.model.family === "nnls") {
    const m = sel.model;
    return {
      family: sel.model.family,
      kind,
      intercept: round(m.b0, 6),
      beta: m.beta.map((v) => round(v, 6)),
      centre: m.mu.map((v) => round(v, 6)),
      scale: m.sd.map((v) => round(v, 6)),
      modelIds: usable,
      crossVars,
      crossMean: crossFill.map((v) => round(v, 6)),
      sigma2: sigma,
      labels
    };
  }
  if (sel.model.family === "best") {
    return { family: "best", kind, singleModel: sel.model.singleModel, modelIds: usable, sigma2: sigma, labels };
  }
  return { family: "mean", kind, modelIds: usable, sigma2: sigma, labels };
}
function predictFromCalibration(calib, values, spread, hour, doy, crossVals) {
  if (calib.family === "emos" || calib.family === "nnls") {
    const row = [values.mean, spread];
    for (let j = 0; j < calib.modelIds.length; j++) row.push(finite(values.byId[j]) ? values.byId[j] : values.mean);
    for (let j = 0; j < (calib.crossVars || []).length; j++) {
      const v = crossVals ? crossVals[j] : null;
      row.push(finite(v) ? v : calib.crossMean ? calib.crossMean[j] : 0);
    }
    row.push(Math.sin(2 * Math.PI * hour / 24), Math.cos(2 * Math.PI * hour / 24));
    row.push(Math.sin(2 * Math.PI * doy / 365.25), Math.cos(2 * Math.PI * doy / 365.25));
    const SD = calib.scale || calib.beta.map(() => 1);
    let mu = calib.intercept;
    for (let j = 0; j < calib.beta.length; j++) {
      mu += calib.beta[j] * ((row[j] - calib.centre[j]) / SD[j]);
    }
    return mu;
  }
  if (calib.family === "best") {
    const j = calib.modelIds.indexOf(calib.singleModel);
    return j >= 0 && finite(values.byId[j]) ? values.byId[j] : values.mean;
  }
  return values.mean;
}

// src/engine/scalar-evaluation.ts
function evaluateScalar(opts) {
  const { times, obs, series, variable, lead, trainEnd, testStart, purgeDays, utcOffset, modelNames, crossVars, cross, vspec, base, usable, trainIdx, testIdx } = opts;
  const forward = FORWARD[vspec.kind], inverse = INVERSE[vspec.kind];
  const { cols, fill } = buildCrossFill(times, crossVars, cross, trainIdx);
  const sub = Object.fromEntries(usable.map((id) => [id, series[id]]));
  const spec = makeSpec({ times, obs, series: sub, modelIds: usable, cross: cols, crossFill: fill, utcOffset, forward, kind: vspec.kind });
  const sel = selectModel(spec, trainIdx, inverse, forward);
  if (!sel) return { ...base, usable: false, note: "kh\xF4ng t\u1EA1o \u0111\u01B0\u1EE3c b\u1ED9 d\u1EF1 b\xE1o" };
  const predict = (i) => {
    if (sel.model.family === "mean") return spec.mean[i];
    if (sel.model.family === "best") return spec.vals[usable.indexOf(sel.model.singleModel)][i];
    const row = spec.row(i);
    return row ? applyLinear(sel.model, row) : null;
  };
  const spreadSq = [], sq = [];
  for (const i of trainIdx) {
    const p = predict(i);
    if (!finite(p)) continue;
    spreadSq.push(spec.spread[i] ** 2);
    sq.push((p - forward(obs[i])) ** 2);
  }
  const sg = sigma2(spreadSq, sq);
  const sdOf = (i) => Math.sqrt(Math.max(sg.alpha + sg.beta * spec.spread[i] ** 2, 0));
  const zResid = [];
  for (const i of trainIdx) {
    const p = predict(i);
    if (!finite(p)) continue;
    const e = inverse(p) - obs[i];
    const s = sdOf(i) * jacobian(vspec.kind, p);
    if (finite(e) && s > 1e-6) zResid.push(e / s);
  }
  const zAbs = zResid.map((v) => Math.abs(v));
  let obsZeros = 0, obsSeen = 0;
  for (const i of trainIdx) {
    const v = obs[i];
    if (!finite(v)) continue;
    obsSeen++;
    if (v <= 0) obsZeros++;
  }
  const asymmetric = obsSeen > 0 && obsZeros / obsSeen > 0.5;
  const template = residualTemplate(zResid, !asymmetric);
  const zSorted = zResid.filter(finite).sort((a, b) => a - b);
  const bandCover = (k) => {
    if (zSorted.length < 200) return null;
    const base2 = template || Z_NODES;
    const nodes = base2.map((v) => v * k).sort((a, b) => a - b);
    const loZ = nodes[Math.floor(0.1 * K_MEMBERS)];
    const hiZ = nodes[Math.ceil(0.9 * K_MEMBERS) - 1];
    const q25 = nodes[Math.floor(0.25 * K_MEMBERS)];
    const q75 = nodes[Math.ceil(0.75 * K_MEMBERS) - 1];
    const above = (v) => {
      let a = 0, b = zSorted.length;
      while (a < b) {
        const m = a + b >> 1;
        if (zSorted[m] < v) a = m + 1;
        else b = m;
      }
      return a;
    };
    return {
      wide: (above(hiZ) - above(loZ)) / zSorted.length,
      mid: (above(q75) - above(q25)) / zSorted.length
    };
  };
  let mult = 1;
  if (template) {
    const score = (k) => {
      const c = bandCover(k);
      return c === null ? null : Math.min(c.wide / 0.8, c.mid / 0.5);
    };
    let lo2 = 0.25, hi2 = 6;
    const wide = score(hi2);
    if (wide !== null && wide >= 1) {
      for (let it = 0; it < 26; it++) {
        const mid = Math.sqrt(lo2 * hi2);
        const c = score(mid);
        if (c !== null && c >= 1) hi2 = mid;
        else lo2 = mid;
      }
      mult = hi2;
    } else if (wide !== null) {
      mult = 6;
    }
  }
  sg.template = template;
  sg.mult = mult;
  const lo = vspec.kind === "logit" ? 0 : vspec.kind === "log1p" ? 0 : null;
  const hi = vspec.kind === "logit" ? 100 : null;
  const memberSets = testIdx.map((i) => {
    const p = predict(i);
    return finite(p) ? pseudoMembers({ kind: vspec.kind, mu: p, sd: sdOf(i), lo, hi, template, mult }) : null;
  });
  const medians = memberSets.map((m) => m ? quantile2(m, 0.5) : null);
  const means = memberSets.map((m) => m ? meanS(m) : null);
  const testObs = testIdx.map((i) => obs[i]);
  const equalMean = testIdx.map((i) => spec.mean[i]);
  const persistOffset = 24 * lead;
  const persistence = testIdx.map((i, k) => k - persistOffset >= 0 ? obs[testIdx[k - persistOffset]] : null);
  const sqEqual = equalMean.map((v, k) => finite(v) ? (v - testObs[k]) ** 2 : null);
  const sqModel = means.map((v, k) => finite(v) ? (v - testObs[k]) ** 2 : null);
  const sqBest = testIdx.map((i) => {
    const j = usable.indexOf(sel.bestSingle.id);
    const v = j >= 0 ? series[usable[j]][i] : null;
    return finite(v) ? (v - obs[i]) ** 2 : null;
  });
  const thresholds = vspec.thresholds || [];
  const events = {};
  for (const th of thresholds) {
    const probs = memberSets.map((m) => m ? m.filter((v) => v <= th).length / m.length : null);
    const clim = trainIdx.length ? trainIdx.filter((i) => obs[i] >= th).length / trainIdx.length : null;
    events[th] = {
      median: eventScores(medians, testObs, th),
      equalMean: eventScores(equalMean, testObs, th),
      probability: probScores(probs, testObs, th, clim)
    };
  }
  return {
    ...base,
    usable: true,
    selected: {
      family: sel.family,
      lambda: sel.winner.lambda,
      cvRmse: round(sel.winner.cvRmse, 5),
      cvN: sel.winner.cvN,
      cvStandardError: round(sel.cvStandardError, 5),
      cvGap: round(sel.cvGap, 5),
      withinOneSE: sel.cvGap <= sel.cvStandardError + 1e-12,
      bestCvFamily: sel.table[0].family,
      bestCvRmse: round(sel.table[0].cvRmse, 5)
    },
    candidates: sel.table.map((c) => ({
      family: c.family,
      lambda: c.lambda,
      cvRmse: round(c.cvRmse, 5),
      cvN: c.cvN,
      cvGap: round(c.gap, 5),
      cvGapSe: round(c.gapSe, 5),
      chosen: c.family === sel.winner.family && c.lambda === sel.winner.lambda,
      fitted: c.family === sel.family && c.lambda === sel.winner.lambda
    })),
    calibration: calibrationBundle(sel, spec, usable, crossVars, fill.map((f) => forward(f)), sg, vspec.kind),
    bestSingle: { id: sel.bestSingle.id, name: modelNames[sel.bestSingle.id] || null, test: pointScores(testIdx.map((i) => {
      const j = usable.indexOf(sel.bestSingle.id);
      return j >= 0 ? series[usable[j]][i] : null;
    }), testObs) },
    models: usable.map((id) => ({ id, name: modelNames[id] || id, ...pointScores(testIdx.map((i) => series[id][i]), testObs) })),
    equalMean: pointScores(equalMean, testObs),
    persistence: pointScores(persistence, testObs),
    median: pointScores(medians, testObs),
    mean: pointScores(means, testObs),
    probabilistic: probEnsembleScores(memberSets, testObs),
    events,
    daily: vspec.accum ? dailyAccumulation(spec, predict, testIdx, obs, inverse) : null,
    bootstrap: {
      vsEqualMean: pairedBootstrap(sqEqual, sqModel, 48, 800, 20250101 + lead),
      vsBestSingle: pairedBootstrap(sqBest, sqModel, 48, 800, 777 + lead)
    }
  };
}

// src/engine/direction-evaluation.ts
function evaluateDirection(opts) {
  const { times, series, obsSpeed, obsDirection, variable, lead, trainEnd, testStart, purgeDays, utcOffset, modelNames, crossVars, cross, vspec, base, usable, trainIdx, testIdx } = opts;
  const uObs = new Array(times.length), vObs = new Array(times.length);
  const truthDir = new Array(times.length);
  for (let i = 0; i < times.length; i++) {
    if (!finite(obsSpeed[i]) || !finite(obsDirection[i])) {
      uObs[i] = null;
      vObs[i] = null;
      truthDir[i] = null;
      continue;
    }
    const r = obsDirection[i] * Math.PI / 180;
    uObs[i] = obsSpeed[i] * Math.cos(r);
    vObs[i] = obsSpeed[i] * Math.sin(r);
    truthDir[i] = obsDirection[i];
  }
  const { cols, fill } = buildCrossFill(times, crossVars, cross, trainIdx);
  const built = directionSpecs(times, series, usable, crossVars, cols, fill, utcOffset, uObs, vObs, truthDir, trainIdx);
  const su = built.su, sv = built.sv;
  const sel = selectDirectionPair(su, sv);
  if (!sel) return { ...base, usable: false, note: "kh\xF4ng t\u1EA1o \u0111\u01B0\u1EE3c b\u1ED9 d\u1EF1 b\xE1o h\u01B0\u1EDBng gi\xF3" };
  const pu = (i) => componentPredict2(sel.model.u, su, i);
  const pv = (i) => componentPredict2(sel.model.v, sv, i);
  const testSpeed = testIdx.map((i) => obsSpeed[i]);
  const testDir = testIdx.map((i) => obsDirection[i]);
  const uArr = testIdx.map(pu), vArr = testIdx.map(pv);
  const predSpeed = uArr.map((u, k) => finite(u) && finite(vArr[k]) ? toSpeed(u, vArr[k]) : null);
  const predDir = uArr.map((u, k) => finite(u) && finite(vArr[k]) ? toDir(u, vArr[k]) : null);
  const circErr = [], vecSq = [];
  for (let k = 0; k < testIdx.length; k++) {
    if (!finite(predDir[k]) || !finite(testDir[k])) continue;
    circErr.push(circularAbs(predDir[k], testDir[k]));
    const r = testDir[k] * Math.PI / 180;
    const du = predSpeed[k] * Math.cos(predDir[k] * Math.PI / 180) - testSpeed[k] * Math.cos(r);
    const dv = predSpeed[k] * Math.sin(predDir[k] * Math.PI / 180) - testSpeed[k] * Math.sin(r);
    vecSq.push(du * du + dv * dv);
  }
  const cnt = circErr.length;
  return {
    ...base,
    usable: true,
    method: "Hai h\u1ED3i quy ri\xEAng tr\xEAn th\xE0nh ph\u1EA7n u v\xE0 v c\u1EE7a gi\xF3, sau \u0111\xF3 gh\xE9p th\xE0nh t\u1ED1c \u0111\u1ED9 v\xE0 h\u01B0\u1EDBng. Kh\xF4ng h\u1ED3i quy tr\u1EF1c ti\u1EBFp l\xEAn \u0111\u1ED9. T\u1ED1c \u0111\u1ED9 gi\xF3 \u0111\u01B0\u1EE3c ch\u1EA5m ri\xEAng \u1EDF bi\u1EBFn wind_speed_10m.",
    selected: {
      family: sel.winner.family,
      lambda: sel.winner.lambda,
      cvAngle: round(sel.winner.cvAngle, 4),
      cvN: sel.winner.cvN,
      cvStandardError: round(sel.winner.gapSe ?? 0, 4),
      cvGap: round(sel.winner.gap ?? 0, 4),
      withinOneSE: (sel.winner.gap ?? 0) <= (sel.winner.gapSe ?? 0) + 1e-12,
      bestCvFamily: sel.table[0].family,
      bestCvAngle: round(sel.table[0].cvAngle, 4),
      shared: true
    },
    candidates: sel.table.map((c) => ({
      family: c.family,
      lambda: c.lambda,
      cvAngle: round(c.cvAngle, 4),
      cvN: c.cvN,
      cvGap: round(c.gap, 4),
      cvGapSe: round(c.gapSe === Infinity ? null : c.gapSe, 4),
      chosen: c.family === sel.winner.family && c.lambda === sel.winner.lambda
    })),
    calibration: {
      family: sel.winner.family,
      modelIds: usable,
      components: 2,
      sigma2: { alpha: 0, beta: 0 },
      labels: ["mean", "spread", ...usable, ...crossVars, "sinHour", "cosHour", "sinYear", "cosYear"],
      u: calibrationBundle({ model: sel.model.u, winner: { family: sel.winner.family, lambda: sel.winner.lambda, cvRmse: sel.winner.cvAngle } }, su, usable, crossVars, fill, { alpha: 0, beta: 0 }, "gauss"),
      v: calibrationBundle({ model: sel.model.v, winner: { family: sel.winner.family, lambda: sel.winner.lambda, cvRmse: sel.winner.cvAngle } }, sv, usable, crossVars, fill, { alpha: 0, beta: 0 }, "gauss")
    },
    vectorSpeed: pointScores(predSpeed, testSpeed),
    direction: {
      n: cnt,
      circularMae: cnt ? circErr.reduce((s, v) => s + v, 0) / cnt : null,
      within30: cnt ? circErr.filter((v) => v <= 30).length / cnt : null,
      within45: cnt ? circErr.filter((v) => v <= 45).length / cnt : null,
      vectorRmse: vecSq.length ? Math.sqrt(vecSq.reduce((s, v) => s + v, 0) / vecSq.length) : null
    }
  };
}
function componentPredict2(model, spec, i) {
  if (model.family === "mean") return spec.mean[i];
  const row = spec.row(i);
  return row ? applyLinear(model, row) : null;
}

// src/engine/regime.ts
var REGIME_EDGES = [
  [20, 50, 80, 95],
  // cloud cover %
  [0.05, 0.5, 2, 5, 10],
  // precipitation mm/h
  [5, 12, 20, 32],
  // wind speed km/h
  [10, 20, 26, 32],
  // apparent temperature °C
  [45, 65, 80, 92]
  // relative humidity %
];
var REGIME_MIN_SUPPORT = 12;
function regimeKey(row, edges = REGIME_EDGES) {
  let key = "";
  for (let j = 0; j < edges.length; j++) {
    const v = row[j];
    if (!finite(v)) return null;
    let b = 0;
    while (b < edges[j].length && v >= edges[j][b]) b++;
    key += b;
  }
  return key;
}
function condGroup(c) {
  if (c === 0) return 0;
  if (c <= 3) return 1;
  if (c <= 48) return 2;
  if (c <= 57) return 3;
  if (c <= 67) return 4;
  if (c <= 77) return 5;
  if (c <= 82) return 6;
  if (c <= 86) return 7;
  return 8;
}
var CONDITIONS = [
  "Tr\u1EDDi quang",
  "C\xF3 m\xE2y",
  "S\u01B0\u01A1ng m\xF9",
  "M\u01B0a ph\xF9n",
  "C\xF3 m\u01B0a",
  "C\xF3 tuy\u1EBFt",
  "M\u01B0a r\xE0o",
  "Tuy\u1EBFt r\xE0o",
  "C\xF3 d\xF4ng"
];
function conditionOf(c) {
  return finite(c) && c >= 0 && c <= 99 ? CONDITIONS[condGroup(Math.round(c))] : "Ch\u01B0a c\xF3 th\xF4ng tin";
}

// src/engine/code-evaluation.ts
function evaluateCode(opts) {
  const { times, obs, codeFeatures, variable, lead, trainEnd, testStart, purgeDays, utcOffset, modelNames, crossVars, cross, vspec, base, usable, trainIdx, testIdx } = opts;
  const feats = codeFeatures;
  if (!feats || !feats.length) return { ...base, usable: false, note: "thi\u1EBFu tr\u01B0\u1EDDng li\xEAn t\u1EE5c cho b\u1ED9 ph\xE2n lo\u1EA1i m\xE3 th\u1EDDi ti\u1EBFt" };
  const n = times.length;
  const Z = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!feats.every((f) => finite(f[i]))) continue;
    Z[i] = feats.map((f) => f[i]);
  }
  const fitRows = trainIdx.filter((i) => Z[i] && finite(obs[i]));
  if (fitRows.length < 400) return { ...base, usable: false, note: "kh\xF4ng \u0111\u1EE7 m\u1EABu \u0111\u1EC3 ph\xE2n lo\u1EA1i m\xE3 th\u1EDDi ti\u1EBFt" };
  const mu = feats.map((_, j) => meanS(fitRows.map((i) => Z[i][j])));
  const sg = feats.map((_, j) => sdS(fitRows.map((i) => Z[i][j])) || 1);
  const bank = fitRows.slice(-2400).map((i) => ({ x: Z[i].map((v, j) => (v - mu[j]) / sg[j]), c: obs[i] }));
  const K = 45;
  const predict = (x) => {
    const dist = new Array(bank.length);
    for (let b = 0; b < bank.length; b++) {
      let s = 0;
      for (let j = 0; j < x.length; j++) {
        const d = x[j] - bank[b].x[j];
        s += d * d;
      }
      dist[b] = s;
    }
    const idx = dist.map((d, b) => [d, b]).sort((a, b) => a[0] - b[0]).slice(0, K);
    const tally = /* @__PURE__ */ new Map();
    for (const [, b] of idx) {
      const c = bank[b].c;
      tally.set(c, (tally.get(c) || 0) + 1 / (Math.sqrt(dist[b]) + 0.05));
    }
    let best = null, bestW = -1;
    for (const [c, w] of tally) if (w > bestW) {
      bestW = w;
      best = c;
    }
    return best;
  };
  const pred = [], truth = [];
  const predAt = /* @__PURE__ */ new Map();
  for (const i of testIdx) {
    if (!Z[i] || !finite(obs[i])) continue;
    const p = predict(Z[i].map((v, j) => (v - mu[j]) / sg[j]));
    pred.push(p);
    predAt.set(i, p);
    truth.push(obs[i]);
  }
  let exact = 0, group = 0;
  for (let k = 0; k < pred.length; k++) {
    if (pred[k] === truth[k]) {
      exact++;
      group++;
    } else if (condGroup(pred[k]) === condGroup(truth[k])) group++;
  }
  const regime = {};
  for (const i of fitRows) {
    const key = regimeKey(Z[i], REGIME_EDGES);
    if (!key) continue;
    const e = regime[key] || (regime[key] = { total: 0, codes: {} });
    e.total++;
    e.codes[obs[i]] = (e.codes[obs[i]] || 0) + 1;
  }
  const table = [];
  for (const key of Object.keys(regime)) {
    const e = regime[key];
    if (e.total < REGIME_MIN_SUPPORT) continue;
    let best = null, bestN = -1;
    for (const c of Object.keys(e.codes)) {
      const n2 = e.codes[+c];
      if (n2 > bestN) {
        bestN = n2;
        best = +c;
      }
    }
    table.push({ key, code: best, support: e.total, purity: bestN / e.total });
  }
  let lkExact = 0, lkGroup = 0, lkN = 0;
  let knnExact = 0, knnGroup = 0;
  const fullTable = {};
  for (const row of table) fullTable[row.key] = row.code;
  let scorable = 0;
  for (const i of testIdx) {
    if (!Z[i] || !finite(obs[i])) continue;
    scorable++;
    const key = regimeKey(Z[i], REGIME_EDGES);
    if (!key || !(key in fullTable)) continue;
    lkN++;
    if (fullTable[key] === obs[i]) {
      lkExact++;
      lkGroup++;
    } else if (condGroup(fullTable[key]) === condGroup(obs[i])) lkGroup++;
    const kp = predAt.get(i);
    if (kp === obs[i]) {
      knnExact++;
      knnGroup++;
    } else if (condGroup(kp) === condGroup(obs[i])) knnGroup++;
  }
  table.sort((a, b) => a.key.localeCompare(b.key));
  return {
    ...base,
    usable: true,
    method: "Ph\xE2n lo\u1EA1i theo v\xF9ng kh\xF4ng g\u1EA7n nh\u1EA5t tr\xEAn 5 tr\u01B0\u1EDDng li\xEAn t\u1EE5c: ph\u1EE7 m\xE2y, m\u01B0a, gi\xF3, c\u1EA3m gi\xE1c nhi\u1EC7t, \u0111\u1ED9 \u1EA9m. Kh\xF4ng h\u1ED3i quy tr\u1EF1c ti\u1EBFp l\xEAn m\xE3 WMO.",
    selected: { family: "knn", lambda: null, cvRmse: null, cvN: fitRows.length },
    testN: pred.length,
    accuracy: pred.length ? exact / pred.length : null,
    accuracyGroup: pred.length ? group / pred.length : null,
    baseRate: truth.length ? new Set(truth).size / truth.length : null,
    regime: {
      fields: ["cloud_cover", "precipitation", "wind_speed_10m", "apparent_temperature", "relative_humidity_2m"],
      modelIds: usable && usable.length ? usable.slice() : null,
      edges: REGIME_EDGES.map((e) => e.slice()),
      minSupport: REGIME_MIN_SUPPORT,
      cells: table,
      lookupN: lkN,
      coverage: scorable ? lkN / scorable : null,
      accuracy: lkN ? lkExact / lkN : null,
      accuracyGroup: lkN ? lkGroup / lkN : null,
      knnAccuracySameRows: lkN ? knnExact / lkN : null,
      knnAccuracyGroupSameRows: lkN ? knnGroup / lkN : null
    }
  };
}

// src/engine/evaluation-entry.ts
function evaluate(opts) {
  const vspec = VARIABLES[opts.variable];
  if (!vspec) throw new Error("bi\u1EBFn kh\xF4ng h\u1EE3p l\u1EC7: " + opts.variable);
  const { times, obs, series, variable } = opts;
  const n = times.length;
  const dateOf = (i) => times[i].slice(0, 10);
  const modelIds = Object.keys(series);
  const coverage = {};
  let window = 0;
  for (let i = 0; i < n; i++) if (dateOf(i) <= opts.trainEnd) window++;
  for (const id of modelIds) {
    const col = series[id];
    const at = Array.isArray(col) ? (i) => col[i] : (i) => col.u ? col.u[i] : null;
    let ok = 0;
    for (let i = 0; i < n; i++) if (dateOf(i) <= opts.trainEnd && finite(at(i))) ok++;
    coverage[id] = window ? ok / window : 0;
  }
  const usable = vspec.kind === "code" ? [] : modelIds.filter((id) => coverage[id] >= 0.97);
  const truthAt = vspec.kind === "direction" || vspec.kind === "code" ? variable === "weather_code" ? Array.isArray(obs) ? (i) => finite(obs[i]) : () => false : opts.obsSpeed ? (i) => finite(opts.obsSpeed[i]) && finite(opts.obsDirection[i]) : () => false : Array.isArray(obs) ? (i) => finite(obs[i]) : () => false;
  const complete = (i) => {
    if (vspec.kind === "code") return truthAt(i);
    for (const id of usable) {
      const col = series[id];
      const colAt = Array.isArray(col) ? col[i] : col.u[i];
      if (colAt == null || !finite(colAt)) return false;
    }
    return truthAt(i);
  };
  const trainIdx = [], testIdx = [];
  let eligibleTest = 0;
  for (let i = 0; i < n; i++) {
    const after = dateOf(i) >= opts.testStart;
    if (after) eligibleTest++;
    if (!after) continue;
    if (complete(i)) testIdx.push(i);
  }
  for (let i = 0; i < n; i++) if (dateOf(i) <= opts.trainEnd && complete(i)) trainIdx.push(i);
  const base = {
    variable,
    lead: opts.lead,
    unit: vspec.unit,
    kind: vspec.kind,
    group: vspec.group,
    label: vspec.label,
    short: vspec.short,
    digits: vspec.digits,
    models: usable.map((id) => opts.modelNames?.[id] || id),
    modelIds: usable,
    coverage: round(coverage, 4),
    trainingN: trainIdx.length,
    testN: testIdx.length,
    coverageTest: eligibleTest ? testIdx.length / eligibleTest : null,
    purgeDays: opts.purgeDays ?? null
  };
  if (!usable.length && vspec.kind !== "code") return { ...base, usable: false, note: "kh\xF4ng m\xF4 h\xECnh n\xE0o ph\u1EE7 \u0111\u1EE7 bi\u1EBFn n\xE0y" };
  if (trainIdx.length < 500) return { ...base, usable: false, note: "qu\xE1 \xEDt gi\u1EDD hu\u1EA5n luy\u1EC7n" };
  if (testIdx.length < 48) return { ...base, usable: false, note: "kh\xF4ng \u0111\u1EE7 gi\u1EDD ki\u1EC3m tra chung" };
  if (vspec.kind === "direction") return evaluateDirection({ ...opts, vspec, crossVars: opts.crossVars || [], cross: opts.cross || {}, base, usable, trainIdx, testIdx });
  if (vspec.kind === "code") return evaluateCode({ ...opts, vspec, crossVars: opts.crossVars || [], cross: opts.cross || [], base, usable, trainIdx, testIdx });
  return evaluateScalar({ ...opts, vspec, crossVars: opts.crossVars || [], cross: opts.cross || {}, usable, trainIdx, testIdx, base });
}

// src/engine/live-calibration.ts
function calibrate(opts) {
  const { times, variable, series, calib, utcOffset = 0, cross } = opts;
  const vspec = VARIABLES[variable];
  if (!vspec || !calib) return null;
  const forward = FORWARD[vspec.kind], inverse = INVERSE[vspec.kind];
  const ids = calib.modelIds || Object.keys(series);
  const vals = ids.map((id) => (series[id] || []).map((v) => finite(v) ? forward(v) : null));
  const crossCols = (calib.crossVars || []).map((v) => {
    const src = cross && cross[v] || [];
    return src.map((x) => finite(x) ? forward(x) : null);
  });
  const lo = vspec.kind === "logit" ? 0 : vspec.kind === "log1p" ? 0 : null;
  const hi = vspec.kind === "logit" ? 100 : null;
  const out = new Array(times.length);
  for (let i = 0; i < times.length; i++) {
    let s = 0, s2 = 0, c = 0;
    const byId = new Array(ids.length).fill(null);
    for (let j = 0; j < vals.length; j++) if (finite(vals[j][i])) {
      byId[j] = vals[j][i];
      s += vals[j][i];
      s2 += vals[j][i] ** 2;
      c++;
    }
    const need = Math.max(2, Math.ceil(ids.length * 0.6));
    if (c < need) {
      out[i] = null;
      continue;
    }
    const mean = s / c;
    const spread = c > 1 ? Math.sqrt(Math.max(0, s2 / c - mean * mean)) : 0;
    const mu = predictFromCalibration(calib, { mean, byId }, spread, hourOf(times, i, utcOffset), dayOfYear(times, i), crossCols.map((col) => col[i]));
    if (!finite(mu)) {
      out[i] = null;
      continue;
    }
    const sd = Math.sqrt(Math.max(calib.sigma2.alpha + calib.sigma2.beta * spread * spread, 0));
    const mem = pseudoMembers({ kind: vspec.kind, mu, sd, lo, hi, template: calib.sigma2.template, mult: calib.sigma2.mult });
    const rec = {
      mean: meanS(mem),
      median: quantile2(mem, 0.5),
      p02: quantile2(mem, 0.02),
      p10: quantile2(mem, 0.1),
      p25: quantile2(mem, 0.25),
      p75: quantile2(mem, 0.75),
      p90: quantile2(mem, 0.9),
      p98: quantile2(mem, 0.98),
      low: mem[0],
      high: mem[K_MEMBERS - 1],
      sd,
      spread,
      nModels: c,
      sdPhysical: sdS(mem) ?? null
    };
    if (vspec.thresholds) {
      rec.probs = {};
      for (const th of vspec.thresholds) rec.probs[th] = mem.filter((v) => v <= th).length / mem.length;
    }
    out[i] = rec;
  }
  return out;
}
function calibrateDirection(opts) {
  const { times, seriesU, seriesV, calibration, utcOffset = 0 } = opts;
  if (!calibration?.u || !calibration?.v) return null;
  if (calibration.u.family === "mean" && calibration.v.family === "mean") {
  }
  const ids = calibration.u.modelIds || Object.keys(seriesU);
  const applyComponent = (which) => {
    const c = calibration[which];
    const src = which === "u" ? seriesU : seriesV;
    const out2 = new Array(times.length).fill(null);
    const cols = ids.map((id) => src[id] || []);
    const need = Math.max(2, Math.ceil(ids.length * 0.6));
    for (let i = 0; i < times.length; i++) {
      let s = 0, s2 = 0, n = 0;
      for (const col of cols) if (finite(col[i])) {
        s += col[i];
        s2 += col[i] ** 2;
        n++;
      }
      if (n < need) continue;
      const mean = s / n;
      const spread = Math.sqrt(Math.max(0, s2 / n - mean * mean));
      let mu;
      if (c.family === "mean" || !c.beta) {
        mu = mean;
      } else {
        const row = [mean, spread];
        for (const col of cols) row.push(finite(col[i]) ? col[i] : mean);
        for (let j = 0; j < (c.crossVars || []).length; j++) row.push(finite(c.crossMean?.[j]) ? c.crossMean[j] : 0);
        row.push(Math.sin(2 * Math.PI * hourOf(times, i, utcOffset) / 24));
        row.push(Math.cos(2 * Math.PI * hourOf(times, i, utcOffset) / 24));
        row.push(Math.sin(2 * Math.PI * dayOfYear(times, i) / 365.25));
        row.push(Math.cos(2 * Math.PI * dayOfYear(times, i) / 365.25));
        mu = c.intercept;
        const SDC = c.scale || c.beta.map(() => 1);
        for (let j = 0; j < c.beta.length; j++) mu += c.beta[j] * ((row[j] - c.centre[j]) / SDC[j]);
      }
      if (finite(mu)) out2[i] = { mu, nModels: n };
    }
    return out2;
  };
  const cu = applyComponent("u"), cv = applyComponent("v");
  const out = new Array(times.length).fill(null);
  for (let i = 0; i < times.length; i++) {
    if (!cu[i] || !cv[i]) continue;
    out[i] = {
      mean: toSpeed(cu[i].mu, cv[i].mu),
      median: toSpeed(cu[i].mu, cv[i].mu),
      dir: toDir(cu[i].mu, cv[i].mu),
      nModels: cu[i].nModels
    };
  }
  return out;
}
function calibrateCode(opts) {
  const { times, series, regime } = opts;
  if (!regime?.cells?.length) return null;
  const ids = (regime.modelIds || Object.keys(series)).filter((id) => series[id]);
  const fields = regime.fields || [
    "cloud_cover",
    "precipitation",
    "wind_speed_10m",
    "apparent_temperature",
    "relative_humidity_2m"
  ];
  const lookup = new Map(regime.cells.map((c) => [c.key, c.code]));
  const need = 1;
  const out = new Array(times.length).fill(null);
  for (let i = 0; i < times.length; i++) {
    const row = [];
    let n = 0;
    for (const f of fields) {
      let s = 0, c = 0;
      for (const id of ids) {
        const val = series[id]?.[f]?.[i];
        if (finite(val)) {
          s += val;
          c++;
        }
      }
      if (c < need) {
        row.length = 0;
        break;
      }
      row.push(s / c);
      n = c;
    }
    if (row.length !== fields.length) continue;
    const key = regimeKey(row, regime.edges);
    if (key === null) continue;
    const code = lookup.get(key);
    if (code === void 0) continue;
    out[i] = { code, nModels: n, condition: conditionOf(code) };
  }
  return out;
}

// src/engine/distance.ts
var EARTH_RADIUS_KM = 6371;
function distanceKm(a, b) {
  const R = EARTH_RADIUS_KM, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// src/engine/airmass.ts
function thickness(z500, z850) {
  if (!finite(z500) || !finite(z850)) return null;
  return z500 - z850;
}
function toUms(speedKmh, dirDeg) {
  if (!finite(speedKmh) || !finite(dirDeg)) return { u: null, v: null };
  const s = speedKmh / 3.6, r = dirDeg * Math.PI / 180;
  return { u: -s * Math.sin(r), v: -s * Math.cos(r) };
}
function offsetLatLon(lat, lon, dxKm, dyKm) {
  const dLat = dyKm / 111.32;
  const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
  const dLon = dxKm / (111.32 * cos);
  return { lat: lat + dLat, lon: lon + dLon };
}
function trajectory(opts) {
  const { lat, lon, u, v, hours = 24, stepKm = 25, sign = 1 } = opts;
  const n = Math.max(1, Math.round(hours));
  const legs = [{ lat, lon, hoursAgo: 0, speedKmh: null }];
  let cur = { lat, lon };
  for (let h = 1; h <= n; h++) {
    const i = Math.min(u.length, v.length) - h;
    if (i < 0) break;
    if (!finite(u[i]) || !finite(v[i])) break;
    const speed = Math.hypot(u[i], v[i]);
    if (speed < 0.1) break;
    const scale = stepKm * sign / speed;
    cur = offsetLatLon(cur.lat, cur.lon, u[i] * scale, v[i] * scale);
    legs.push({ lat: cur.lat, lon: cur.lon, hoursAgo: sign > 0 ? -h : h, speedKmh: speed * 3.6 });
  }
  return legs;
}
function bearingDeg(a, b) {
  const r = Math.PI / 180;
  const dLon = (b.lon - a.lon) * r, lat1 = a.lat * r, lat2 = b.lat * r;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function nearestOnTrack(pt, legs) {
  let best = null;
  for (let i = 0; i + 1 < legs.length; i++) {
    const a = legs[i], b = legs[i + 1];
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const p = { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
      const km = distanceKm(pt, p);
      if (!best || km < best.km) {
        best = { km, point: p, legIndex: i, frac: f, hoursAgo: a.hoursAgo + (b.hoursAgo - a.hoursAgo) * f };
      }
    }
  }
  return best;
}
function airMass(opts) {
  const { t850, t850Baseline, thick, thickBaseline, rh850, source } = opts;
  if (!finite(t850)) return null;
  const dT = finite(t850Baseline) ? t850 - t850Baseline : null;
  const dThick = finite(thick) && finite(thickBaseline) ? thick - thickBaseline : null;
  let tag = "\xD4n h\xF2a", tone = "neutral";
  if (finite(dT) && finite(dThick)) {
    if (dT <= -3 && dThick <= -60) {
      tag = "Kh\u1ED1i l\u1EA1nh";
      tone = "cold";
    } else if (dT >= 3 && dThick >= 60) {
      tag = "Kh\u1ED1i n\xF3ng";
      tone = "warm";
    } else if (dT <= -1.5) {
      tag = "H\u01A1i l\u1EA1nh";
      tone = "cool";
    } else if (dT >= 1.5) {
      tag = "H\u01A1i n\xF3ng";
      tone = "mild";
    }
  } else if (finite(dT)) {
    if (dT <= -3) {
      tag = "Kh\u1ED1i l\u1EA1nh";
      tone = "cold";
    } else if (dT >= 3) {
      tag = "Kh\u1ED1i n\xF3ng";
      tone = "warm";
    } else if (dT <= -1.5) {
      tag = "H\u01A1i l\u1EA1nh";
      tone = "cool";
    } else if (dT >= 1.5) {
      tag = "H\u01A1i n\xF3ng";
      tone = "mild";
    }
  }
  let advection = null;
  if (finite(source)) {
    advection = source >= 315 || source < 45 ? "B\u1EAFc" : source >= 45 && source < 135 ? "\u0110\xF4ng" : source >= 135 && source < 225 ? "Nam" : "T\xE2y";
  }
  const moisture = finite(rh850) ? rh850 >= 85 ? "\u1EA8m" : rh850 <= 45 ? "Kh\xF4" : "\u1EA8m v\u1EEBa" : null;
  return { tag, tone, dT: round(dT, 1), dThick: round(dThick, 1), t850: round(t850, 1), advection, moisture, rh850: round(rh850, 0) };
}
function frontalPassage(opts) {
  const { dir850, t850, hoursBack = 12 } = opts;
  const n = Math.min(dir850.length, t850.length);
  if (n < hoursBack + 2) return null;
  const i0 = n - 1, i1 = n - 1 - hoursBack;
  if (!finite(dir850[i0]) || !finite(dir850[i1]) || !finite(t850[i0]) || !finite(t850[i1])) return null;
  const shift = (dir850[i0] - dir850[i1] + 540) % 360 - 180;
  const dT = t850[i0] - t850[i1];
  if (shift >= 20 && dT <= -1) return { kind: "M\u1EB7t l\u1EA1nh", leadHours: hoursBack, windShift: round(shift, 0), dT: round(dT, 1) };
  if (shift <= -20 && dT >= 1) return { kind: "M\u1EB7t \u1EA5m", leadHours: hoursBack, windShift: round(shift, 0), dT: round(dT, 1) };
  return null;
}
function airMassGrid(opts) {
  const { lat, lon, radiusKm = 700, stepKm = 200, values } = opts;
  if (!Array.isArray(values) || !values.length) return { cells: [], mean: null, grid: 0 };
  const tAll = [], thAll = [];
  for (const v of values) {
    if (finite(v.t850)) tAll.push(v.t850);
    const th = thickness(v.z500, v.z850);
    if (finite(th)) thAll.push(th);
  }
  const tMean = meanS(tAll), thMean = meanS(thAll);
  const cells = [];
  const n = Math.ceil(radiusKm / stepKm);
  for (let iy = -n; iy <= n; iy++) {
    for (let ix = -n; ix <= n; ix++) {
      const dx = ix * stepKm, dy = iy * stepKm;
      if (Math.hypot(dx, dy) > radiusKm) continue;
      const p = offsetLatLon(lat, lon, dx, dy);
      cells.push({ lat: round(p.lat, 3), lon: round(p.lon, 3), km: round(Math.hypot(dx, dy), 0) });
    }
  }
  return { cells, mean: { t850: round(tMean, 2), thick: round(thMean, 1) }, grid: values.length };
}
function classifyCell(cell, mean, windDeg) {
  const tag = airMass({
    t850: cell.t850,
    t850Baseline: mean.t850,
    thick: cell.thick,
    thickBaseline: mean.thick,
    rh850: cell.rh850,
    source: windDeg
  });
  return tag ? { ...cell, ...tag, tone: tag.tone } : cell;
}

// src/engine/hydrology.ts
function riverRisk(opts) {
  const { q, qP25, qP75, recent } = opts;
  if (!finite(q)) return null;
  const band = finite(qP25) && finite(qP75) ? { p25: qP25, p75: qP75 } : null;
  let vsRecent = null;
  if (finite(recent) && recent > 0) vsRecent = (q - recent) / recent;
  let exceed = null;
  if (band && finite(recent) && recent > 0 && band.p25 > 0 && band.p75 > band.p25) {
    const f = (Math.log(recent) - Math.log(band.p25)) / (Math.log(band.p75) - Math.log(band.p25));
    exceed = round(clamp(1 - clamp(f, 0, 1), 0, 1), 2);
  }
  const rising = finite(vsRecent) ? vsRecent : null;
  return {
    q: round(q, 1),
    p25: band ? round(band.p25, 1) : null,
    p75: band ? round(band.p75, 1) : null,
    vsRecent: round(rising, 3),
    exceed,
    recent: round(recent, 1)
  };
}
var FLOOD_BANDS = [
  { at: 0.9, level: 0, key: "canh_bao", label: "C\u1EA3nh b\xE1o", tone: "low" },
  { at: 0.95, level: 1, key: "bd1", label: "B\xE1o \u0111\u1ED9ng 1", tone: "mid" },
  { at: 0.98, level: 2, key: "bd2", label: "B\xE1o \u0111\u1ED9ng 2", tone: "high" },
  { at: 0.995, level: 3, key: "bd3", label: "B\xE1o \u0111\u1ED9ng 3", tone: "severe" }
];
function quantileSorted(s, p) {
  if (!s.length) return null;
  return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)];
}
function floodLevels(opts) {
  const { history, qNow, qForecast, rating } = opts;
  const s = (history || []).filter((v) => finite(v) && v >= 0).sort((a, b) => a - b);
  if (s.length < 30) return null;
  const thresholds = FLOOD_BANDS.map((b) => {
    const q = quantileSorted(s, b.at);
    return {
      ...b,
      q: q !== null ? round(q, 1) : null,
      days: Math.max(1, s.length - Math.round(b.at * (s.length - 1))),
      h: rating ? nominalStage(q, rating.a, rating.b, rating.q0) : null
    };
  });
  let below = 0;
  if (finite(qNow)) {
    for (const v of s) {
      if (v <= qNow) below++;
      else break;
    }
  }
  const bandOf = (v) => {
    if (!finite(v)) return null;
    let hit = null;
    for (const b of thresholds) if (v >= b.q) hit = b;
    return hit;
  };
  const fc = (qForecast || []).filter((v) => finite(v));
  let peak = null, peakIn = null;
  for (let i = 0; i < fc.length; i++) if (peak === null || fc[i] > peak) {
    peak = fc[i];
    peakIn = i;
  }
  return {
    n: s.length,
    min: round(s[0], 1),
    max: round(s[s.length - 1], 1),
    mean: round(meanS(s), 1),
    p50: round(quantileSorted(s, 0.5), 1),
    thresholds,
    qNow: finite(qNow) ? round(qNow, 1) : null,
    percent: finite(qNow) ? round(below / s.length, 3) : null,
    rankFromTop: finite(qNow) ? s.length - below : null,
    now: bandOf(qNow),
    peakQ: peak === null ? null : round(peak, 1),
    peakInDays: peakIn,
    peakBand: bandOf(peak)
  };
}
function nominalStage(q, a, b, q0 = 100) {
  if (!finite(q) || !finite(a) || !finite(b) || !b) return null;
  if (q <= 0) return 0;
  return round(a * Math.pow(q / q0, b), 2);
}
function stageToQ(H, a, b, q0 = 100) {
  if (!finite(H) || !finite(a) || !finite(b) || !b) return null;
  if (H <= 0) return 0;
  return round(q0 * Math.pow(H / a, 1 / b), 1);
}

// src/engine/lightning.ts
var CAPE_REF = 2500;
var LI_LO = -6;
var LI_HI = 4;
var CIN_MAX = 200;
function lightningIndex(o) {
  if (!o) return null;
  const parts = {};
  if (finite(o.cape)) {
    parts.cape = clamp(Math.sqrt(Math.max(0, o.cape)) / Math.sqrt(CAPE_REF), 0, 1);
  }
  if (finite(o.liftedIndex)) {
    parts.li = clamp((LI_HI - o.liftedIndex) / (LI_HI - LI_LO), 0, 1);
  }
  if (finite(o.convectiveInhibition)) {
    parts.cin = clamp(1 - Math.max(0, o.convectiveInhibition) / CIN_MAX, 0.15, 1);
  }
  const W = { cape: 0.6, li: 0.25, cin: 0.15 };
  let sum = 0, wsum = 0;
  for (const k of ["cape", "li", "cin"]) {
    if (!finite(parts[k])) continue;
    sum += W[k] * Math.log(parts[k]);
    wsum += W[k];
  }
  if (!wsum) return null;
  const ingredients = ["cape", "li", "cin"].filter((k) => finite(parts[k]));
  return {
    risk: clamp(Math.exp(sum / wsum), 0, 1),
    ingredients,
    partial: ingredients.length < 3
  };
}
function spearman(a, b) {
  const pairs = [];
  for (let i = 0; i < a.length; i++) {
    if (finite(a[i]) && finite(b[i])) pairs.push([a[i], b[i]]);
  }
  const n = pairs.length;
  if (n < 5) return null;
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(vals.length);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(pairs.map((p) => p[0]));
  const rb = rank(pairs.map((p) => p[1]));
  const ma = meanS(ra), mb = meanS(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma, y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? clamp(num / Math.sqrt(da * db), -1, 1) : null;
}
function lightningVerify(rows, threshold) {
  const th = threshold ?? rows.threshold ?? 5;
  const rowsArr = Array.isArray(rows) ? rows : rows.rows;
  const clean = rowsArr.filter((r) => finite(r.risk) && finite(r.obs));
  if (clean.length < 50) return { n: clean.length, threshold: th, events: 0, baseRate: 0, warnAt: 0, warnings: 0, brier: 0, bss: 0, logLoss: 0, hitRate: null, falseAlarmRate: null, precision: null, meanProb: 0, spearman: 0, reliability: [], insufficient: true };
  let base = 0, n = 0;
  for (const r of clean) {
    n++;
    if (r.obs >= th) base++;
  }
  const baseRate = base / n;
  const warnAt = Math.min(0.95, baseRate);
  let hit = 0, fa = 0, miss = 0, sumSq = 0, sumLog = 0, sumRisk = 0;
  const bucket = Array.from({ length: 10 }, () => ({ n: 0, ev: 0 }));
  for (const r of clean) {
    const ev = r.obs >= th ? 1 : 0;
    const p = clamp(r.risk, 1e-6, 1 - 1e-6);
    sumRisk += p;
    sumSq += (p - ev) ** 2;
    sumLog += ev ? Math.log(p) : Math.log(1 - p);
    const warn = p >= warnAt ? 1 : 0;
    if (ev && warn) hit++;
    else if (ev) miss++;
    else if (warn) fa++;
    const b = Math.min(9, Math.max(0, Math.floor(p * 10)));
    bucket[b].n++;
    bucket[b].ev += ev;
  }
  const brier = sumSq / n;
  const bss = baseRate > 0 && baseRate < 1 ? 1 - brier / (baseRate * (1 - baseRate)) : 0;
  const warnN = hit + fa;
  return {
    n,
    threshold: th,
    events: base,
    baseRate: round(baseRate, 5),
    warnAt: round(warnAt, 5),
    warnings: warnN,
    brier: round(brier, 6),
    bss: round(bss, 4),
    logLoss: round(-sumLog / n, 5),
    hitRate: base ? round(hit / base, 4) : null,
    falseAlarmRate: warnN ? round(fa / warnN, 4) : null,
    precision: warnN ? round(hit / warnN, 4) : null,
    meanProb: round(sumRisk / n, 5),
    spearman: round(spearman(clean.map((r) => r.risk), clean.map((r) => r.obs)), 4),
    reliability: bucket.map((b, i) => b.n ? { p: round((i + 0.5) / 10, 1), n: b.n, obs: round(b.ev / b.n, 5) } : null).filter(Boolean)
  };
}
function lightningBands(values) {
  const v = values.filter(finite);
  if (v.length < 200) return null;
  return {
    p50: round(quantile2(v, 0.5), 4),
    p80: round(quantile2(v, 0.8), 4),
    p95: round(quantile2(v, 0.95), 4),
    p99: round(quantile2(v, 0.99), 4),
    max: round(Math.max(...v), 4),
    n: v.length
  };
}
var LIGHTNING_LEVELS = [
  { id: "low", name: "Th\u1EA5p", note: "d\u01B0\u1EDBi trung v\u1ECB c\u1EE7a 12 th\xE1ng t\u1EA1i \u0111\u1ECBa \u0111i\u1EC3m n\xE0y" },
  { id: "p50", name: "Trung b\xECnh", note: "t\u1EEB trung v\u1ECB tr\u1EDF l\xEAn" },
  { id: "p80", name: "Kh\xE1", note: "v\u01B0\u1EE3t 80% s\u1ED1 gi\u1EDD trong 12 th\xE1ng" },
  { id: "p95", name: "Cao", note: "v\u01B0\u1EE3t 95% s\u1ED1 gi\u1EDD trong 12 th\xE1ng" },
  { id: "p99", name: "R\u1EA5t cao", note: "v\u01B0\u1EE3t 99% s\u1ED1 gi\u1EDD trong 12 th\xE1ng" }
];
function lightningLevel(risk, bands) {
  if (!finite(risk) || !bands) return null;
  if (risk >= bands.p99) return "p99";
  if (risk >= bands.p95) return "p95";
  if (risk >= bands.p80) return "p80";
  if (risk >= bands.p50) return "p50";
  return "low";
}

// src/engine/logistic.ts
function logistic(a, b, x) {
  const z = Math.max(-35, Math.min(35, a + b * x));
  return 1 / (1 + Math.exp(-z));
}
function logisticFit(x, y) {
  const n = x.length;
  if (n < 200) return null;
  let pos = 0, sx = 0;
  for (let i = 0; i < n; i++) {
    if (y[i]) pos++;
    sx += x[i];
  }
  const rate = pos / n;
  if (!(rate > 0) || rate >= 1) return null;
  let mx = sx / n, varX = 0;
  for (let i = 0; i < n; i++) varX += (x[i] - mx) ** 2;
  varX /= n;
  if (!(varX > 1e-12)) return null;
  const z = new Array(n);
  for (let i = 0; i < n; i++) z[i] = (x[i] - mx) / Math.sqrt(varX);
  let a = Math.log(rate / (1 - rate)), b = 0;
  let lr = 2;
  for (let it = 0; it < 4e3; it++) {
    let ga = 0, gb = 0;
    for (let i = 0; i < n; i++) {
      const p = logistic(a, b, z[i]);
      const r = (y[i] ? 1 : 0) - p;
      ga += r;
      gb += r * z[i];
    }
    ga /= n;
    gb /= n;
    const na = a + lr * ga, nb = b + lr * gb;
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const p = logistic(na, nb, z[i]);
      ll += Math.log(Math.max(y[i] ? p : 1 - p, 1e-12));
    }
    let ll0 = 0;
    for (let i = 0; i < n; i++) {
      const p = logistic(a, b, z[i]);
      ll0 += Math.log(Math.max(y[i] ? p : 1 - p, 1e-12));
    }
    if (!(ll > ll0)) {
      lr *= 0.5;
      if (lr < 1e-6) break;
      continue;
    }
    const da = Math.abs(na - a) + Math.abs(nb - b);
    a = na;
    b = nb;
    lr = Math.min(4, lr * 1.15);
    if (da < 1e-9) break;
  }
  if (!finite(a) || !finite(b)) return null;
  return { a: round(a, 6), b: round(b, 6), n, baseRate: round(rate, 5), sdX: round(Math.sqrt(varX), 6), meanX: round(mx, 6) };
}
function applyCalibration(cal, values) {
  if (!cal) return values.map(() => null);
  const sd = cal.sdX || 1, mx = cal.meanX || 0;
  return values.map((v) => finite(v) ? logistic(cal.a, cal.b, (v - mx) / sd) : null);
}

// src/engine/isotonic.ts
function pav(y, w) {
  const val = [], wt = [], lo = [], hi = [];
  for (let i = 0; i < y.length; i++) {
    val.push(y[i]);
    wt.push(w[i]);
    lo.push(i);
    hi.push(i);
    while (val.length >= 2) {
      const n = val.length;
      if (!(val[n - 2] / wt[n - 2] > val[n - 1] / wt[n - 1])) break;
      const l2 = lo.pop(), h2 = hi.pop();
      const l1 = lo.pop();
      val[n - 2] += val[n - 1];
      wt[n - 2] += wt[n - 1];
      val.pop();
      wt.pop();
      lo.push(l1);
      hi.push(h2);
    }
  }
  return { val, wt, lo, hi };
}
function isotonicCalibrate(x, y, maxBins = 20, minPerBin = 120) {
  const n = x.length;
  if (n < 500) return null;
  let pos = 0;
  for (let i = 0; i < n; i++) if (y[i]) pos++;
  const baseRate = pos / n;
  if (!(baseRate > 0) || baseRate >= 1) return null;
  const sorted = [...x].sort((a, b) => a - b);
  const knots = [];
  for (let b = 0; b <= maxBins; b++) knots.push(sorted[Math.min(n - 1, Math.floor(b / maxBins * n))]);
  const uniq = [...new Set(knots)].sort((a, b) => a - b);
  const mid = [], ry = [], rw = [];
  for (let b = 0; b < uniq.length - 1; b++) {
    const lo2 = uniq[b], hi2 = uniq[b + 1];
    if (!(hi2 > lo2)) continue;
    let s = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (x[i] >= lo2 && x[i] < hi2) {
        s += y[i] ? 1 : 0;
        k++;
      }
    }
    if (k < minPerBin) continue;
    mid.push((lo2 + hi2) / 2);
    ry.push(s);
    rw.push(k);
  }
  if (!mid.length) return null;
  const { val, wt, lo, hi } = pav(ry, rw);
  const blockKnots = lo.map((a, i) => (mid[a] + mid[hi[i]]) / 2);
  return {
    knots: blockKnots,
    values: val.map((v, i) => Math.max(1e-6, Math.min(1 - 1e-6, v / (wt[i] || 1)))),
    n,
    baseRate: round(baseRate, 5),
    bins: mid.length
  };
}
function applyIsotonic(cal, values) {
  if (!cal) return values.map(() => null);
  return values.map((v) => {
    if (!finite(v)) return null;
    const k = cal.knots;
    if (v <= k[0]) return cal.values[0];
    if (v >= k[k.length - 1]) return cal.values[cal.values.length - 1];
    let lo = 0, hi = k.length - 1;
    while (hi - lo > 1) {
      const m = lo + hi >> 1;
      if (k[m] <= v) lo = m;
      else hi = m;
    }
    const t = (v - k[lo]) / (k[hi] - k[lo] || 1);
    return cal.values[lo] + (cal.values[hi] - cal.values[lo]) * t;
  });
}

// src/engine/index.ts
var ENGINE_VERSION = "1.0.0";
var ENGINE_CONFIG = {
  K_MEMBERS: 51,
  HARMONIC: 4,
  LAMBDA_GRID: [1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3, 1, 3],
  CV_FOLDS: 8,
  REGIME_EDGES: [
    [20, 50, 80, 95],
    [0.05, 0.5, 2, 5, 10],
    [5, 12, 20, 32],
    [10, 20, 26, 32],
    [45, 65, 80, 92]
  ],
  REGIME_MIN_SUPPORT: 12,
  CAPE_REF: 2500,
  LI_LO: -6,
  LI_HI: 4,
  CIN_MAX: 200,
  FLOOD_BANDS: [
    { at: 0.9, level: 0, key: "canh_bao", label: "C\u1EA3nh b\xE1o", tone: "low" },
    { at: 0.95, level: 1, key: "bd1", label: "B\xE1o \u0111\u1ED9ng 1", tone: "mid" },
    { at: 0.98, level: 2, key: "bd2", label: "B\xE1o \u0111\u1ED9ng 2", tone: "high" },
    { at: 0.995, level: 3, key: "bd3", label: "B\xE1o \u0111\u1ED9ng 3", tone: "severe" }
  ],
  LIGHTNING_LEVELS: [
    { id: "low", name: "Th\u1EA5p", note: "d\u01B0\u1EDBi trung v\u1ECB c\u1EE7a 12 th\xE1ng t\u1EA1i \u0111\u1ECBa \u0111i\u1EC3m n\xE0y" },
    { id: "p50", name: "Trung b\xECnh", note: "t\u1EEB trung v\u1ECB tr\u1EDF l\xEAn" },
    { id: "p80", name: "Kh\xE1", note: "v\u01B0\u1EE3t 80% s\u1ED1 gi\u1EDD trong 12 th\xE1ng" },
    { id: "p95", name: "Cao", note: "v\u01B0\u1EE3t 95% s\u1ED1 gi\u1EDD trong 12 th\xE1ng" },
    { id: "p99", name: "R\u1EA5t cao", note: "v\u01B0\u1EE3t 99% s\u1ED1 gi\u1EDD trong 12 th\xE1ng" }
  ]
};
export {
  BOUNDS,
  CAPE_REF,
  CIN_MAX,
  CONDITIONS,
  CV_FOLDS,
  DET_MODEL_IDS,
  DET_MODEL_NAMES,
  EARTH_RADIUS_KM,
  ENGINE_CONFIG,
  ENGINE_VERSION,
  EPS,
  FLOOD_BANDS,
  FORWARD,
  HARMONIC,
  INVERSE,
  K_MEMBERS,
  LAMBDA_GRID,
  LEADS,
  LIGHTNING_LEVELS,
  LIVE_ENS_MODEL_IDS,
  LIVE_ENS_MODEL_NAMES,
  LI_HI,
  LI_LO,
  REGIME_EDGES,
  REGIME_MIN_SUPPORT,
  VARIABLES,
  VARIABLE_IDS,
  Z_NODES,
  airMass,
  airMassGrid,
  applyCalibration,
  applyIsotonic,
  applyLinear,
  bearingDeg,
  bestSingle,
  buildCrossFill,
  calibrate,
  calibrateCode,
  calibrateDirection,
  calibrationBundle,
  circularAbs,
  clamp,
  classifyCell,
  componentPredict,
  condGroup,
  conditionOf,
  crpsMembers,
  dailyAccumulation,
  dayOfYear,
  directionCandidates,
  directionSpecs,
  distanceKm,
  evaluate,
  evaluateCode,
  evaluateDirection,
  evaluateScalar,
  eventScores,
  finite,
  floodLevels,
  frontalPassage,
  gaussSolve,
  hourOf,
  isotonicCalibrate,
  jacobian,
  lightningBands,
  lightningIndex,
  lightningLevel,
  lightningVerify,
  linearModel,
  logisticFit,
  makeSpec,
  meanS,
  moments,
  ncdf,
  ncdfInv,
  nearestOnTrack,
  nominalStage,
  offsetLatLon,
  pairedBootstrap,
  pdf,
  pointScores,
  predictFromCalibration,
  probEnsembleScores,
  probScores,
  pseudoMembers,
  quantile2 as quantile,
  regimeKey,
  residualTemplate,
  riverRisk,
  rng,
  rollingFolds,
  round,
  sdS,
  selectDirectionPair,
  selectModel,
  sigma2,
  solveNNLS,
  solveRidge,
  spearman,
  stageToQ,
  thickness,
  toDir,
  toSpeed,
  toUms,
  trajectory,
  varS,
  windBarb
};
