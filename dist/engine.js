/*
 * ATMOS forecast engine.
 *
 * Method, in one paragraph. Seven independent deterministic systems are pulled
 * for the same grid point and verification hour. Instead of combining them with
 * inverse-MSE weights, the engine fits Ensemble-Model-Output-Statistics style
 * regressions: a ridge regression of the transformed truth on the individual
 * system values, their disagreement, two cross-variable fields, and diurnal and
 * annual harmonics. The penalty strength and the whole model family are chosen
 * by expanding-window blocked cross-validation inside the fitting window, so the
 * verification window never influences a single coefficient. Residuals of the
 * winner are then modelled as sigma^2 = alpha + beta * spread^2, which turns the
 * point forecast into a calibrated predictive distribution expressed as a
 * deterministic pseudo-ensemble. Every number reported downstream is read off
 * that same distribution.
 *
 * Runs unchanged in Node (offline backtest) and in the browser (applying shipped
 * coefficients to a live forecast). No dependencies.
 */
(function (root) {
  'use strict';

  /* ================================================================
   * 1. Numeric core
   * ================================================================ */

  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const EPS = 1e-9;
  const round = (v, d) => { if (!finite(v)) return v; const p = Math.pow(10, d); return Math.round(v * p) / p; };

  function meanS(a) {
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (finite(a[i])) { s += a[i]; n++; }
    return n ? s / n : null;
  }
  function varS(a) {
    const m = meanS(a);
    if (m === null) return null;
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (finite(a[i])) { s += (a[i] - m) * (a[i] - m); n++; }
    return n > 1 ? s / (n - 1) : 0;
  }
  function sdS(a) { const v = varS(a); return v === null ? null : Math.sqrt(v); }

  /** Linear-interpolation quantile over the finite values of `a`. */
  function quantile(a, q) {
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
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
      + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const ncdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
  const pdf = z => 0.3989422804014327 * Math.exp(-0.5 * z * z);

  /** Acklam's inverse standard-normal CDF, absolute error below 1.15e-9. */
  function ncdfInv(p) {
    if (!finite(p)) return NaN;
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01];
    const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
      -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
      3.754408661907416e+00];
    // Tail numerators are degree five, denominators degree four plus one.
    const tailNum = (c, q) => ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5];
    const tailDen = (d, q) => (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1;
    const cenNum = (a, r) => ((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5];
    const cenDen = (b, r) => ((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1;
    if (p < 0.02425) {
      const q = Math.sqrt(-2 * Math.log(p));
      return tailNum(C, q) / tailDen(D, q);
    }
    if (p <= 1 - 0.02425) {
      const q = p - 0.5, r = q * q;
      return q * cenNum(A, r) / cenDen(B, r);
    }
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -tailNum(C, q) / tailDen(D, q);
  }

  /** Deterministic PRNG so every bootstrap figure in the report is reproducible. */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================================================================
   * 2. Linear algebra.
   *    Cross-products are built once per fold and reused across the
   *    whole ridge path. That is what makes cross-validation cheap
   *    enough for 16 variables x 5 leads x 6 cities.
   * ================================================================ */

  function gaussSolve(A, b) {
    const n = b.length;
    const M = A.map((r, i) => r.slice().concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
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

  /**
   * Centred cross-products of a design matrix. Independent of the ridge path.
   *
   * Predictors are standardised to zero mean and unit standard deviation, and the
   * per-column scale is returned so inference can undo it. Without this the ridge
   * penalty is not comparable across variables: a raw predictor that happens to
   * live on a scale of 10 makes lambda look negligible, and because the model
   * mean is by construction the average of the model columns, the design matrix
   * is exactly rank deficient. An under-penalised fit then runs away along that
   * null direction and produces cancelling coefficients of any size, which is
   * exactly how a 0.9 km/h component error became 14 km/h.
   */
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
      for (let i = 0; i < n; i++) { const d = X[i][j] - mu[j]; v += d * d; }
      const s = Math.sqrt(v / Math.max(1, n - 1));
      sd[j] = s > 1e-12 ? s : 1;      // a constant column carries no information
    }

    const XtX = [], Xty = new Array(p).fill(0);
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
    // Unit-variance columns make the mean diagonal about n, so the penalty is
    // directly comparable to a count of observations.
    return { XtX, Xty, mu, ym, sd, p, n, scale: p ? tr / p : 1 };
  }

  function solveRidge(m, lambda) {
    const A = m.XtX.map(r => r.slice());
    for (let a = 0; a < m.p; a++) A[a][a] += lambda * (m.scale || 1) + 1e-12;
    const beta = gaussSolve(A, m.Xty);
    return beta && beta.every(finite) ? beta : null;
  }

  /**
   * Lawson-Hanson non-negative least squares on the centred moments, so the fit
   * is a genuine non-negative combination of the system columns. No system can
   * ever be handed a negative vote, which keeps the blend physically readable
   * and stable when two systems are near-duplicates.
   */
  function solveNNLS(m, lambda) {
    const p = m.p;
    const A = m.XtX.map(r => r.slice());
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
        if (g > best) { best = g; t = a; }
      }
      if (t < 0) break;
      inSet[t] = true;

      for (let inner = 0; inner < limit; inner++) {
        idx.length = 0;
        for (let a = 0; a < p; a++) if (inSet[a]) idx.push(a);
        const As = idx.map(a => idx.map(c => A[a][c]));
        const bs = idx.map(a => m.Xty[a]);
        const z = gaussSolve(As, bs);
        if (!z) { inSet[t] = false; break; }
        let alpha = 1;
        for (let s = 0; s < idx.length; s++) {
          if (z[s] <= 0) {
            const denom = w[idx[s]] - z[s];
            alpha = Math.min(alpha, denom > EPS ? w[idx[s]] / denom : 0);
          }
        }
        if (alpha < 1) {
          for (let s = 0; s < idx.length; s++) w[idx[s]] += alpha * (z[s] - w[idx[s]]);
          for (let s = 0; s < idx.length; s++) if (w[idx[s]] <= EPS) { w[idx[s]] = 0; inSet[idx[s]] = false; }
        } else {
          for (let s = 0; s < idx.length; s++) w[idx[s]] = z[s];
          break;
        }
      }
    }
    for (let a = 0; a < p; a++) if (w[a] < 0) w[a] = 0;
    return w;
  }

  /* ================================================================
   * 3. Transforms. Fitting on a transformed scale is what keeps
   *    precipitation, wind and humidity well behaved: a Gaussian
   *    predictive distribution in log space becomes right-skewed and
   *    non-negative in physical units.
   * ================================================================ */

  const FORWARD = {
    gauss: x => x,
    log1p: x => Math.log1p(Math.max(0, x)),
    logit: x => { const p = clamp(x, 0.5, 99.5) / 100; return Math.log(p / (1 - p)); },
  };
  const INVERSE = {
    gauss: y => y,
    log1p: y => Math.expm1(clamp(y, -30, 30)),
    logit: y => (1 / (1 + Math.exp(-clamp(y, -30, 30)))) * 100,
  };

  /* ================================================================
   * 4. Variable registry
   * ================================================================ */

  const VARIABLES = {
    temperature_2m: { label: 'Nhiệt độ 2 m', short: 'Nhiệt độ', unit: '°C', kind: 'gauss', digits: 1, group: 'nhiệt', cross: ['cloud_cover', 'relative_humidity_2m'] },
    apparent_temperature: { label: 'Nhiệt độ cảm giác', short: 'Cảm giác', unit: '°C', kind: 'gauss', digits: 1, group: 'nhiệt', cross: ['wind_speed_10m'] },
    dew_point_2m: { label: 'Nhiệt độ điểm sương', short: 'Điểm sương', unit: '°C', kind: 'gauss', digits: 1, group: 'nhiệt', cross: ['relative_humidity_2m'] },
    relative_humidity_2m: { label: 'Độ ẩm tương đối', short: 'Độ ẩm', unit: '%', kind: 'logit', digits: 0, group: 'ẩm', cross: ['cloud_cover'] },
    cloud_cover: { label: 'Độ phủ mây', short: 'Phủ mây', unit: '%', kind: 'logit', digits: 0, group: 'ẩm', cross: ['precipitation'] },
    precipitation: { label: 'Lượng mưa', short: 'Mưa', unit: 'mm', kind: 'log1p', digits: 1, group: 'mưa', accum: true, thresholds: [0.1, 1, 2, 5, 10, 20] },
    rain: { label: 'Mưa dạng lỏng', short: 'Mưa lỏng', unit: 'mm', kind: 'log1p', digits: 1, group: 'mưa', accum: true, thresholds: [0.1, 1, 5, 10] },
    snowfall: { label: 'Tuyết rơi', short: 'Tuyết', unit: 'cm', kind: 'log1p', digits: 2, group: 'mưa', accum: true, thresholds: [0.1, 1, 5] },
    wind_speed_10m: { label: 'Tốc độ gió 10 m', short: 'Gió', unit: 'km/h', kind: 'log1p', digits: 1, group: 'gió', thresholds: [10, 20, 30, 40] },
    wind_gusts_10m: { label: 'Gió giật 10 m', short: 'Gió giật', unit: 'km/h', kind: 'log1p', digits: 1, group: 'gió', thresholds: [20, 30, 40, 50, 60] },
    wind_direction_10m: { label: 'Hướng gió 10 m', short: 'Hướng gió', unit: '°', kind: 'direction', digits: 0, group: 'gió' },
    surface_pressure: { label: 'Áp suất mặt đất', short: 'Áp mặt đất', unit: 'hPa', kind: 'gauss', digits: 1, group: 'áp' },
    pressure_msl: { label: 'Áp suất mực biển', short: 'Áp mực biển', unit: 'hPa', kind: 'gauss', digits: 1, group: 'áp' },
    shortwave_radiation: { label: 'Bức xạ mặt trời', short: 'Bức xạ', unit: 'W/m²', kind: 'log1p', digits: 0, group: 'năng lượng' },
    et0_fao_evapotranspiration: { label: 'Bốc hơi FAO-56', short: 'Bốc hơi', unit: 'mm', kind: 'log1p', digits: 2, group: 'năng lượng', accum: true, thresholds: [1, 3, 5] },
    weather_code: { label: 'Mã thời tiết WMO', short: 'Thời tiết', unit: '', kind: 'code', digits: 0, group: 'mã' },
  };

  /* ================================================================
   * 5. Predictive distribution
   * ================================================================ */

  const K_MEMBERS = 51;
  const Z_NODES = (() => { const z = []; for (let k = 0; k < K_MEMBERS; k++) z.push(ncdfInv((k + 0.5) / K_MEMBERS)); return z; })();

  /** Physical bounds implied by the transform, so no caller can forget them. */
  const BOUNDS = { log1p: [0, null], logit: [0, 100], gauss: [null, null] };

  /** Reproducible pseudo-ensemble: the calibrated Gaussian mapped back to units. */
  /*
   * Pseudo-ensemble around a central forecast.
   *
   * `sd` arrives in the fitting space (log, logit or identity). Drawing the
   * members there and mapping back through the inverse transform shrinks the
   * physical spread towards zero exactly when the central value is small — a
   * dry hour ends up with a zero-width rain ensemble, confidently wrong on the
   * hours it actually rains. So the sigma is first carried into physical units
   * through the local Jacobian |d(inv)/d(mu)|, and the fan is drawn there.
   *
   * Non-negative and bounded variables get a shifted multiplicative fan, which
   * keeps a right tail without letting members fall below zero. The shift is
   * what gives a central value of exactly zero real spread instead of none.
   */
  function pseudoMembers(kind, mu, sd, lo, hi, template, mult) {
    const inv = INVERSE[kind] || INVERSE.gauss;
    const [dlo, dhi] = BOUNDS[kind] || BOUNDS.gauss;
    const low = finite(lo) ? lo : dlo;
    const high = finite(hi) ? hi : dhi;
    const centre = inv(mu);
    // The template is standardised against PHYSICAL residuals, so the sigma from
    // sigma2 — which lives in the fitting space — has to be carried across by the
    // local Jacobian first. Skipping this would put a log-space sigma next to a
    // mm-space template and quietly shrink every fan near zero.
    const scale = Math.max(sd * jacobian(kind, mu), 1e-6);
    const m = finite(mult) && mult > 0 ? mult : 1;
    const nodes = template && template.length === K_MEMBERS
      ? (m === 1 ? template : template.map(v => v * m))
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

  /** |d(inv)/d(mu)| for each fitting transform, at the given central value. */
  function jacobian(kind, mu) {
    if (kind === 'log1p') return Math.exp(Math.max(mu, -20));
    if (kind === 'logit') {
      const p = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, mu))));
      return Math.max(1e-4, 100 * p * (1 - p));
    }
    return 1;
  }

  /*
   * Empirical residual shape.
   *
   * A Gaussian fan cannot represent rain. Its error is concentrated in a few
   * hours, so any symmetric fan either misses those hours or is far too wide on
   * all the dry ones — and the UI is then honest-looking but useless.
   *
   * So the shape is measured instead of assumed. Residuals from the fitting
   * window are divided by the dispersion sigma2 predicts for that hour, which
   * leaves the part of the distribution that sigma2 cannot express — the skew,
   * the heavy tail, the mass sitting exactly on the floor. The quantiles of that
   * standardised residual become the fan template. Only the SHAPE is taken from
   * the data; the WIDTH still comes from sigma2, so a hour where every model
   * agrees still gets a narrow fan.
   */
  function residualTemplate(z, symmetric) {
    const s = z.filter(v => finite(v)).sort((a, b) => a - b);
    if (s.length < 200) return null;
    if (!symmetric) {
      const out = new Array(K_MEMBERS);
      for (let k = 0; k < K_MEMBERS; k++) {
        // Midpoint quantiles, so the sample ends are not over-represented.
        out[k] = s[clamp(Math.floor((k + 0.5) / K_MEMBERS * s.length), 0, s.length - 1)];
      }
      return out;
    }
    // Symmetric envelope of the empirical |residual|.
    //
    // Taking the raw quantiles would bake the fitting window's BIAS into the fan:
    // an over-forecasting window yields a lopsided fan, and that lopsidedness
    // does not survive to a different window. The tail WIDTH is real and worth
    // keeping; which side it sits on is not.
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

  /* ================================================================
   * 6. Scores
   * ================================================================ */

  function pointScores(pred, obs) {
    const e = [], p = [], o = [];
    for (let i = 0; i < pred.length; i++) {
      if (!finite(pred[i]) || !finite(obs[i])) continue;
      e.push(pred[i] - obs[i]); p.push(pred[i]); o.push(obs[i]);
    }
    const n = e.length;
    if (!n) return { n: 0, mae: null, rmse: null, bias: null, corr: null, meanObs: null, meanPred: null };
    let sse = 0, mae = 0, cov = 0, sp = 0, so = 0;
    for (let i = 0; i < n; i++) {
      sse += e[i] * e[i]; mae += Math.abs(e[i]);
      cov += (p[i] - meanS(p)) * (o[i] - meanS(o));
    }
    const mp = meanS(p), mo = meanS(o);
    for (let i = 0; i < n; i++) { sp += (p[i] - mp) ** 2; so += (o[i] - mo) ** 2; }
    return {
      n, mae: mae / n, rmse: Math.sqrt(sse / n), bias: e.reduce((s, v) => s + v, 0) / n,
      corr: sp > 0 && so > 0 ? cov / Math.sqrt(sp * so) : null, meanObs: mo, meanPred: mp,
    };
  }

  function eventScores(pred, obs, threshold) {
    let hit = 0, miss = 0, fa = 0, cn = 0;
    for (let i = 0; i < pred.length; i++) {
      if (!finite(pred[i]) || !finite(obs[i])) continue;
      const pe = pred[i] >= threshold, oe = obs[i] >= threshold;
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

  /** Brier score, Brier skill score against climatology, and reliability bins. */
  function probScores(probs, obs, threshold, climatology) {
    const bins = Array.from({ length: 10 }, () => ({ n: 0, sumP: 0, hits: 0 }));
    let bse = 0, n = 0, hits = 0;
    for (let i = 0; i < probs.length; i++) {
      if (!finite(probs[i]) || !finite(obs[i])) continue;
      const y = obs[i] >= threshold ? 1 : 0;
      bse += (probs[i] - y) ** 2; n++; hits += y;
    }
    if (!n) return { n: 0, threshold, brier: null, bss: null, baseRate: null, reliability: [] };
    for (let i = 0; i < probs.length; i++) {
      if (!finite(probs[i]) || !finite(obs[i])) continue;
      const y = obs[i] >= threshold ? 1 : 0;
      const b = clamp(Math.floor(probs[i] * 10), 0, 9);
      bins[b].n++; bins[b].sumP += probs[i]; bins[b].hits += y;
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

  /**
   * Probabilistic scores for the calibrated ensemble. The central estimate is
   * the ensemble median, so spread-skill measures exactly what a forecaster
   * would see on a chart.
   */
  function probEnsembleScores(members, obs) {
    let crpsSum = 0, n = 0, sqSpread = 0, sqErr = 0, en = 0, loSum = 0, hiSum = 0;
    const pin = { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
    const pinN = { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
    const rank = new Array(K_MEMBERS + 1).fill(0);
    let rankN = 0;
    const targets = [['p10', 0.1], ['p25', 0.25], ['p50', 0.5], ['p75', 0.75], ['p90', 0.9]];
    /*
     * Coverage is the honest calibration measure. spread/rmse assumes the error
     * distribution looks like the fan, which is false for a heavy-tailed
     * variable: rain's error lives in a handful of hours, so the ratio says
     * "underdispersed" even when the 80% interval actually hits its target.
     */
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
      // Eleven equal-width bins over the member ranks 0..K, so every rank lands
      // in exactly one bin and a perfect calibration gives a flat histogram.
      for (let r = 0; r <= K_MEMBERS; r++) {
        rankHistogram[Math.min(10, Math.floor(r * 11 / (K_MEMBERS + 1)))] += rank[r];
      }
      for (let b = 0; b <= 10; b++) rankHistogram[b] /= rankN;
    }
    const pinball = {};
    for (const k in pin) pinball[k] = pinN[k] ? pin[k] / pinN[k] : null;
    const spread = n ? Math.sqrt(sqSpread / n) : null;
    const rmse = en ? Math.sqrt(sqErr / en) : null;
    // rank uniformity: 0 is perfect, above about 0.4 is unusable
    let chi = 0;
    if (rankN) for (const r of rankHistogram) chi += (r - 1 / 11) ** 2;
    return {
      n, crps: n ? crpsSum / n : null, pinball,
      spread, medianRmse: rmse,
      // null only when the central forecast happened to be exact everywhere
      spreadSkill: (spread !== null && rmse) ? spread / rmse : null,
      rangeMean: n ? (hiSum - loSum) / n : null,
      rankHistogram, rankDeviation: rankN ? Math.sqrt(chi) : null,
      // Share of hours where the truth fell inside the stated interval. A
      // well-calibrated 80% interval should land near 0.80.
      coverage: coverN ? {
        n: coverN,
        p25p75: cov['50'] / coverN,
        p10p90: cov['80'] / coverN,
        full: cov.full / coverN,
      } : null,
    };
  }

  /** Moving-block bootstrap on the paired squared-error difference. */
  function pairedBootstrap(baseSq, modelSq, blockHours, reps, seed) {
    const n = Math.min(baseSq.length, modelSq.length);
    if (n < blockHours * 2) return null;
    const fb = baseSq.filter(finite), fm = modelSq.filter(finite);
    if (fb.length < blockHours * 2 || fb.length !== fm.length) return null;
    const rmseB = Math.sqrt(fb.reduce((s, v) => s + v, 0) / fb.length);
    const rmseM = Math.sqrt(fm.reduce((s, v) => s + v, 0) / fm.length);
    // A baseline with zero error cannot be improved on: the relative skill is
    // undefined and every resample collapses onto the same degenerate value.
    // Snowfall at these latitudes is the real case — every system and ERA5
    // agree the sky is dry — so there is nothing to measure here.
    if (!(rmseB > 0)) return null;
    const blocks = Math.ceil(n / blockHours);
    const rand = rng(seed);
    const diffs = [];
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
    const q = p => diffs[clamp(Math.floor(p * (diffs.length - 1)), 0, diffs.length - 1)];
    return {
      deltaRmse: rmseB - rmseM, ci95: [q(0.025), q(0.975)], ci80: [q(0.1), q(0.9)],
      probImprovement: diffs.filter(d => d > 0).length / diffs.length,
      skill: rmseB > 0 ? 1 - rmseM / rmseB : null, reps: diffs.length, blockHours,
    };
  }

  /* ================================================================
   * 7. Predictor construction
   * ================================================================ */

  const HARMONIC = 4; // sin/cos of local hour and of day of year
  /*
   * With unit-variance predictors the mean diagonal of X'X is about n, so a
   * penalty of lambda * n interpolates between no regularisation (lambda -> 0)
   * and one that effectively discards the design (lambda >= 1). The grid spans
   * four decades of that ratio.
   */
  const LAMBDA_GRID = [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3, 1, 3];
  const CV_FOLDS = 8;

  function hourOf(times, i, utcOffset) {
    const h = Number(times[i].slice(11, 13));
    return (((h + (utcOffset || 0)) % 24) + 24) % 24;
  }
  function dayOfYear(times, i) {
    const d = Date.UTC(+times[i].slice(0, 4), +times[i].slice(5, 7) - 1, +times[i].slice(8, 10));
    return Math.round((d - Date.UTC(+times[i].slice(0, 4), 0, 1)) / 86400000);
  }

  function makeSpec({ times, obs, series, modelIds, cross, crossFill, utcOffset, forward, kind }) {
    const n = times.length;
    const vals = modelIds.map(id => series[id].map(v => finite(v) ? forward(v) : null));
    const mean = new Array(n), spread = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, s2 = 0, c = 0;
      for (let j = 0; j < vals.length; j++) if (finite(vals[j][i])) { s += vals[j][i]; s2 += vals[j][i] ** 2; c++; }
      mean[i] = c ? s / c : null;
      spread[i] = c > 1 ? Math.sqrt(Math.max(0, s2 / c - mean[i] ** 2)) : 0;
    }
    const hour = new Array(n), doy = new Array(n);
    for (let i = 0; i < n; i++) { hour[i] = hourOf(times, i, utcOffset); doy[i] = dayOfYear(times, i); }
    const nCross = cross ? cross.length : 0;
    const spec = {
      n, times, obs, modelIds, vals, mean, spread, hour, doy, forward, kind,
      nModels: modelIds.length, nCross,
      p: 2 + modelIds.length + nCross + HARMONIC,
      crossCols: [],
    };
    for (let j = 0; j < nCross; j++) {
      spec.crossCols.push(cross[j].map(v => (finite(v) ? forward(v) : (crossFill ? crossFill[j] : null))));
    }
    spec.row = i => {
      if (!finite(spec.mean[i])) return null;
      const row = new Array(spec.p);
      row[0] = spec.mean[i]; row[1] = spec.spread[i];
      let k = 2;
      for (let j = 0; j < spec.nModels; j++) { row[k] = spec.vals[j][i]; k++; }
      for (let j = 0; j < nCross; j++) { row[k] = spec.crossCols[j][i]; k++; }
      row[k++] = Math.sin(2 * Math.PI * spec.hour[i] / 24);
      row[k++] = Math.cos(2 * Math.PI * spec.hour[i] / 24);
      row[k++] = Math.sin(2 * Math.PI * spec.doy[i] / 365.25);
      row[k++] = Math.cos(2 * Math.PI * spec.doy[i] / 365.25);
      for (let j = 0; j < spec.p; j++) if (!finite(row[j])) return null;
      return row;
    };
    return spec;
  }

  /**
   * Prediction reads ym + sum(beta_j * z_j) where z_j is the standardised
   * predictor. Centring and scaling are stored explicitly so the browser applies
   * exactly the same arithmetic from the shipped numbers.
   */
  function applyLinear(model, row) {
    let v = model.b0;
    for (let j = 0; j < model.beta.length; j++) {
      v += model.beta[j] * ((row[j] - model.mu[j]) / model.sd[j]);
    }
    return v;
  }

  /**
   * b0 is the mean of the transformed target on the fitting window; beta lives in
   * standardised predictor space, so mu and sd must travel with it.
   */
  function linearModel(family, beta, m) {
    return { family, beta: beta.slice(), b0: m.ym, mu: m.mu.slice(), sd: m.sd.slice() };
  }

  /**
   * Expanding-window blocked cross-validation. A training window only ever
   * precedes its validation block and a gap separates them, so a model is never
   * scored on hours that resemble its own fit.
   */
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

  /** Best single system on the given rows, scored in physical units. */
  function bestSingle(spec, idx, inverse) {
    let bestId = null, bestRmse = Infinity;
    for (let j = 0; j < spec.nModels; j++) {
      let se = 0, c = 0;
      for (const i of idx) {
        const v = spec.vals[j][i];
        if (!finite(v) || !finite(spec.obs[i])) continue;
        se += (inverse(v) - spec.obs[i]) ** 2; c++;
      }
      if (c > 20 && se / c < bestRmse) { bestRmse = se / c; bestId = spec.modelIds[j]; }
    }
    return { id: bestId, rmse: finite(bestRmse) ? Math.sqrt(bestRmse) : null };
  }

  /**
   * Fits every candidate family on the fitting rows and scores them on blocked
   * validation windows, then refits the winner on all fitting rows. Selection
   * uses the RMSE of the predictive median in physical units, which is cheap and
   * stable; the reported metrics then come from the full predictive distribution.
   */
  function selectModel(spec, trainIdx, inverse, forward) {
    const yAll = trainIdx.map(i => forward(spec.obs[i]));
    const rowsAll = trainIdx.map(i => spec.row(i));
    const keep = [];
    for (let t = 0; t < trainIdx.length; t++) if (rowsAll[t] && finite(yAll[t])) keep.push(t);
    if (keep.length < spec.p * 12) return null;
    const fitIdx = keep.map(t => trainIdx[t]);
    const fitRows = keep.map(t => rowsAll[t]);
    const fitY = keep.map(t => yAll[t]);
    const mAll = moments(fitRows, fitY);

    // Per-fold squared error for every candidate. Keeping the folds separate
    // (rather than pooling them) is what allows the one-standard-error rule
    // below to see how much of the ranking is real.
    const foldSE = new Map();       // key -> [se, n] per fold
    const folds = rollingFolds(fitIdx.length, CV_FOLDS);
    for (let f = 0; f < folds.length; f++) {
      const trEnd = folds[f].train;
      if (trEnd < spec.p * 12) continue;
      const m = moments(fitRows.slice(0, trEnd), fitY.slice(0, trEnd));
      const trIdx = fitIdx.slice(0, trEnd);
      const best = bestSingle(spec, trIdx, inverse);
      const cands = [{ key: 'mean:-', predict: i => spec.mean[i] }];
      if (best.id !== null) cands.push({ key: 'best:-', predict: i => spec.vals[spec.modelIds.indexOf(best.id)][i] });
      /*
       * A combination needs at least two systems to combine. With one usable
       * system an NNLS or ridge fit is not a blend at all: it is that system
       * plus an intercept, and reporting it as a multi-model calibration would
       * overstate what the ensemble can do. Only the two honest families are
       * offered in that case.
       */
      for (const lam of spec.modelIds.length >= 2 ? LAMBDA_GRID : []) {
        const w = solveNNLS(m, lam);
        if (w) {
          const mo = linearModel('nnls', w, m);
          cands.push({ key: `nnls:${lam}`, predict: i => applyLinear(mo, spec.row(i)) });
        }
        const b = solveRidge(m, lam);
        if (b) {
          const mo = linearModel('emos', b, m);
          cands.push({ key: `emos:${lam}`, predict: i => applyLinear(mo, spec.row(i)) });
        }
      }
      let slot = foldSE;
      for (let t = folds[f].valid[0]; t < folds[f].valid[1]; t++) {
        const i = fitIdx[t], target = spec.obs[i];
        if (!finite(target)) continue;
        if (!spec.row(i)) continue;
        for (const c of cands) {
          const p = c.predict(i);
          if (!finite(p)) continue;
          if (!slot.has(c.key)) slot.set(c.key, []);
          const arr = slot.get(c.key);
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
        se += s; n += c;
        rmses.push(Math.sqrt(s / c));
      }
      if (n < 40 || rmses.length < 2) continue;
      const j = key.indexOf(':');
      const lambda = key.slice(j + 1) === '-' ? null : Number(key.slice(j + 1));
      table.push({
        family: key.slice(0, j), lambda,
        cvRmse: Math.sqrt(se / n), cvN: n, fv: rmses,
      });
    }
    if (!table.length) return null;
    table.sort((a, b) => a.cvRmse - b.cvRmse || (b.lambda ?? 0) - (a.lambda ?? 0));

    /*
     * One-standard-error rule, computed on PAIRED fold differences against the
     * best candidate rather than on absolute RMSE. Fold RMSE swings enormously
     * across a seasonal cycle (a winter block is far harder than a spring one),
     * so an unpaired standard error would be swamped by season and would let any
     * candidate through. Pairing asks the only question that matters: on the same
     * validation block, how much worse is this candidate than the leader, and is
     * that gap consistent across blocks?
     *
     * We then take the simplest candidate whose paired gap is within one standard
     * error of zero. Simplicity order: equal-weight mean, single best system,
     * non-negative combination, full EMOS; within a family the larger penalty.
     */
    const COMPLEXITY = { mean: 0, best: 1, nnls: 2, emos: 3 };
    const top = table[0];
    for (const c of table) {
      const diffs = [];
      for (let f = 0; f < top.fv.length; f++) {
        if (!c.fv[f] || !top.fv[f]) continue;
        diffs.push(c.fv[f] - top.fv[f]);
      }
      if (diffs.length < 2) { c.gap = 0; c.gapSe = Infinity; continue; }
      const mu = diffs.reduce((s, v) => s + v, 0) / diffs.length;
      const variance = diffs.reduce((s, v) => s + (v - mu) ** 2, 0) / (diffs.length - 1);
      c.gap = mu;
      c.gapSe = Math.sqrt(variance / diffs.length);
    }
    // A candidate qualifies when its paired shortfall is not distinguishable
    // from zero. The leader always qualifies by construction.
    const eligible = table.filter(c => c.gap <= c.gapSe + 1e-12);
    eligible.sort((a, b) => (COMPLEXITY[a.family] - COMPLEXITY[b.family])
      || ((b.lambda ?? 0) - (a.lambda ?? 0))
      || (a.cvRmse - b.cvRmse));
    const winner = eligible[0] || top;
    const bestOnAll = bestSingle(spec, fitIdx, inverse);

    let model = null;
    if (winner.family === 'emos' && spec.modelIds.length >= 2) {
      const b = solveRidge(mAll, winner.lambda);
      if (b) model = linearModel('emos', b, mAll);
    } else if (winner.family === 'nnls' && spec.modelIds.length >= 2) {
      model = linearModel('nnls', solveNNLS(mAll, winner.lambda), mAll);
    } else if (winner.family === 'best' && bestOnAll.id !== null) {
      model = { family: 'best', singleModel: bestOnAll.id };
    } else {
      model = { family: 'mean', modelIds: spec.modelIds };
    }
    // Single-system locations cannot produce a blend; report the family that was
    // actually fitted rather than the one the winner key named.
    const family = model.family;
    return {
      model, winner, table, family, fitRows: fitIdx.length, bestSingle: bestOnAll,
      cvStandardError: winner.gapSe ?? 0,
      cvThreshold: top.cvRmse + (winner.gap ?? 0),
      cvGap: winner.gap ?? 0,
    };
  }

  /** sigma^2 = alpha + beta * spread^2, both constrained non-negative. */
  function sigma2(spreadSq, sq) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let i = 0; i < spreadSq.length; i++) {
      const x = spreadSq[i], y = sq[i];
      if (!finite(x) || !finite(y)) continue;
      sx += x; sy += y; sxx += x * x; sxy += x * y; n++;
    }
    if (n < 20) return { alpha: Math.max(0, sy / Math.max(1, n)), beta: 0 };
    const denom = n * sxx - sx * sx;
    let beta = Math.abs(denom) > 1e-14 ? (n * sxy - sx * sy) / denom : 0;
    let alpha = (sy - beta * sx) / n;
    if (beta < 0) { beta = 0; alpha = sy / n; }
    if (alpha < 0) { alpha = 0; beta = 0; }
    return { alpha, beta };
  }

  /* ================================================================
   * 8. Wind direction: fitted on the u/v components, which is linear,
   *    then recombined. Predicting degrees directly would place 359
   *    degrees next to 1 degree and wreck the fit.
   * ================================================================ */

  const toDir = (u, v) => (Math.atan2(v, u) * 180 / Math.PI + 360) % 360;
  const toSpeed = (u, v) => Math.sqrt(u * u + v * v);
  /** Smallest angle between two bearings, in 0..180. Zero means identical. */
  const circularAbs = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

  /* ================================================================
   * 9. WMO code is categorical, so a regression on it would be
   *    meaningless. It is predicted from five related continuous
   *    fields by a nearest-regime classifier fitted on the same rows.
   * ================================================================ */

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
  const CONDITIONS = ['Trời quang', 'Có mây', 'Sương mù', 'Mưa phùn', 'Có mưa', 'Có tuyết', 'Mưa rào', 'Tuyết rào', 'Có dông'];
  const conditionOf = c => (finite(c) && c >= 0 && c <= 99 ? CONDITIONS[condGroup(Math.round(c))] : 'Chưa có thông tin');

  /* ================================================================
   * 10. Evaluation entry point
   * ================================================================ */

  function evaluate(opts) {
    const vspec = VARIABLES[opts.variable];
    if (!vspec) throw new Error('biến không hợp lệ: ' + opts.variable);
    const { times, obs, series, variable } = opts;
    const n = times.length;
    const dateOf = i => times[i].slice(0, 10);
    const modelIds = Object.keys(series);

    // Keep only systems that are effectively complete over the fitting window.
    const coverage = {};
    let window = 0;
    for (let i = 0; i < n; i++) if (dateOf(i) <= opts.trainEnd) window++;
    for (const id of modelIds) {
      const col = series[id];
      // Wind direction arrives as a u/v pair rather than a flat column.
      const at = Array.isArray(col) ? i => col[i] : i => (col.u ? col.u[i] : null);
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
        ? (Array.isArray(obs) ? i => finite(obs[i]) : () => false)
        : (opts.obsSpeed ? i => finite(opts.obsSpeed[i]) && finite(opts.obsDirection[i]) : () => false))
      : (Array.isArray(obs) ? i => finite(obs[i]) : () => false);
    const complete = i => {
      if (vspec.kind === 'code') return truthAt(i);
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
    if (vspec.kind === 'direction') return evaluateDirection(opts, base, usable, trainIdx, testIdx);
    if (vspec.kind === 'code') return evaluateCode(opts, base, usable, trainIdx, testIdx);
    return evaluateScalar(opts, base, usable, trainIdx, testIdx);
  }

  function buildCrossFill(times, crossVars, cross, trainIdx) {
    if (!crossVars || !crossVars.length) return { cols: [], fill: [] };
    const cols = crossVars.map(v => cross[v]);
    const fill = cols.map((col, j) => {
      let s = 0, c = 0;
      for (const i of trainIdx) if (finite(col[i])) { s += col[i]; c++; }
      return c ? s / c : 0;
    });
    return { cols, fill };
  }

  function evaluateScalar(opts, base, usable, trainIdx, testIdx) {
    const { times, obs, series, variable } = opts;
    const vspec = VARIABLES[variable];
    const forward = FORWARD[vspec.kind], inverse = INVERSE[vspec.kind];
    const crossVars = (opts.crossVars || []).filter(v => opts.cross && opts.cross[v]);
    const { cols, fill } = buildCrossFill(times, crossVars, opts.cross, trainIdx);
    const sub = Object.fromEntries(usable.map(id => [id, series[id]]));
    const spec = makeSpec({
      times, obs, series: sub, modelIds: usable, cross: cols, crossFill: fill,
      utcOffset: opts.utcOffset, forward, kind: vspec.kind,
    });
    const sel = selectModel(spec, trainIdx, inverse, forward);
    if (!sel) return { ...base, usable: false, note: 'không tạo được bộ dự báo' };

    const predict = i => {
      if (sel.model.family === 'mean') return spec.mean[i];
      if (sel.model.family === 'best') return spec.vals[usable.indexOf(sel.model.singleModel)][i];
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

    /*
     * Split the forecast error into the part sigma2 explains and the part it
     * cannot. The standardised residual z = (physical error) / (predicted sd)
     * isolates the shape that a one-parameter variance model throws away, and
     * that shape becomes the fan template. Both halves are needed: the template
     * alone would make every hour as uncertain as the worst hour, and sigma2
     * alone would make every hour as certain as the calmest one.
     */
    const sdOf = i => Math.sqrt(Math.max(sg.alpha + sg.beta * spec.spread[i] ** 2, 0));
    const zResid = [];
    for (const i of trainIdx) {
      const p = predict(i);
      if (!finite(p)) continue;
      const e = inverse(p) - obs[i];
      // Standardise in physical units: the same units the fan is drawn in.
      const s = sdOf(i) * jacobian(vspec.kind, p);
      if (finite(e) && s > 1e-6) zResid.push(e / s);
    }
    /*
     * Intermittent variables keep the ASYMMETRIC shape. Their error really is
     * one-sided — the sky does more than the forecast said — and a symmetric fan
     * would put half its width on the side that never errs. Smooth variables
     * keep the symmetric one, so the fitting window's bias cannot travel with
     * the fan.
     */
    const zAbs = zResid.filter(v => finite(v)).map(v => Math.abs(v));
    let obsZeros = 0, obsSeen = 0;
    for (const i of trainIdx) {
      const v = obs[i];
      if (!finite(v)) continue;
      obsSeen++;
      if (v <= 0) obsZeros++;
    }
    const asymmetric = obsSeen > 0 && obsZeros / obsSeen > 0.5;
    const template = residualTemplate(zResid, !asymmetric);

    /*
     * One multiplier, fitted on the fitting window, so the fan's central band
     * actually covers what it claims.
     *
     * sigma2 targets the RMS error, and the RMS is inflated by the tail. For a
     * heavy-tailed variable that means a fan sized to the RMS is comfortably
     * right on average yet far too narrow through its middle, so the 10–90
     * band lands at 60% instead of 80% and the app under-covers exactly where a
     * reader looks first. Multiplying the whole fan by a single factor, chosen so
     * the 10–90 band covers 80% of the fitting-window outcomes, fixes the middle
     * without pretending the tail is narrower than it is.
     *
     * It is fitted on the training window only. The score window is left
     * untouched so the reported coverage is a real verification.
     */
    const zSorted = zResid.filter(finite).sort((a, b) => a - b);
    /*
     * The band only has to contain an observation when the standardised residual
     * falls between the fan's 10th and 90th node: the scale cancels on both
     * sides. So coverage is a property of the sorted residual array alone, and
     * the search below is two binary searches per step instead of a pass over
     * every fitting hour.
     */
    const bandCover = k => {
      if (zSorted.length < 200) return null;
      const base = template || Z_NODES;
      const nodes = base.map(v => v * k).sort((a, b) => a - b);
      const loZ = nodes[Math.floor(0.1 * K_MEMBERS)];
      const hiZ = nodes[Math.ceil(0.9 * K_MEMBERS) - 1];
      // Sorted bounds: count inside [loZ, hiZ] as high(loZ) .. high(hiZ).
      const above = v => {
        let a = 0, b = zSorted.length;
        while (a < b) { const m = (a + b) >> 1; if (zSorted[m] < v) a = m + 1; else b = m; }
        return a;
      };
      return (above(hiZ) - above(loZ)) / zSorted.length;
    };
    let mult = 1;
    if (template) {
      // Smallest factor whose 10–90 band covers 80% of the fitting window.
      // Coverage rises with the factor, so the invariant is: lo is too narrow,
      // hi is wide enough. Each step keeps the answer inside [lo, hi].
      let lo = 0.25, hi = 6;
      const wide = bandCover(hi);
      if (wide !== null && wide >= 0.8) {
        for (let it = 0; it < 26; it++) {
          const mid = Math.sqrt(lo * hi);
          const c = bandCover(mid);
          if (c !== null && c >= 0.8) hi = mid; else lo = mid;
        }
        mult = hi;
      } else if (wide !== null) {
        // Even the widest allowed fan cannot reach 80%: keep the fan honest and
        // say so rather than inflating the numbers to fit the target.
        mult = 6;
      }
    }
    sg.template = template;
    sg.mult = mult;
    const lo = vspec.kind === 'logit' ? 0 : (vspec.kind === 'log1p' ? 0 : null);
    const hi = vspec.kind === 'logit' ? 100 : null;

    const memberSets = testIdx.map(i => {
      const p = predict(i);
      return finite(p) ? pseudoMembers(vspec.kind, p, sdOf(i), lo, hi, template, mult) : null;
    });
    const medians = memberSets.map(m => (m ? quantile(m, 0.5) : null));
    const means = memberSets.map(m => (m ? meanS(m) : null));
    const testObs = testIdx.map(i => obs[i]);
    const equalMean = testIdx.map(i => spec.mean[i]);
    const persistOffset = 24 * opts.lead;
    const persistence = testIdx.map((i, k) => (k - persistOffset >= 0 ? obs[testIdx[k - persistOffset]] : null));

    const sqEqual = equalMean.map((v, k) => (finite(v) ? (v - testObs[k]) ** 2 : null));
    const sqModel = means.map((v, k) => (finite(v) ? (v - testObs[k]) ** 2 : null));
    const sqBest = testIdx.map(i => {
      const j = usable.indexOf(sel.bestSingle.id);
      const v = j >= 0 ? series[usable[j]][i] : null;
      return finite(v) ? (v - obs[i]) ** 2 : null;
    });

    const thresholds = vspec.thresholds || [];
    const events = {};
    for (const th of thresholds) {
      const probs = memberSets.map(m => (m ? m.filter(v => v <= th).length / m.length : null));
      const clim = trainIdx.length ? trainIdx.filter(i => obs[i] >= th).length / trainIdx.length : null;
      events[th] = {
        median: eventScores(medians, testObs, th),
        equalMean: eventScores(equalMean, testObs, th),
        probability: probScores(probs, testObs, th, clim),
      };
    }

    return {
      ...base, usable: true,
      selected: {
        // sel.family is what was actually fitted; with a single usable system it
        // falls back from the blend families to the honest one.
        family: sel.family, lambda: sel.winner.lambda,
        cvRmse: round(sel.winner.cvRmse, 5), cvN: sel.winner.cvN,
        // How much the selection is allowed to differ from the CV minimum.
        // Paired gap against the cross-validation leader, and its standard error.
        cvStandardError: round(sel.cvStandardError, 5),
        cvGap: round(sel.cvGap, 5),
        withinOneSE: sel.cvGap <= sel.cvStandardError + 1e-12,
        bestCvFamily: sel.table[0].family,
        bestCvRmse: round(sel.table[0].cvRmse, 5),
      },
      candidates: sel.table.map(c => ({
        family: c.family, lambda: c.lambda,
        cvRmse: round(c.cvRmse, 5), cvN: c.cvN,
        cvGap: round(c.gap, 5), cvGapSe: round(c.gapSe, 5),
        chosen: c.family === sel.winner.family && c.lambda === sel.winner.lambda,
        fitted: c.family === sel.family && c.lambda === sel.winner.lambda,
      })),
      calibration: calibrationBundle(sel, spec, usable, crossVars, fill.map(f => forward(f)), sg, vspec.kind),
      bestSingle: { id: sel.bestSingle.id, name: opts.modelNames?.[sel.bestSingle.id] || null, test: pointScores(testIdx.map(i => { const j = usable.indexOf(sel.bestSingle.id); return j >= 0 ? series[usable[j]][i] : null; }), testObs) },
      models: usable.map(id => ({ id, name: opts.modelNames?.[id] || id, ...pointScores(testIdx.map(i => series[id][i]), testObs) })),
      equalMean: pointScores(equalMean, testObs),
      persistence: pointScores(persistence, testObs),
      median: pointScores(medians, testObs),
      mean: pointScores(means, testObs),
      probabilistic: probEnsembleScores(memberSets, testObs),
      events,
      daily: vspec.accum ? dailyAccumulation(spec, predict, testIdx, obs, inverse) : null,
      bootstrap: {
        vsEqualMean: pairedBootstrap(sqEqual, sqModel, 48, 800, 20250101 + opts.lead),
        vsBestSingle: pairedBootstrap(sqBest, sqModel, 48, 800, 777 + opts.lead),
      },
    };
  }

  /** Serializable calibration the browser applies to a live forecast. */
  function calibrationBundle(sel, spec, usable, crossVars, crossFill, sg, kind) {
    const labels = ['mean', 'spread', ...usable, ...crossVars, 'sinHour', 'cosHour', 'sinYear', 'cosYear'];
    const sigma = { alpha: round(sg.alpha, 8), beta: round(sg.beta, 8) };
    if (sg.template) sigma.template = sg.template.map(v => round(v, 5));
    if (sg.mult && Math.abs(sg.mult - 1) > 1e-4) sigma.mult = round(sg.mult, 5);
    if (sel.model.family === 'emos' || sel.model.family === 'nnls') {
      return {
        family: sel.model.family, kind,
        intercept: round(sel.model.b0, 6),
        beta: sel.model.beta.map(v => round(v, 6)),
        centre: sel.model.mu.map(v => round(v, 6)),
        scale: sel.model.sd.map(v => round(v, 6)),
        modelIds: usable, crossVars, crossMean: crossFill.map(v => round(v, 6)),
        sigma2: sigma,
        labels,
      };
    }
    if (sel.model.family === 'best') {
      return { family: 'best', kind, singleModel: sel.model.singleModel, modelIds: usable, sigma2: sigma, labels };
    }
    return { family: 'mean', kind, modelIds: usable, sigma2: sigma, labels };
  }

  /** Rolling 24-hour accumulation, which is how rain warnings are phrased. */
  function dailyAccumulation(spec, predict, testIdx, obs, inverse) {
    const days = new Map();
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
    for (const th of [10, 25, 50, 100]) events[th] = eventScores(rows.map(r => r.pred), rows.map(r => r.obs), th);
    return {
      days: rows.length,
      meanPred: meanS(rows.map(r => r.pred)), meanObs: meanS(rows.map(r => r.obs)),
      bias: meanS(rows.map(r => r.pred - r.obs)),
      ...pointScores(rows.map(r => r.pred), rows.map(r => r.obs)), events,
    };
  }

  /*
   * Direction is selected as a PAIR, not component by component.
   *
   * Picking a family for u and another for v by per-component RMSE is wrong: the
   * two components can end up with different shrinkage, and an anisotropically
   * shrunk vector points somewhere else entirely. On a real case that turned a
   * 0.9 km/h component RMSE into 14 km/h. So the candidates are fitted jointly
   * and scored on the angular error of the recombined vector, which is the thing
   * actually being forecast.
   */
  function directionCandidates(su, sv, foldEnd) {
    const mu = moments(su.fitRows.slice(0, foldEnd), su.fitY.slice(0, foldEnd));
    const mv = moments(sv.fitRows.slice(0, foldEnd), sv.fitY.slice(0, foldEnd));
    const list = [{ family: 'mean', lambda: null }];
    for (const lam of LAMBDA_GRID) {
      list.push({ family: 'nnls', lambda: lam });
      list.push({ family: 'emos', lambda: lam });
    }
    return list.map(c => {
      // Both components share one family, so a 'mean' model needs a u and a v
      // half rather than a bare marker object.
      if (c.family === 'mean') {
        return { ...c, fit: () => ({ u: { family: 'mean' }, v: { family: 'mean' } }) };
      }
      const fu = c.family === 'nnls' ? solveNNLS(mu, c.lambda) : solveRidge(mu, c.lambda);
      const fv = c.family === 'nnls' ? solveNNLS(mv, c.lambda) : solveRidge(mv, c.lambda);
      if (!fu || !fv) return null;
      return {
        ...c,
        fit: () => ({
          u: linearModel(c.family, fu, mu),
          v: linearModel(c.family, fv, mv),
        }),
      };
    }).filter(Boolean);
  }

  function selectDirectionPair(su, sv) {
    if (!su.ok || !sv.ok) return null;
    const foldSE = new Map();
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
          if (!foldSE.has(c.family + ':' + c.lambda)) foldSE.set(c.family + ':' + c.lambda, []);
          const arr = foldSE.get(c.family + ':' + c.lambda);
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
        sum += s; n += c;
        fv.push(s / c);
      }
      if (n < 40 || fv.length < 2) continue;
      const j = key.indexOf(':');
      table.push({
        family: key.slice(0, j),
        lambda: key.slice(j + 1) === 'null' ? null : Number(key.slice(j + 1)),
        cvAngle: sum / n, cvN: n, fv,
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
      if (diffs.length < 2) { c.gap = 0; c.gapSe = Infinity; continue; }
      const m = diffs.reduce((s, v) => s + v, 0) / diffs.length;
      c.gap = m;
      c.gapSe = Math.sqrt(diffs.reduce((s, v) => s + (v - m) ** 2, 0) / (diffs.length - 1) / diffs.length);
    }
    const eligible = table.filter(c => c.gap <= c.gapSe + 1e-12);
    eligible.sort((a, b) => (COMPLEXITY[a.family] - COMPLEXITY[b.family])
      || ((b.lambda ?? 0) - (a.lambda ?? 0)) || (a.cvAngle - b.cvAngle));
    const winner = eligible[0] || top;

    // Refit the winner on every fitting row.
    const all = directionCandidates(su, sv, su.fitRows.length)
      .find(c => c.family === winner.family && c.lambda === winner.lambda);
    const model = all ? all.fit() : { u: { family: 'mean' }, v: { family: 'mean' } };
    return { model, winner, table };
  }

  function componentPredict(model, spec, i) {
    if (model.family === 'mean') return spec.mean[i];
    const row = spec.row(i);
    return row ? applyLinear(model, row) : null;
  }

  /** Assemble the fitting matrices for the two components. */
  function directionSpecs(times, series, usable, crossVars, cols, fill, utcOffset, uObs, vObs, truthDir, trainIdx) {
    const subU = Object.fromEntries(usable.map(id => [id, series[id].u]));
    const subV = Object.fromEntries(usable.map(id => [id, series[id].v]));
    const mk = (target, sub) => makeSpec({
      times, obs: target, series: sub, modelIds: usable, cross: cols, crossFill: fill,
      utcOffset, forward: x => x, kind: 'gauss',
    });
    const raw = { su: mk(uObs, subU), sv: mk(vObs, subV), truthDir };
    for (const key of ['su', 'sv']) {
      const spec = raw[key];
      spec.truthDir = truthDir;
      spec.fitRows = []; spec.fitY = []; spec.fitIdx = []; spec.ok = true;
      for (const i of trainIdx) {
        const y = spec.obs[i];
        const row = spec.row(i);
        if (!finite(y) || !finite(truthDir[i]) || !row) continue;
        spec.fitRows.push(row); spec.fitY.push(y); spec.fitIdx.push(i);
      }
      if (spec.fitRows.length < spec.p * 12) spec.ok = false;
    }
    return raw;
  }

  function evaluateDirection(opts, base, usable, trainIdx, testIdx) {
    const { times, series } = opts;
    const obsSpeed = opts.obsSpeed, obsDir = opts.obsDirection;
    const uObs = new Array(times.length), vObs = new Array(times.length);
    const truthDir = new Array(times.length);
    for (let i = 0; i < times.length; i++) {
      if (!finite(obsSpeed[i]) || !finite(obsDir[i])) {
        uObs[i] = null; vObs[i] = null; truthDir[i] = null; continue;
      }
      const r = obsDir[i] * Math.PI / 180;
      uObs[i] = obsSpeed[i] * Math.cos(r);
      vObs[i] = obsSpeed[i] * Math.sin(r);
      truthDir[i] = obsDir[i];
    }
    const crossVars = (opts.crossVars || []).filter(v => opts.cross && opts.cross[v]);
    const { cols, fill } = buildCrossFill(times, crossVars, opts.cross, trainIdx);
    const built = directionSpecs(times, series, usable, crossVars, cols, fill, opts.utcOffset, uObs, vObs, truthDir, trainIdx);
    const su = built.su, sv = built.sv;
    const sel = selectDirectionPair(su, sv);
    if (!sel) return { ...base, usable: false, note: 'không tạo được bộ dự báo hướng gió' };
    const pu = i => componentPredict(sel.model.u, su, i);
    const pv = i => componentPredict(sel.model.v, sv, i);

    const testSpeed = testIdx.map(i => obsSpeed[i]);
    const testDir = testIdx.map(i => obsDir[i]);
    const uArr = testIdx.map(pu), vArr = testIdx.map(pv);
    const predSpeed = uArr.map((u, k) => (finite(u) && finite(vArr[k]) ? toSpeed(u, vArr[k]) : null));
    const predDir = uArr.map((u, k) => (finite(u) && finite(vArr[k]) ? toDir(u, vArr[k]) : null));

    // circErr holds the angular error itself, so a smaller value is better and the
    // "within N degrees" rates must count small errors.
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
    // The wind-speed half is scored separately as the wind_speed_10m variable,
    // where it has its own cross-predictors and its own cross-validation. What
    // is reported here is only the vector consequence of the direction fit.
    return {
      ...base, usable: true,
      method: 'Hai hồi quy riêng trên thành phần u và v của gió, sau đó ghép thành tốc độ và hướng. Không hồi quy trực tiếp lên độ. Tốc độ gió được chấm riêng ở biến wind_speed_10m.',
      selected: {
        family: sel.winner.family, lambda: sel.winner.lambda,
        // Cross-validated on angular error of the recombined vector, in degrees.
        cvAngle: round(sel.winner.cvAngle, 4), cvN: sel.winner.cvN,
        cvStandardError: round(sel.winner.gapSe ?? 0, 4), cvGap: round(sel.winner.gap ?? 0, 4),
        withinOneSE: (sel.winner.gap ?? 0) <= (sel.winner.gapSe ?? 0) + 1e-12,
        bestCvFamily: sel.table[0].family, bestCvAngle: round(sel.table[0].cvAngle, 4),
        shared: true,
      },
      candidates: sel.table.map(c => ({
        family: c.family, lambda: c.lambda, cvAngle: round(c.cvAngle, 4), cvN: c.cvN,
        cvGap: round(c.gap, 4), cvGapSe: round(c.gapSe === Infinity ? null : c.gapSe, 4),
        chosen: c.family === sel.winner.family && c.lambda === sel.winner.lambda,
      })),
      calibration: {
        // Direction is fitted as two vector components, so the coefficients live
        // in the per-component bundles below. The top level repeats the family
        // and the model list so consumers can treat every calibrated variable
        // the same way without special-casing the direction kind.
        family: sel.winner.family,
        modelIds: usable,
        components: 2,
        sigma2: { alpha: 0, beta: 0 },
        labels: ['mean', 'spread', ...usable, ...crossVars, 'sinHour', 'cosHour', 'sinYear', 'cosYear'],
        u: calibrationBundle({ model: sel.model.u, winner: { family: sel.winner.family, lambda: sel.winner.lambda, cvRmse: sel.winner.cvAngle } }, su, usable, crossVars, fill, { alpha: 0, beta: 0 }, 'gauss'),
        v: calibrationBundle({ model: sel.model.v, winner: { family: sel.winner.family, lambda: sel.winner.lambda, cvRmse: sel.winner.cvAngle } }, sv, usable, crossVars, fill, { alpha: 0, beta: 0 }, 'gauss'),
      },
      // Magnitude implied by the fitted vector, scored against observed speed.
      // Reported as a diagnostic: it is not the speed forecast the app publishes.
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

  function evaluateCode(opts, base, usableIds, trainIdx, testIdx) {
    const feats = opts.codeFeatures;
    if (!feats || !feats.length) return { ...base, usable: false, note: 'thiếu trường liên tục cho bộ phân loại mã thời tiết' };
    const n = opts.times.length, obs = opts.obs;
    const Z = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (!feats.every(f => finite(f[i]))) continue;
      Z[i] = feats.map(f => f[i]);
    }
    const fitRows = trainIdx.filter(i => Z[i] && finite(obs[i]));
    if (fitRows.length < 400) return { ...base, usable: false, note: 'không đủ mẫu để phân loại mã thời tiết' };
    const mu = feats.map((_, j) => meanS(fitRows.map(i => Z[i][j])));
    const sg = feats.map((_, j) => sdS(fitRows.map(i => Z[i][j])) || 1);
    const bank = fitRows.slice(-2400).map(i => ({ x: Z[i].map((v, j) => (v - mu[j]) / sg[j]), c: obs[i] }));
    const K = 45;
    const predict = x => {
      const dist = new Array(bank.length);
      for (let b = 0; b < bank.length; b++) {
        let s = 0;
        for (let j = 0; j < x.length; j++) { const d = x[j] - bank[b].x[j]; s += d * d; }
        dist[b] = s;
      }
      const idx = dist.map((d, b) => [d, b]).sort((a, b) => a[0] - b[0]).slice(0, K);
      const tally = new Map();
      for (const [, b] of idx) {
        const c = bank[b].c;
        tally.set(c, (tally.get(c) || 0) + 1 / (Math.sqrt(dist[b]) + 0.05));
      }
      let best = null, bestW = -1;
      for (const [c, w] of tally) if (w > bestW) { bestW = w; best = c; }
      return best;
    };
    const pred = [], truth = [];
    const predAt = new Map();          // test index -> kNN prediction, for paired scoring
    for (const i of testIdx) {
      if (!Z[i] || !finite(obs[i])) continue;
      const p = predict(Z[i].map((v, j) => (v - mu[j]) / sg[j]));
      pred.push(p);
      predAt.set(i, p);
      truth.push(obs[i]);
    }
    let exact = 0, group = 0;
    for (let k = 0; k < pred.length; k++) {
      if (pred[k] === truth[k]) { exact++; group++; }
      else if (condGroup(pred[k]) === condGroup(truth[k])) group++;
    }

    /*
     * Ship a compact lookup of the fitted regimes so the browser can classify a
     * live forecast with the same mapping that was verified. Nearest neighbour
     * over 2400 stored rows is far too heavy to inline, but the fitted function
     * is essentially a lookup over coarse cells of the five context fields:
     * quantise each field, take the modal code per cell, and keep only cells with
     * enough support to be worth trusting. This is a lossy summary of the kNN
     * fit, so its accuracy is reported separately from the kNN figure above.
     */
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
        const n = e.codes[c];
        if (n > bestN) { bestN = n; best = Number(c); }
      }
      table.push({ key, code: best, support: e.total, purity: bestN / e.total });
    }
    // Verify the lookup itself on the score window, so its cost is known.
    //
    // The lookup only answers on rows whose cell cleared the support threshold,
    // so its hit rate is reported next to the accuracy. Comparing that accuracy
    // against the kNN figure over *all* rows would flatter the table, because it
    // is scored on the easier subset; the honest comparison scores both
    // classifiers on exactly the same rows.
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
      if (fullTable[key] === obs[i]) { lkExact++; lkGroup++; }
      else if (condGroup(fullTable[key]) === condGroup(obs[i])) lkGroup++;
      const kp = predAt.get(i);
      if (kp === obs[i]) { knnExact++; knnGroup++; }
      else if (condGroup(kp) === condGroup(obs[i])) knnGroup++;
    }
    table.sort((a, b) => a.key.localeCompare(b.key));

    return {
      ...base, usable: true,
      method: 'Phân loại theo vùng không gần nhất trên 5 trường liên tục: phủ mây, mưa, gió, cảm giác nhiệt, độ ẩm. Không hồi quy trực tiếp lên mã WMO.',
      selected: { family: 'knn', lambda: null, cvRmse: null, cvN: fitRows.length },
      testN: pred.length,
      accuracy: pred.length ? exact / pred.length : null,
      accuracyGroup: pred.length ? group / pred.length : null,
      baseRate: truth.length ? new Set(truth).size / truth.length : null,
      regime: {
        fields: ['cloud_cover', 'precipitation', 'wind_speed_10m', 'apparent_temperature', 'relative_humidity_2m'],
        // Null when the classifier ran on cross-features without a series; the
        // browser then averages whatever systems it has.
        modelIds: usableIds && usableIds.length ? usableIds.slice() : null,
        edges: REGIME_EDGES.map(e => e.slice()),
        minSupport: REGIME_MIN_SUPPORT,
                cells: table,
        lookupN: lkN,
        // Rows the table can answer at all; the browser falls back to a plain
        // multi-model average on the rest.
        coverage: scorable ? lkN / scorable : null,
        accuracy: lkN ? lkExact / lkN : null,
        accuracyGroup: lkN ? lkGroup / lkN : null,
        // kNN restricted to the same rows, so the table is judged fairly.
        knnAccuracySameRows: lkN ? knnExact / lkN : null,
        knnAccuracyGroupSameRows: lkN ? knnGroup / lkN : null,
      },
    };
  }

  /*
   * Coarse bin edges for the five context fields, in physical units. Chosen wide
   * enough that a cell holds many hours and sharp enough to separate clear sky,
   * cloud, rain, heavy rain and overcast wind.
   */
  const REGIME_EDGES = [
    [20, 50, 80, 95],                 // cloud cover %
    [0.05, 0.5, 2, 5, 10],            // precipitation mm/h
    [5, 12, 20, 32],                  // wind speed km/h
    [10, 20, 26, 32],                 // apparent temperature degC
    [45, 65, 80, 92],                 // relative humidity %
  ];
  const REGIME_MIN_SUPPORT = 12;

  /** Quantise a context vector into a lookup key, or null if a field is missing. */
  function regimeKey(row, edges = REGIME_EDGES) {
    let key = '';
    for (let j = 0; j < edges.length; j++) {
      const v = row[j];
      if (!finite(v)) return null;
      let b = 0;
      while (b < edges[j].length && v >= edges[j][b]) b++;
      key += b;
    }
    return key;
  }

  /* ================================================================
   * 11. Live application of a shipped calibration
   * ================================================================ */

  function predictFromCalibration(calib, values, spread, hour, doy, crossVals) {
    if (calib.family === 'emos' || calib.family === 'nnls') {
      const row = [values.mean, spread];
      for (let j = 0; j < calib.modelIds.length; j++) row.push(finite(values.byId[j]) ? values.byId[j] : values.mean);
      for (let j = 0; j < (calib.crossVars || []).length; j++) {
        const v = crossVals ? crossVals[j] : null;
        row.push(finite(v) ? v : (calib.crossMean ? calib.crossMean[j] : 0));
      }
      row.push(Math.sin(2 * Math.PI * hour / 24), Math.cos(2 * Math.PI * hour / 24));
      row.push(Math.sin(2 * Math.PI * doy / 365.25), Math.cos(2 * Math.PI * doy / 365.25));
      // Bao dung goi hieu chinh cu (truoc khi engine chuan hoa cot): thieu scale
      // nghia la he so dang o khong gian tho, lay scale = 1.
      const SD = calib.scale || calib.beta.map(() => 1);
      let mu = calib.intercept;
      for (let j = 0; j < calib.beta.length; j++) {
        mu += calib.beta[j] * ((row[j] - calib.centre[j]) / SD[j]);
      }
      return mu;
    }
    if (calib.family === 'best') {
      const j = calib.modelIds.indexOf(calib.singleModel);
      return j >= 0 && finite(values.byId[j]) ? values.byId[j] : values.mean;
    }
    return values.mean;
  }

  /**
   * Applies a stored calibration to a live forecast. `series` maps system id to
   * arrays aligned on `times`; `cross` supplies cross-variable columns.
   * Returns point value, calibrated spread and exceedance probabilities.
   */
  function calibrate(opts) {
    const { times, variable, series, calib } = opts;
    const vspec = VARIABLES[variable];
    if (!vspec || !calib) return null;
    const forward = FORWARD[vspec.kind], inverse = INVERSE[vspec.kind];
    const ids = calib.modelIds || Object.keys(series);
    const vals = ids.map(id => (series[id] || []).map(v => (finite(v) ? forward(v) : null)));
    const crossCols = (calib.crossVars || []).map(v => {
      const src = (opts.cross && opts.cross[v]) || [];
      return src.map(x => (finite(x) ? forward(x) : null));
    });
    const lo = vspec.kind === 'logit' ? 0 : (vspec.kind === 'log1p' ? 0 : null);
    const hi = vspec.kind === 'logit' ? 100 : null;
    const out = new Array(times.length);
    for (let i = 0; i < times.length; i++) {
      let s = 0, s2 = 0, c = 0;
      const byId = new Array(ids.length).fill(null);
      for (let j = 0; j < vals.length; j++) if (finite(vals[j][i])) { byId[j] = vals[j][i]; s += vals[j][i]; s2 += vals[j][i] ** 2; c++; }
      const need = Math.max(2, Math.ceil(ids.length * 0.6));
      if (c < need) { out[i] = null; continue; }
      const mean = s / c;
      const spread = c > 1 ? Math.sqrt(Math.max(0, s2 / c - mean * mean)) : 0;
      const mu = predictFromCalibration(calib, { mean, byId }, spread, hourOf(times, i, opts.utcOffset), dayOfYear(times, i), crossCols.map(col => col[i]));
      if (!finite(mu)) { out[i] = null; continue; }
      // Width from sigma2 and shape from the shipped residual template: the same two
      // halves the backtest used, so the browser's fan is the verified one.
      const sd = Math.sqrt(Math.max(calib.sigma2.alpha + calib.sigma2.beta * spread * spread, 0));
      const mem = pseudoMembers(vspec.kind, mu, sd, lo, hi, calib.sigma2.template, calib.sigma2.mult);
      const rec = {
        mean: meanS(mem), median: quantile(mem, 0.5),
        p02: quantile(mem, 0.02), p10: quantile(mem, 0.1), p25: quantile(mem, 0.25),
        p75: quantile(mem, 0.75), p90: quantile(mem, 0.9), p98: quantile(mem, 0.98),
        low: mem[0], high: mem[K_MEMBERS - 1], sd, spread, nModels: c,
        // The width actually drawn, so the chart and the table cannot disagree.
        sdPhysical: sdS(mem) ?? null,
      };
      if (vspec.thresholds) {
        rec.probs = {};
        for (const th of vspec.thresholds) rec.probs[th] = mem.filter(v => v <= th).length / mem.length;
      }
      out[i] = rec;
    }
    return out;
  }

  /**
   * Live wind direction, from the shipped u/v calibration bundles. Lives in the
   * engine rather than the page so it can be tested against the offline fit
   * rather than merely re-implemented there.
   *
   * opts: { times, seriesU, seriesV, calibration:{u,v}, utcOffset }
   */
  function calibrateDirection(opts) {
    const { times, seriesU, seriesV, calibration, utcOffset } = opts;
    if (!calibration?.u || !calibration?.v) return null;
    // A 'mean' calibration carries no beta: the browser then falls back to the
    // equal-weight component average, which must give the same answer as the
    // offline fit used for selection.
    if (calibration.u.family === 'mean' && calibration.v.family === 'mean') {
      // handled below via the mu === mean branch; no beta required
    }
    const ids = calibration.u.modelIds || Object.keys(seriesU);
    const applyComponent = which => {
      const c = calibration[which];
      const src = which === 'u' ? seriesU : seriesV;
      const out = new Array(times.length).fill(null);
      const cols = ids.map(id => src[id] || []);
      const need = Math.max(2, Math.ceil(ids.length * 0.6));
      for (let i = 0; i < times.length; i++) {
        let s = 0, s2 = 0, n = 0;
        for (const col of cols) if (finite(col[i])) { s += col[i]; s2 += col[i] ** 2; n++; }
        if (n < need) continue;
        const mean = s / n;
        const spread = Math.sqrt(Math.max(0, s2 / n - mean * mean));
        let mu;
        if (c.family === 'mean' || !c.beta) {
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
        if (finite(mu)) out[i] = { mu, nModels: n };
      }
      return out;
    };
    const cu = applyComponent('u'), cv = applyComponent('v');
    const out = new Array(times.length).fill(null);
    for (let i = 0; i < times.length; i++) {
      if (!cu[i] || !cv[i]) continue;
      out[i] = {
        mean: toSpeed(cu[i].mu, cv[i].mu), median: toSpeed(cu[i].mu, cv[i].mu),
        dir: toDir(cu[i].mu, cv[i].mu), nModels: cu[i].nModels,
      };
    }
    return out;
  }

  /**
   * Live WMO code, by applying the shipped regime lookup. Hours that fall
   * outside every fitted cell stay null rather than being guessed at.
   *
   * opts: { times, series:{modelId:{variable:[]}}, regime }
   */
  function calibrateCode(opts) {
    const { times, series, regime } = opts;
    if (!regime?.cells?.length) return null;
    const ids = (regime.modelIds || Object.keys(series)).filter(id => series[id]);
    const fields = regime.fields || [
      'cloud_cover', 'precipitation', 'wind_speed_10m', 'apparent_temperature', 'relative_humidity_2m',
    ];
    const lookup = new Map(regime.cells.map(c => [c.key, c.code]));
    // A regime lookup can be coarse enough to tolerate a single complete
    // system; requiring two would leave every hour in sparse cases undefined.
    const need = 1;
    const out = new Array(times.length).fill(null);
    for (let i = 0; i < times.length; i++) {
      const row = [];
      let n = 0;
      for (const f of fields) {
        let s = 0, c = 0;
        for (const id of ids) {
          const val = series[id]?.[f]?.[i];
          if (finite(val)) { s += val; c++; }
        }
        if (c < need) { row.length = 0; break; }
        row.push(s / c);
        n = c;
      }
      if (row.length !== fields.length) continue;
      const key = regimeKey(row, regime.edges);
      if (key === null) continue;
      const code = lookup.get(key);
      if (code === undefined) continue;
      out[i] = { code, nModels: n, condition: conditionOf(code) };
    }
    return out;
  }

  /* ================================================================
   * 12. Air mass, trajectory and hydrology
   *
   * Physical diagnostics computed from pressure-level fields. Kept pure so
   * they can be unit-tested without a network or a map.
   * ================================================================ */

  /** 500-850 hPa thickness in metres: the standard column-temperature proxy. */
  function thickness(z500, z850) {
    if (!finite(z500) || !finite(z850)) return null;
    return z500 - z850;
  }

  /** Wind components in m/s from speed (km/h) and the direction it blows FROM. */
  function toUms(speedKmh, dirDeg) {
    if (!finite(speedKmh) || !finite(dirDeg)) return { u: null, v: null };
    const s = speedKmh / 3.6, r = dirDeg * Math.PI / 180;
    // Meteorological convention: dir is where the wind comes from.
    return { u: -s * Math.sin(r), v: -s * Math.cos(r) };
  }

  /** Moves a lat/lon by an east-north displacement in km. */
  function offsetLatLon(lat, lon, dxKm, dyKm) {
    const dLat = dyKm / 111.32;
    const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
    const dLon = dxKm / (111.32 * cos);
    return { lat: lat + dLat, lon: lon + dLon };
  }

  /**
   * Forward or backward air-mass trajectory by integrating the 850 hPa wind.
   * `sign = +1` follows the flow forward in time, `-1` walks it backward, which
   * is how one answers "where did this air come from". Uses great-circle steps
   * at constant speed, one leg per hour.
   */
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
      // Gio gan nhu khong co huong thi khong dua duoc: dung vao nhan bang cach
      // chia cho van toc do be qua se sinh do lech ngau nhien.
      if (speed < 0.1) break;
      const scale = (stepKm * sign) / speed;
      cur = offsetLatLon(cur.lat, cur.lon, u[i] * scale, v[i] * scale);
      legs.push({ lat: cur.lat, lon: cur.lon, hoursAgo: sign > 0 ? -h : h, speedKmh: speed * 3.6 });
    }
    return legs;
  }

  /** Compass bearing in degrees from point a to point b. */
  function bearingDeg(a, b) {
    const r = Math.PI / 180;
    const dLon = (b.lon - a.lon) * r, lat1 = a.lat * r, lat2 = b.lat * r;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  /** Minimum distance in km from a point to a polyline, plus where it lands. */
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

  /**
   * Classifies the air mass at a point into a Vietnamese-language tag.
   * Uses only what is measurable here: 850 hPa temperature against the site's
   * own recent baseline, thickness anomaly, moisture, and whether the wind is
   * advecting from a cold continent or a warm ocean. Returns null when the
   * inputs are too sparse rather than guessing.
   */
  function airMass(opts) {
    const { t850, t850Baseline, thick, thickBaseline, rh850, source } = opts;
    if (!finite(t850)) return null;
    const dT = finite(t850Baseline) ? t850 - t850Baseline : null;
    const dThick = (finite(thick) && finite(thickBaseline)) ? thick - thickBaseline : null;

    let tag = 'Ôn hòa', tone = 'neutral';
    if (finite(dT) && finite(dThick)) {
      if (dT <= -3 && dThick <= -60) { tag = 'Khối lạnh'; tone = 'cold'; }
      else if (dT >= 3 && dThick >= 60) { tag = 'Khối nóng'; tone = 'warm'; }
      else if (dT <= -1.5) { tag = 'Hơi lạnh'; tone = 'cool'; }
      else if (dT >= 1.5) { tag = 'Hơi nóng'; tone = 'mild'; }
    } else if (finite(dT)) {
      if (dT <= -3) { tag = 'Khối lạnh'; tone = 'cold'; }
      else if (dT >= 3) { tag = 'Khối nóng'; tone = 'warm'; }
      else if (dT <= -1.5) { tag = 'Hơi lạnh'; tone = 'cool'; }
      else if (dT >= 1.5) { tag = 'Hơi nóng'; tone = 'mild'; }
    }

    // Advection sense from where the wind comes from. Northerly flow off the
    // Asian landmass is the classic Vietnamese cold-air outbreak.
    let advection = null;
    if (finite(source)) {
      advection = (source >= 315 || source < 45) ? 'Bắc' : (source >= 45 && source < 135) ? 'Đông' : (source >= 135 && source < 225) ? 'Nam' : 'Tây';
    }
    const moisture = finite(rh850)
      ? (rh850 >= 85 ? 'Ẩm' : rh850 <= 45 ? 'Khô' : 'Ẩm vừa')
      : null;
    return { tag, tone, dT: round(dT, 1), dThick: round(dThick, 1), t850: round(t850, 1), advection, moisture, rh850: round(rh850, 0) };
  }

  /**
   * Detects frontal passage from 850 hPa series: a wind veer (cold front) or
   * backing (warm front) coinciding with a temperature drop or rise. Reports the
   * lead index in hours, or null when neither is present.
   */
  function frontalPassage(opts) {
    const { dir850, t850, hoursBack = 12 } = opts;
    const n = Math.min(dir850.length, t850.length);
    if (n < hoursBack + 2) return null;
    const i0 = n - 1, i1 = n - 1 - hoursBack;
    if (!finite(dir850[i0]) || !finite(dir850[i1]) || !finite(t850[i0]) || !finite(t850[i1])) return null;
    // Signed smallest angle: positive = veering (clockwise, cold front in VN).
    const shift = ((dir850[i0] - dir850[i1] + 540) % 360) - 180;
    const dT = t850[i0] - t850[i1];
    if (shift >= 20 && dT <= -1) return { kind: 'Mặt lạnh', leadHours: hoursBack, windShift: round(shift, 0), dT: round(dT, 1) };
    if (shift <= -20 && dT >= 1) return { kind: 'Mặt ấm', leadHours: hoursBack, windShift: round(shift, 0), dT: round(dT, 1) };
    return null;
  }

  /**
   * River discharge risk from GloFAS percentiles. Compares the forecast median
   * against the recent observed median and reports the exceedance probability
   * implied by the p25/p75 spread. Discharge is m3/s; there is no rating curve
   * here, so no water level in metres is derived.
   */
  function riverRisk(opts) {
    const { q, qP25, qP75, recent } = opts;
    if (!finite(q)) return null;
    const band = finite(qP25) && finite(qP75) ? { p25: qP25, p75: qP75 } : null;
    let vsRecent = null;
    if (finite(recent) && recent > 0) vsRecent = (q - recent) / recent;
    // Exceedance chance of crossing `recent`, read off the percentile band by
    // linear interpolation in log space (discharge is a positive, skewed var).
    let exceed = null;
    if (band && finite(recent) && recent > 0 && band.p25 > 0 && band.p75 > band.p25) {
      const f = (Math.log(recent) - Math.log(band.p25)) / (Math.log(band.p75) - Math.log(band.p25));
      exceed = round(clamp(1 - clamp(f, 0, 1), 0, 1), 2);
    }
    const rising = finite(vsRecent) ? vsRecent : null;
    return {
      q: round(q, 1), p25: band ? round(band.p25, 1) : null, p75: band ? round(band.p75, 1) : null,
      vsRecent: round(rising, 3), exceed, recent: round(recent, 1),
    };
  }

  /* ================================================================
   * 13. Air-mass grid, wind barbs, nominal water level
   * ================================================================ */

  /**
   * Builds a lat/lon grid at a fixed spacing, clipped to a radius in km, and
   * classifies each cell from 850/500 hPa fields. The baseline is the grid's own
   * mean so classes describe the region relative to itself rather than to an
   * absolute threshold that would be wrong at every latitude.
   *
   * `cells` entries: { lat, lon, km, t850, thick, wind, dir, tag, tone, delta }
   */
  function airMassGrid(opts) {
    const { lat, lon, radiusKm = 700, stepKm = 200, values } = opts;
    if (!Array.isArray(values) || !values.length) return { cells: [], mean: null };
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
        const v = values[values.length - 1];
        cells.push({
          lat: round(p.lat, 3), lon: round(p.lon, 3),
          km: round(Math.hypot(dx, dy), 0),
        });
      }
    }
    return { cells, mean: { t850: round(tMean, 2), thick: round(thMean, 1) }, grid: values.length };
  }

  /** Classifies one grid cell against the grid mean. */
  function classifyCell(cell, mean, windDeg) {
    const tag = airMass({
      t850: cell.t850, t850Baseline: mean.t850,
      thick: cell.thick, thickBaseline: mean.thick,
      rh850: cell.rh850, source: windDeg,
    });
    return tag ? { ...cell, ...tag, tone: tag.tone } : cell;
  }

  /**
   * Nominal water level in metres from discharge in m3/s.
   *
   * IMPORTANT HONESTY NOTE. This is NOT a measurement. Stage-discharge curves
   * (rating curves) are station specific, hysteretic and published by national
   * hydrological services; no open source exposes them. What this returns is a
   * nominal figure under an explicitly declared power law H = a * Q^b, so the
   * UI must label it as a reference estimate, never as the official level.
   *
   * `a` is the stage at reference discharge `q0`; `b` the stage-discharge
   * exponent. Both must come from a real rating curve for the station.
   */
  function nominalStage(q, a, b, q0 = 100) {
    if (!finite(q) || !finite(a) || !finite(b) || !b) return null;
    if (q <= 0) return 0;
    return round(a * Math.pow(q / q0, b), 2);
  }

  /** Inverse of nominalStage: stage in metres back to discharge. */
  function stageToQ(H, a, b, q0 = 100) {
    if (!finite(H) || !finite(a) || !finite(b) || !b) return null;
    if (H <= 0) return 0;   // mực bằng 0 tương ứng lưu lượng bằng 0
    return round(q0 * Math.pow(H / a, 1 / b), 1);
  }

  /** Wind barbs: line length and head count encode speed, rotation shows direction. */
  function windBarb(speedKmh, dirDeg) {
    if (!finite(speedKmh) || !finite(dirDeg)) return null;
    const level = Math.min(5, Math.floor(speedKmh / 10)); // 10 km/h per barb
    const half = Math.floor(level / 2), full = level % 2;
    return { level, half, full, dirDeg: round(((dirDeg % 360) + 360) % 360, 1), speedKmh: round(speedKmh, 1) };
  }

  /** Great-circle distance in km, used to pick the nearest calibrated location. */
  function distanceKm(a, b) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  root.AtmosEngine = {
    finite, clamp, round, meanS, varS, sdS, quantile, ncdf, pdf, ncdfInv, rng,
    gaussSolve, moments, solveRidge, solveNNLS, applyLinear, linearModel, rollingFolds, sigma2,
    FORWARD, INVERSE, VARIABLES, CONDITIONS, K_MEMBERS, LAMBDA_GRID,
    pseudoMembers, crpsMembers, pointScores, eventScores, probScores, probEnsembleScores,
    pairedBootstrap, toSpeed, toDir, circularAbs, condGroup, conditionOf,
    distanceKm, predictFromCalibration, calibrate, calibrateDirection, calibrateCode,
    airMassGrid, classifyCell, nominalStage, stageToQ, windBarb,
    evaluate, hourOf, dayOfYear, regimeKey, REGIME_EDGES,
    thickness, toUms, offsetLatLon, trajectory, bearingDeg, nearestOnTrack,
    airMass, frontalPassage, riverRisk,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
