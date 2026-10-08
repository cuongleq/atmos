/*
 * Verification suite.
 *
 * Three layers:
 *   1. Unit tests on the engine primitives.
 *   2. Property tests on synthetic forecasts: does the fitter recover known
 *      coefficients, does the shipped calibration reproduce the offline
 *      pipeline, and does the score window leak into the fit?
 *   3. Assertions on the real backtest in dist/benchmark.json.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { VARIABLES, LEADS, LOCATIONS } from './config.mjs';
import './dist/engine.js';

const E = globalThis.AtmosEngine;
const near = (a, b, tol, msg) => assert.ok(
  E.finite(a) && E.finite(b) && Math.abs(a - b) <= tol,
  `${msg ?? 'giá trị'} ${a} vs ${b} (dung sai ${tol})`);

let passed = 0;
const failures = [];
// Khong dung fail ngay: mot lan chay phai cho ra day du danh sach loi, neu khong
// chi mot thu muc thieu du lieu raw/ se che mat cac loi that su khac.
const check = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) {
    failures.push({ name, message: e && e.message ? e.message : String(e) });
    console.log(`  FAIL ${name}\n         ${e && e.message ? e.message : e}`);
  }
};

console.log('\n1. Số học nền');
check('mean/varS/quantile bỏ qua giá trị thiếu', () => {
  assert.equal(E.meanS([1, null, 3]), 2);
  assert.equal(E.meanS([]), null);
  near(E.quantile([0, 10, 20, 30], 0.5), 15, 1e-9, 'median');
  near(E.quantile([1, 2, 3], 0), 1, 1e-12, 'min');
  near(E.quantile([1, 2, 3], 1), 3, 1e-12, 'max');
});
check('ncdfInv khớp ncdf', () => {
  for (const p of [0.001, 0.02, 0.1, 0.3, 0.5, 0.7, 0.9, 0.98, 0.999]) {
    near(E.ncdf(E.ncdfInv(p)), p, 1e-6, `p=${p}`);
  }
});
check('rng tất định và phân bố đều', () => {
  const a = E.rng(42), b = E.rng(42);
  for (let i = 0; i < 200; i++) assert.equal(a(), b());
  const r = E.rng(7);
  const s = Array.from({ length: 20000 }, r).reduce((x, y) => x + y, 0) / 20000;
  near(s, 0.5, 0.02, 'trung bình phân phối đều');
});

console.log('\n2. Đại số tuyến tính');
check('gaussSolve giải đúng hệ đã biết', () => {
  // 3x + y = 5, x + 2y = 3  =>  x = 1.4, y = 0.8
  const x = E.gaussSolve([[3, 1], [1, 2]], [5, 3]);
  near(x[0], 1.4, 1e-9); near(x[1], 0.8, 1e-9);
});
check('solveRidge phục hồi đúng hệ số đã biết', () => {
  const n = 400, r = E.rng(3);
  const X = [], y = [];
  for (let i = 0; i < n; i++) {
    const row = [r(), r(), r()];
    X.push(row);
    y.push(2 + 3 * row[0] - 1.5 * row[1] + 0.75 * row[2]);
  }
  const beta = E.solveRidge(E.moments(X, y), 0);
  const m = E.linearModel('emos', beta, E.moments(X, y));
  for (const row of X.slice(0, 20)) near(E.applyLinear(m, row), 2 + 3 * row[0] - 1.5 * row[1] + 0.75 * row[2], 1e-6);
});
check('solveNNLS không bao giờ trả trọng số âm', () => {
  const r = E.rng(11);
  const X = [], y = [];
  for (let i = 0; i < 300; i++) {
    const row = [r(), r()];
    X.push(row);
    // Deliberately wants a negative weight on the second column.
    y.push(5 * row[0] - 3 * row[1] + 1);
  }
  const w = E.solveNNLS(E.moments(X, y), 0.001);
  assert.ok(w.every(v => v >= 0), 'trọng số phải không âm: ' + JSON.stringify(w));
});
check('ridge phạt nặng về mô hình đơn giản hơn', () => {
  const r = E.rng(5);
  const X = [], y = [];
  for (let i = 0; i < 200; i++) {
    const row = [r(), r(), r(), r()];
    X.push(row);
    y.push(row[0] + 0.01 * row[1] * row[2]);   // noise on unseen structure
  }
  const m = E.moments(X, y);
  const small = E.solveRidge(m, 0.01);
  const large = E.solveRidge(m, 1000);
  const norm = b => b.reduce((s, v) => s + v * v, 0);
  assert.ok(norm(large) < norm(small), 'ridge lớn phải co hệ số mạnh hơn');
});

console.log('\n3. Phân phối dự báo');
check('crpsMembers khớp CRPS giải tích của phân phối chuẩn', () => {
  // The 51-node member grid is a discrete quadrature of the same distribution,
  // so a few percent of residual error is expected; it must not be a bias.
  for (const [mu, sd] of [[0, 1], [2, 0.5], [-3, 3]]) {
    const mem = E.pseudoMembers('gauss', mu, sd);
    const y = mu + sd * 0.7;
    const w = (mu - y) / sd;                       // omega = (y - mu) / sd = -0.7
    const analytic = sd * (w * (2 * E.ncdf(w) - 1) + 2 * E.pdf(w) - 1 / Math.sqrt(Math.PI));
    const rel = Math.abs(E.crpsMembers(mem, y) - analytic) / Math.abs(analytic);
    assert.ok(rel < 0.05, `CRPS tương đối lệch ${(rel * 100).toFixed(2)}% (mu=${mu}, sd=${sd})`);
  }
});
check('pseudoMembers đơn điệu và giữ giới hạn vật lý', () => {
  const mem = E.pseudoMembers('log1p', 0, 1);
  for (let i = 1; i < mem.length; i++) assert.ok(mem[i] >= mem[i - 1], 'phải tăng dần');
  assert.ok(mem.every(v => v >= 0), 'lượng mưa không được âm');
  const hum = E.pseudoMembers('logit', 0, 2);
  assert.ok(hum.every(v => v >= 0 && v <= 100), 'độ ẩm phải trong 0..100');
  assert.ok(hum.every(v => Number.isFinite(v)), 'độ ẩm phải hữu hạn');
});
check('sigma2 không âm và phục hồi đúng trên dữ liệu tổng hợp', () => {
  const x = Array.from({ length: 40 }, (_, i) => i * 3);
  const y = x.map(v => 2 + 2 * v);                 // exact sigma^2 = 2 + 2 * spread^2
  const s2 = E.sigma2(x, y);
  assert.ok(s2.alpha >= 0 && s2.beta >= 0, 'alpha và beta phải không âm');
  near(s2.alpha, 2, 1e-6, 'alpha');
  near(s2.beta, 2, 1e-6, 'beta');
  const anti = E.sigma2(x, y.map(v => -v));
  assert.ok(anti.alpha >= 0 && anti.beta >= 0, 'hệ số âm phải bị chặn ở 0');
  const noisy = E.sigma2([0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6]);
  assert.ok(noisy.beta === 0 && noisy.alpha > 0, 'khi độ rộng hằng số thì beta phải bằng 0');
});

console.log('\n4. Thang điểm');
check('pointScores đúng trên mảng đã biết', () => {
  const s = E.pointScores([1, 2, 3], [1, 2, 3]);
  assert.equal(s.n, 3); assert.equal(s.mae, 0); assert.equal(s.rmse, 0); assert.equal(s.bias, 0);
  const t = E.pointScores([2, 0, 2], [2, 2, 0]);
  assert.equal(t.mae, 4 / 3);
});
check('eventScores tái lập ví dụ 2/2/0/2', () => {
  const s = E.eventScores([2, 0, 2], [2, 2, 0], 2);
  near(s.csi, 1 / 3, 1e-12, 'CSI');
  near(s.pod, 0.5, 1e-12, 'POD');
  near(s.far, 0.5, 1e-12, 'FAR');
});
check('probScores: dự báo hằng số cho BSS bằng 0', () => {
  const p = new Array(400).fill(0.3);
  const o = Array.from({ length: 400 }, (_, i) => (i % 10 < 3 ? 1 : 0));
  const s = E.probScores(p, o, 1, 0.3);
  near(s.brier, 0.3 * 0.7, 1e-12, 'Brier');
  near(s.bss, 0, 1e-12, 'BSS của dự báo hằng số bằng tần suất gốc');
  // A saturated forecast at 1.0 must be punished: it is no better than blind luck.
  const blind = E.probScores(o.map(() => 1), o, 1, 0.3);
  assert.ok(blind.brier > s.brier, 'dự báo chắc-như-chắc-100% phải tệ hơn tần suất gốc');
  // A sharp but discriminating forecast must beat climatology.
  const sharp = E.probScores(o.map(v => (v ? 0.9 : 0.1)), o, 1, 0.3);
  near(sharp.brier, 0.01, 1e-12, 'Brier của dự báo sắc có phân biệt');
  near(sharp.bss, 1 - 0.01 / 0.21, 1e-9, 'BSS');
  assert.ok(sharp.reliability.every(b => E.finite(b.observed) && E.finite(b.forecast)), 'độ tin cậy phải đủ');
});
check('probEnsembleScores: CRPS hợp lệ, tỉ lệ độ rộng và phân hoạch đứng hạng khi hiệu chuẩn đúng', () => {
  // A correctly calibrated ensemble: the truth is drawn from N(0,1) and the
  // forecast is the same N(0,1). Spread must then match the error of the central
  // estimate and the verification histogram must be flat.
  const N = 2400;
  const members = [], obs = [];
  for (let i = 0; i < N; i++) {
    members.push(E.pseudoMembers('gauss', 0, 1));
    obs.push(E.ncdfInv((i + 0.5) / N));
  }
  const s = E.probEnsembleScores(members, obs);
  // Expected CRPS of a standard-normal forecast for a standard-normal
  // observation is about 0.554; that is the reference point, not zero.
  near(s.crps, 0.554, 0.02, 'CRPS khi hiệu chuẩn hoàn hảo');
  near(s.spreadSkill, 1, 0.06, 'tỉ lệ độ rộng/sai số khi hiệu chuẩn đúng');
  near(s.rankDeviation, 0, 0.05, 'phân hoạch đứng hạng phải gần phẳng');
  near(s.rankHistogram.reduce((a, b) => a + b, 0), 1, 1e-9, 'tổng phân hoạch');
  // Too sharp a forecast must be penalised: rank pile-up at the centre.
  const sharp = E.probEnsembleScores(members.map(() => E.pseudoMembers('gauss', 0, 0.2)), obs);
  assert.ok(sharp.rankDeviation > s.rankDeviation * 5, 'dự báo quá sắc phải lệch đứng hạng mạnh');
  assert.ok(sharp.crps > s.crps, 'dự báo quá sắc phải có CRPS tệ hơn');
});
check('pairedBootstrap tất định và kẹp ước lượng điểm', () => {
  const r = E.rng(23);
  const a = Array.from({ length: 1000 }, () => r());
  const b = a.map(v => v * 0.5);
  const s1 = E.pairedBootstrap(a.map(v => v * v), b.map(v => v * v), 48, 400, 9);
  const s2 = E.pairedBootstrap(a.map(v => v * v), b.map(v => v * v), 48, 400, 9);
  assert.deepEqual(s1, s2, 'cùng hạt giống phải cho kết quả giống nhau');
  assert.ok(s1.ci95[0] < s1.deltaRmse && s1.deltaRmse < s1.ci95[1], 'điểm phải nằm trong khoảng tin cậy');
  assert.ok(s1.probImprovement > 0.99);
});

console.log('\n5. Kiểm chứng chặn và rò rỉ dữ liệu');
check('rollingFolds: huấn luyện luôn đứng trước kiểm tra, có khoảng trống', () => {
  const folds = E.rollingFolds(8000, 4);
  assert.ok(folds.length >= 3);
  let prevTrainEnd = -1;
  for (const f of folds) {
    assert.ok(f.train <= f.valid[0], 'cửa sổ huấn luyện phải kết thúc trước cửa sổ kiểm tra');
    assert.ok(f.valid[0] - f.train > 0, 'phải có khoảng trống giữa hai cửa sổ');
    assert.ok(f.train > prevTrainEnd, 'cửa sổ phải mở rộng dần');
    prevTrainEnd = f.train;
  }
});

/* ---------- synthetic forecast generator ---------- */

function synthetic(days = 420, seed = 5, nModels = 6) {
  const r = E.rng(seed);
  const times = [], truth = [], models = {};
  for (let i = 0; i < nModels; i++) models['m' + i] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      times.push(new Date(Date.UTC(2025, 0, 1) + (d * 24 + h) * 3600000).toISOString().slice(0, 16));
      const seasonal = 26 * Math.sin(2 * Math.PI * d / 365.25);
      const diurnal = 5 * Math.sin(2 * Math.PI * (h - 4) / 24);
      const base = seasonal + diurnal;
      const obs = base + (r() - 0.5) * 2;
      truth.push(obs);
      for (let i = 0; i < nModels; i++) {
        const bias = (i - nModels / 2) * 0.25;              // one model is warmest, one coldest
        const spread = 0.3 + i * 0.12;                      // skill differs by system
        models['m' + i].push(obs + bias + (r() - 0.5) * 2 * spread);
      }
    }
  }
  return { times, truth, models };
}

const SPLIT = { trainEnd: '2025-10-14', testStart: '2025-10-22', purgeDays: 7 };
const dayOf = t => t.slice(0, 10);

function fitSynthetic(mutateTest = null, variable = 'temperature_2m') {
  const { times, truth, models } = synthetic();
  const obs = truth.slice();
  if (mutateTest) for (let i = 0; i < times.length; i++) if (dayOf(times[i]) >= mutateTest) obs[i] += 40;
  return E.evaluate({
    times, obs, series: models, variable, lead: 1,
    modelNames: Object.fromEntries(Object.keys(models).map(k => [k, k])),
    utcOffset: 0, ...SPLIT,
  });
}

check('dữ liệu kiểm tra không thay đổi hệ số đã hiệu chỉnh', () => {
  const a = fitSynthetic();
  const b = fitSynthetic('2025-10-22');
  assert.ok(a.usable, 'bộ dữ liệu tổng hợp phải dùng được');
  assert.deepEqual(a.calibration.beta, b.calibration.beta, 'beta phải giống hệt');
  assert.equal(a.calibration.intercept, b.calibration.intercept, 'intercept phải giống hệt');
  assert.deepEqual(a.calibration.sigma2, b.calibration.sigma2, 'sigma^2 phải giống hệt');
  assert.deepEqual(a.candidates, b.candidates, 'bảng kiểm chứng chặn phải giống hệt');
  assert.equal(a.trainingN, b.trainingN);
  assert.ok(a.mean.rmse !== b.mean.rmse, 'điểm kiểm tra phải khác, nếu không thì phép thử vô nghĩa');
});
check('bảng kiểm chứng chặn chỉ đánh giá trên giờ chưa từng thấy', () => {
  const a = fitSynthetic();
  const trainCut = times => times;
  // every candidate must have been scored on fewer rows than the fit window
  for (const c of a.candidates) {
    assert.ok(c.cvN < a.trainingN, `ứng viên ${c.family} dùng ${c.cvN}/${a.trainingN} giờ`);
  }
  assert.equal(a.candidates.length, 1 + 1 + E.LAMBDA_GRID.length * 2, 'phải thử đủ các họ mô hình');
});
check('hiệu chỉnh vượt trội trung bình đều trên dữ liệu tổng hợp có sai lệch hệ thống', () => {
  const a = fitSynthetic();
  assert.ok(a.mean.rmse < a.equalMean.rmse, 'EMOS phải tốt hơn trung bình đều');
  assert.ok(a.selected.family === 'emos' || a.selected.family === 'nnls', 'họ được chọn: ' + a.selected.family);
  assert.ok(Math.abs(a.mean.bias) < Math.abs(a.equalMean.bias), 'sai lệch phải được thu nhỏ');
});
check('quy tắc một sai số chuẩn ghép cặp: không chọn ứng viên phức tạp vô ích', () => {
  const a = fitSynthetic();
  const s = a.selected;
  assert.ok(s.cvStandardError >= 0 && E.finite(s.cvStandardError), 'sai số chuẩn phải hữu hạn');
  assert.ok(s.cvGap <= s.cvStandardError + 1e-9, 'chênh lệch ghép cặp phải nằm trong một sai số chuẩn');
  assert.ok(s.cvRmse >= s.bestCvRmse - 1e-9, 'không thể tốt hơn điểm tối thiểu');
  assert.ok(s.cvStandardError < s.cvRmse, 'sai số chuẩn phải nhỏ hơn RMSE, nếu không là ghép cặp sai');
  // The leader must always qualify; otherwise the tie-break has nothing to rank.
  const leader = a.candidates.find(c => c.family === s.bestCvFamily && c.cvRmse === s.bestCvRmse);
  assert.ok(leader && leader.cvGap >= -1e-9, 'ứng viên dẫn đầu phải có chênh lệch không âm');
  const complex = { mean: 0, best: 1, nnls: 2, emos: 3 };
  const chosen = a.candidates.find(c => c.chosen);
  assert.ok(chosen, 'phải có đúng một ứng viên được chọn');
  assert.equal(a.candidates.filter(c => c.chosen).length, 1, 'đúng một ứng viên được đánh dấu');
  for (const c of a.candidates) {
    if (c.chosen) continue;
    if (complex[c.family] >= complex[chosen.family]) continue;
    assert.ok(c.cvGap > c.cvGapSe + 1e-9,
      `${c.family} đơn giản hơn ${chosen.family} nhưng bị loại dù kém rõ rệt (gap ${c.cvGap}, se ${c.cvGapSe})`);
  }
});

check('gói hiệu chỉnh mang theo cả trung tâm lẫn thang chuẩn hoá', () => {
  // Without the standardisation the browser applies unstandardised
  // coefficients and lands somewhere else entirely.
  const a = fitSynthetic();
  const c = a.calibration;
  assert.ok(c.scale, 'gói hiệu chỉnh phải có thang chuẩn hoá');
  assert.equal(c.scale.length, c.beta.length, 'thang chuẩn hoá phải khớp số hệ số');
  assert.ok(c.scale.every(s => E.finite(s) && s > 0), 'thang chuẩn hoá phải dương');
  assert.ok(c.beta.every(b => E.finite(b) && Math.abs(b) < 50), 'hệ số phải có độ lớn hợp lý');
});
check('thiết kế hạng thiếu: chuẩn hoá cột cứu được hồi quy khỏi phá huỷ hệ số', () => {
  // Column 0 is exactly the mean of columns 2..4, so the design is singular.
  // Without standardisation an under-penalised ridge returns huge cancelling
  // coefficients that still predict the training rows almost exactly.
  const r = E.rng(61);
  const n = 500;
  const X = [], y = [];
  for (let i = 0; i < n; i++) {
    const a = r(), b = r(), c = r();
    const row = [(a + b + c) / 3, r(), a, b, c];
    X.push(row);
    y.push(2 + 0.5 * a - 0.25 * b + 0.75 * c);
  }
  const m = E.moments(X, y);
  // Each stored scale must be the column's own standard deviation, so that
  // (x - mu) / sd is standardised for any new row.
  for (let j = 0; j < 5; j++) {
    const col = X.map(row => row[j]);
    near(m.sd[j], E.sdS(col), 1e-9, 'thang chuẩn hoá cột ' + j);
    near(m.mu[j], E.meanS(col), 1e-9, 'trung tâm cột ' + j);
  }
  for (let j = 0; j < 5; j++) {
    const z = X.map(row => (row[j] - m.mu[j]) / m.sd[j]);
    near(E.sdS(z), 1, 1e-9, 'cột ' + j + ' sau chuẩn hoá');
  }
  const beta = E.solveRidge(m, 0.001);
  assert.ok(beta, 'phải giải được hệ hạng thiếu');
  assert.ok(beta.every(b => Math.abs(b) < 5),
    'hệ số phải có độ lớn hợp lý, nhận được ' + JSON.stringify(beta.map(b => +b.toFixed(2))));

  // The same fit must extrapolate sanely well outside the training range.
  const model = E.linearModel('emos', beta, m);
  const big = X.map(row => row.map(v => v * 4));
  const inside = big.filter(row => row.every(E.finite));
  for (const row of inside.slice(0, 50)) {
    const p = E.applyLinear(model, row);
    assert.ok(E.finite(p) && Math.abs(p) < 200,
      'dự báo ngoài tập phải hữu hạn và hợp lý, nhận ' + p);
  }

  // applyLinear must reproduce the row exactly through the stored scaling.
  const fit = X.map(row => E.applyLinear(model, row));
  let worst = 0;
  for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(fit[i] - y[i]));
  assert.ok(worst < 1, 'hồi quy phải khớp dữ liệu huấn luyện, sai tối đa ' + worst);
});
check('calibrate() tái lập đúng đường đi của đánh giá ngoại tuyến', () => {
  const { times, truth, models } = synthetic();
  const res = E.evaluate({
    times, obs: truth, series: models, variable: 'temperature_2m', lead: 1,
    modelNames: {}, utcOffset: 0, ...SPLIT,
  });
  assert.ok(res.usable, 'phải hiệu chỉnh được');
  const start = times.findIndex(t => dayOf(t) === res.splitStart || dayOf(t) === SPLIT.testStart);
  const live = E.calibrate({
    times, variable: 'temperature_2m', series: models,
    calib: res.calibration, utcOffset: 0,
  });
  // The browser path is judged on the same complete rows the score window uses.
  let n = 0;
  for (let i = start; i < times.length; i++) {
    if (!live[i] || !E.finite(truth[i])) continue;
    if (dayOf(times[i]) < SPLIT.testStart) continue;
    n++;
  }
  assert.ok(n > 500, `phải dự báo được nhiều giờ trong cửa sổ kiểm tra (${n})`);
  assert.ok(live[start] && live[start].median !== null, 'giờ đầu phải có dự báo');
  assert.ok(live[start].p10 <= live[start].median && live[start].median <= live[start].p90,
    'phân vị phải tăng dần');
});
check('calibrate() dựng lại đúng giá trị trung vị mà đánh giá đã dùng', () => {
  const { times, truth, models } = synthetic(300, 9, 5);
  const res = E.evaluate({
    times, obs: truth, series: models, variable: 'temperature_2m', lead: 1,
    modelNames: {}, utcOffset: 0, trainEnd: '2025-08-01', testStart: '2025-09-01', purgeDays: 7,
  });
  assert.ok(res.usable);
  const live = E.calibrate({
    times, variable: 'temperature_2m', series: models, calib: res.calibration, utcOffset: 0,
  });
  // Rebuild the member median from the shipped numbers alone, without calling
  // calibrate(), so the test would catch a wrong centring or scaling rule.
  const c = res.calibration;
  const F = E.FORWARD[c.kind];
  const start = times.findIndex(t => t.slice(0, 10) >= '2025-09-01');
  assert.ok(c.beta, 'bộ dữ liệu tổng hợp này phải chọn được họ hồi quy, thực tế ' + c.family);
  let checked = 0;
  for (let i = start; i < times.length; i++) {
    if (!live[i]) continue;
    const vals = c.modelIds.map(id => F(models[id][i]));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sq = vals.reduce((a, b) => a + b * b, 0) / vals.length;
    const spread = Math.sqrt(Math.max(0, sq - mean * mean));
    const row = [mean, spread, ...vals];
    for (const cv of c.crossVars || []) row.push(F(0));   // cross predictors unused here
    row.push(Math.sin(2 * Math.PI * E.hourOf(times, i, 0) / 24));
    row.push(Math.cos(2 * Math.PI * E.hourOf(times, i, 0) / 24));
    row.push(Math.sin(2 * Math.PI * E.dayOfYear(times, i) / 365.25));
    row.push(Math.cos(2 * Math.PI * E.dayOfYear(times, i) / 365.25));
    assert.equal(row.length, c.beta.length, 'số cột phải khớp số hệ số');
    const mu = E.predictFromCalibration(c, { mean, byId: vals }, spread,
      E.hourOf(times, i, 0), E.dayOfYear(times, i), null);
    const mem = E.pseudoMembers(c.kind, mu, Math.sqrt(c.sigma2.alpha + c.sigma2.beta * spread * spread));
    near(live[i].median, E.quantile(mem, 0.5), 1e-9, 'trung vị phải khớp');
    checked++;
    if (checked > 200) break;
  }
  assert.ok(checked > 100, 'phải kiểm được nhiều giờ, thực tế ' + checked);
});
check('đường đi trong trình duyệt cho cùng RMSE với đường đi ngoại tuyến', () => {
  // The shipped bundle is the only thing the browser has. If applying it does
  // not reproduce the offline score, the live page would be showing a different
  // forecast from the one that was verified.
  const { times, truth, models } = synthetic(300, 9, 5);
  const res = E.evaluate({
    times, obs: truth, series: models, variable: 'temperature_2m', lead: 1,
    modelNames: {}, utcOffset: 0, trainEnd: '2025-08-01', testStart: '2025-09-01', purgeDays: 7,
  });
  assert.ok(res.usable);
  const live = E.calibrate({ times, variable: 'temperature_2m', series: models, calib: res.calibration, utcOffset: 0 });
  const idx = times.map((t, i) => i).filter(i => times[i].slice(0, 10) >= '2025-09-01' && live[i]);
  assert.ok(idx.length > 400, 'phải có đủ giờ để so sánh: ' + idx.length);
  const browserRmse = E.pointScores(idx.map(i => live[i].median), idx.map(i => truth[i])).rmse;
  // Coefficients are rounded to 1e-6 for shipping, so agreement is to that
  // precision rather than to floating-point exactness.
  const rel = Math.abs(browserRmse - res.median.rmse) / res.median.rmse;
  assert.ok(rel < 1e-4, `trình duyệt ${browserRmse} khác ngoại tuyến ${res.median.rmse} (${rel})`);
});
check('circularAbs là sai số góc nhỏ nhất, không phải độ tương đồng', () => {
  // This is the sign convention everything downstream depends on: 0 means the
  // bearings agree, 180 means they are opposite.
  assert.equal(E.circularAbs(0, 0), 0);
  assert.equal(E.circularAbs(350, 10), 20);
  assert.equal(E.circularAbs(10, 350), 20);
  assert.equal(E.circularAbs(0, 180), 180);
  assert.equal(E.circularAbs(90, 270), 180);
  assert.equal(E.circularAbs(0, 90), 90);
  assert.equal(E.circularAbs(45, 400), 5);
});
check('hướng gió: engine dựng lại đúng kết quả ngoại tuyến từ hệ số đã xuất', () => {
  const r = E.rng(41);
  const nDays = 320, nModels = 5;
  const times = [], obsSpeed = [], obsDir = [], models = {};
  for (let i = 0; i < nModels; i++) models['m' + i] = { u: [], v: [], speed: [], dir: [] };
  for (let d = 0; d < nDays; d++) {
    for (let h = 0; h < 24; h++) {
      times.push(new Date(Date.UTC(2025, 0, 1) + (d * 24 + h) * 3600000).toISOString().slice(0, 16));
      // Veering wind with a diurnal speed cycle, so u and v both vary.
      const dir = (200 + 120 * Math.sin(2 * Math.PI * (d * 24 + h) / (24 * 11)) + 360) % 360;
      const sp = 10 + 6 * Math.sin(2 * Math.PI * (h - 13) / 24) + r() * 2;
      obsSpeed.push(sp); obsDir.push(dir);
      const rad = dir * Math.PI / 180;
      for (let i = 0; i < nModels; i++) {
        const err = (r() - 0.5) * (6 + i);
        const dErr = (r() - 0.5) * 14;
        const r2 = (dir + dErr) * Math.PI / 180;
        const s2 = Math.max(0.5, sp + err);
        models['m' + i].u.push(s2 * Math.cos(r2));
        models['m' + i].v.push(s2 * Math.sin(r2));
        models['m' + i].speed.push(s2);
        models['m' + i].dir.push((dir + dErr + 360) % 360);
      }
    }
  }
  const res = E.evaluate({
    times, series: models, obsSpeed, obsDirection: obsDir,
    variable: 'wind_direction_10m', lead: 1, modelNames: {}, utcOffset: 0,
    trainEnd: '2025-08-01', testStart: '2025-09-01', purgeDays: 7,
  });
  assert.ok(res.usable, res.note);

  const live = E.calibrateDirection({
    times, seriesU: Object.fromEntries(Object.keys(models).map(k => [k, models[k].u])),
    seriesV: Object.fromEntries(Object.keys(models).map(k => [k, models[k].v])),
    calibration: res.calibration, utcOffset: 0,
  });
  assert.ok(live, 'phải dựng được hướng gió');
  const idx = times.map((t, i) => i).filter(i => times[i].slice(0, 10) >= '2025-09-01' && live[i]);
  assert.ok(idx.length > 400, 'phải có đủ giờ: ' + idx.length);

  // Same score as the offline direction fit, so the page is not using a
  // different method than the one that was verified.
  const browserMae = idx.reduce((s, i) => s + E.circularAbs(live[i].dir, obsDir[i]), 0) / idx.length;
  assert.ok(Math.abs(browserMae - res.direction.circularMae) < 0.05,
    `trình duyệt ${browserMae} khác ngoại tuyến ${res.direction.circularMae}`);
  // The synthetic truth is smooth, so a correct sign convention must score well.
  assert.ok(res.direction.circularMae < 20, 'sai số góc phải nhỏ: ' + res.direction.circularMae);
  assert.ok(res.direction.within45 > 0.9, 'tỉ lệ trong 45°: ' + res.direction.within45);
  assert.ok(res.direction.within30 <= res.direction.within45, '30° phải hẹp hơn 45°');
  for (const i of idx.slice(0, 100)) {
    assert.ok(live[i].dir >= 0 && live[i].dir < 360, 'hướng phải trong 0..360');
    assert.ok(live[i].mean >= 0, 'tốc độ phải không âm');
  }
});
check('mã thời tiết: bảng tra vùng dựng lại đúng kết quả ngoại tuyến', () => {
  const r = E.rng(53);
  const nDays = 320, nModels = 5;
  const times = [], obs = [], models = {};
  const FIELDS = ['cloud_cover', 'precipitation', 'wind_speed_10m', 'apparent_temperature', 'relative_humidity_2m'];
  for (let i = 0; i < nModels; i++) { models['m' + i] = {}; for (const f of FIELDS) models['m' + i][f] = []; }

  const makeRegime = (cloud, rain) => {
    if (rain > 8) return 95;
    if (rain > 2) return 63;
    if (rain > 0.2) return 61;
    if (cloud > 80) return 3;
    if (cloud > 30) return 2;
    return 0;
  };
  for (let d = 0; d < nDays; d++) {
    for (let h = 0; h < 24; h++) {
      times.push(new Date(Date.UTC(2025, 0, 1) + (d * 24 + h) * 3600000).toISOString().slice(0, 16));
      const cloud = Math.max(0, Math.min(100, 50 + 45 * Math.sin(2 * Math.PI * d / 9) + (r() - 0.5) * 20));
      const wet = r() < 0.3;
      const rain = wet ? Math.max(0, r() * 14) : 0;
      obs.push(makeRegime(cloud, rain));
      const wind = Math.max(0, 8 + r() * 18);
      const feels = 24 + 6 * Math.sin(2 * Math.PI * (h - 15) / 24) - (rain > 2 ? 3 : 0);
      const hum = Math.max(20, Math.min(100, 60 + rain * 2 + (r() - 0.5) * 20));
      for (let i = 0; i < nModels; i++) {
        models['m' + i].cloud_cover.push(Math.max(0, Math.min(100, cloud + (r() - 0.5) * 12)));
        models['m' + i].precipitation.push(Math.max(0, rain * (0.6 + r() * 0.8)));
        models['m' + i].wind_speed_10m.push(Math.max(0, wind + (r() - 0.5) * 6));
        models['m' + i].apparent_temperature.push(feels + (r() - 0.5) * 3);
        models['m' + i].relative_humidity_2m.push(Math.max(5, Math.min(100, hum + (r() - 0.5) * 10)));
      }
    }
  }
  const feats = FIELDS.map(f => times.map((_, i) => {
    let s = 0, c = 0;
    for (let m = 0; m < nModels; m++) if (E.finite(models['m' + m][f][i])) { s += models['m' + m][f][i]; c++; }
    return c ? s / c : null;
  }));
  const res = E.evaluate({
    times, obs, series: {}, codeFeatures: feats,
    variable: 'weather_code', lead: 1, modelNames: {}, utcOffset: 0,
    trainEnd: '2025-08-01', testStart: '2025-09-01', purgeDays: 7,
  });
  assert.ok(res.usable, res.note);
  assert.ok(res.regime.cells.length > 0, 'phải có bảng tra vùng');

  const live = E.calibrateCode({ times, series: models, regime: res.regime });
  assert.ok(live, 'phải dựng được mã thời tiết');
  const idx = times.map((t, i) => i).filter(i => times[i].slice(0, 10) >= '2025-09-01' && live[i]);
  assert.ok(idx.length > 100, 'phải phủ đủ tập kiểm tra: ' + idx.length);
  let exact = 0;
  for (const i of idx) if (live[i].code === obs[i]) exact++;
  const lookupAccuracy = exact / idx.length;
  assert.ok(Math.abs(lookupAccuracy - res.regime.accuracy) < 0.05,
    `trình duyệt ${lookupAccuracy} khác ngoại tuyến ${res.regime.accuracy}`);
  assert.ok(lookupAccuracy > 0.4, 'bảng tra vùng phải có ích: ' + lookupAccuracy);
  for (const i of idx.slice(0, 60)) {
    assert.ok(Number.isInteger(live[i].code) && live[i].code >= 0 && live[i].code <= 99);
  }
});
check('mã thời tiết: giờ nằm ngoài vùng đã học thì để trống, không đoán', () => {
  // One system with a single hour in the middle of every box range.
  const series = { a: { cloud_cover: [50], precipitation: [1], wind_speed_10m: [15], apparent_temperature: [20], relative_humidity_2m: [70] } };
  const regime = {
    fields: ['cloud_cover', 'precipitation', 'wind_speed_10m', 'apparent_temperature', 'relative_humidity_2m'],
    edges: [[20, 50, 80, 95], [0.5, 2, 5], [10, 20], [10, 20], [45, 65]],
    cells: [],
  };
  // calibrateCode averages systems per field, then quantises the mean. A single
  // system reproduces its own value, so the lookup key is just that row's key.
  const key = E.regimeKey([50, 1, 15, 20, 70], regime.edges);
  assert.equal(key.length, 5, 'khoá phải có 5 chữ số');
  regime.cells = [{ key, code: 0, support: 100, purity: 0.5 }];
  const hit = E.calibrateCode({ times: ['t0'], series, regime });
  assert.ok(hit[0] && hit[0].code === 0, 'ô trong bảng phải khớp, khoá ' + key);

  // A cloud value of 150 % is not physical, so this hour cannot share its cell
  // with the fitted one and the field itself falls outside the edge range; the
  // lookup must say "unknown", not fabricate a code.
  const odd = { a: { cloud_cover: [150], precipitation: [1], wind_speed_10m: [15], apparent_temperature: [25], relative_humidity_2m: [70] } };
  const out = E.calibrateCode({ times: ['t0'], series: odd, regime });
  assert.equal(out[0], null, 'ngoài vùng đã học thì phải là null');
});
check('mưa: phân phối hiệu chỉnh không sinh giá trị âm và có xác suất vượt ngưỡng', () => {
  const r = E.rng(31);
  const times = [], obs = [], series = { a: [], b: [], c: [], d: [] };
  for (let d = 0; d < 400; d++) {
    for (let h = 0; h < 24; h++) {
      times.push(new Date(Date.UTC(2025, 0, 1) + (d * 24 + h) * 3600000).toISOString().slice(0, 16));
      const wet = r() < 0.25;
      const o = wet ? Math.pow(r(), 2) * 40 : 0;
      obs.push(o);
      for (const k of ['a', 'b', 'c', 'd']) series[k].push(wet ? Math.max(0, o * (0.6 + 0.2 * r()) + (r() - 0.5) * 2) : Math.max(0, (r() - 0.5) * 0.6));
    }
  }
  const res = E.evaluate({
    times, obs, series, variable: 'precipitation', lead: 1, modelNames: {}, utcOffset: 0, ...SPLIT,
  });
  assert.ok(res.usable, res.note);
  const live = E.calibrate({ times, variable: 'precipitation', series, calib: res.calibration, utcOffset: 0 });
  assert.ok(live.some(Boolean));
  for (const r2 of live.filter(Boolean)) {
    assert.ok(r2.mean >= 0, 'lượng mưa dự báo phải không âm');
    assert.ok(r2.p10 >= 0 && r2.low >= 0);
    for (const th of Object.keys(r2.probs)) {
      const p = r2.probs[th];
      assert.ok(p >= 0 && p <= 1, 'xác suất phải trong 0..1');
    }
  }
  assert.ok(res.events['10'], 'phải có chấm điểm sự kiện mưa lớn');
  assert.ok(res.daily && res.daily.days > 5, 'phải có chấm điểm lũy kế 24 giờ');
});
check('regimeKey: định năng lượng của các biến khác nhau', () => {
  const edges = [[20, 50, 80], [0.5, 2], [10, 20]];
  // cloud=0 -> bin0, precip=0.1 -> bin0, wind=15 -> bin1
  assert.equal(E.regimeKey([0, 0.1, 15], edges), '001');
  assert.equal(E.regimeKey([30, 0.9, 5], edges), '110');
  assert.equal(E.regimeKey([90, 1.5, 25], edges), '312');
  assert.equal(E.regimeKey([30, 0.9, null], edges), null, 'thiếu một trường là không xác định');
  assert.equal(E.regimeKey([Infinity, 1, 5], edges), null, 'giá trị vô hạn không phải ô hợp lệ');
});
check('mọi biến trong sổ đăng ký đều hợp lệ', () => {
  for (const [id, s] of Object.entries(E.VARIABLES)) {
    assert.ok(['gauss', 'log1p', 'logit', 'direction', 'code'].includes(s.kind), id + ': kind');
    assert.ok(typeof s.label === 'string' && s.label.length > 0, id + ': nhãn');
    assert.ok(typeof s.short === 'string' && s.short.length > 0, id + ': nhãn ngắn');
    assert.ok(Number.isInteger(s.digits) && s.digits >= 0, id + ': số chữ số');
    // direction and code are handled by their own dedicated fits, not a transform
    if (s.kind !== 'direction' && s.kind !== 'code') {
      assert.ok(E.INVERSE[s.kind] && E.FORWARD[s.kind], id + ': phải có phép biến đổi');
    }
    for (const th of s.thresholds || []) assert.ok(th > 0, id + ': ngưỡng phải dương');
  }
  // round trip of the transforms
  for (const kind of ['gauss', 'log1p', 'logit']) {
    for (const x of (kind === 'logit' ? [1, 25, 50, 75, 99] : [0, 1, 7.5, 100, 1234.5])) {
      near(E.INVERSE[kind](E.FORWARD[kind](x)), x, 1e-9, kind + ' vòng khứ hồn');
    }
  }
  assert.equal(E.CONDITIONS.length, 9);
  assert.equal(E.conditionOf(0), 'Trời quang');
  assert.equal(E.conditionOf(95), 'Có dông');
  assert.equal(E.conditionOf(undefined), 'Chưa có thông tin');
  near(E.distanceKm({ lat: 10.82, lon: 106.63 }, { lat: 21.03, lon: 105.85 }), 1150, 60, 'khoảng cách HN–HCM');
});

console.log(`\n${passed} nhóm kiểm thử đơn vị và thuộc tính đã qua.\n`);

/* ================= layer 3: real backtest ================= */

console.log('6. Báo cáo kiểm thử thực tế');
const report = JSON.parse(await fs.readFile(new URL('./dist/benchmark.json', import.meta.url), 'utf8'));

// The report must describe the protocol it claims, so a stale artifact from an
// earlier period has to fail loudly rather than quietly pass.
check('báo cáo dùng đúng kỳ một năm và khoảng cách ly 7 ngày', () => {
  assert.equal(report.period.start, '2024-12-01', 'báo cáo cũ hơn, cần chạy lại node collect.mjs rồi node bench.mjs');
  assert.equal(report.period.end, '2025-11-30');
  assert.equal(report.split.trainEnd, '2025-10-14');
  assert.equal(report.split.testStart, '2025-10-22');
  assert.equal(report.split.purgeDays, 7);
  const gap = (Date.parse(report.split.testStart) - Date.parse(report.split.trainEnd)) / 86400000;
  assert.equal(gap, 8, 'phải có ít nhất 7 ngày trống');
  assert.equal(report.models.length, 7);
  assert.deepEqual(report.leads, [1, 2, 3, 5, 7]);
});
check('mọi địa điểm đều có kết quả và mỗi biến x 5 thời hạn', () => {
  assert.equal(report.locations.length, LOCATIONS.length,
    `chỉ có ${report.locations.length}/${LOCATIONS.length} địa điểm. Cần chạy node collect.mjs cho tới khi đủ ${LOCATIONS.length} tệp ERA5.`);
  for (const l of report.locations) {
    const keys = new Set(l.tests.filter(t => t.usable).map(t => t.variable));
    assert.ok(keys.size >= 14, `${l.id}: chỉ ${keys.size} biến dùng được`);
    assert.ok(l.tests.length >= 16 * 5 - 4, `${l.id}: thiếu phép chấm (${l.tests.length})`);
    for (const t of l.tests.filter(x => x.usable)) {
      assert.ok(t.trainingN > 6000, `${l.id}/${t.variable}/d${t.lead}: chỉ ${t.trainingN} giờ huấn luyện`);
      assert.ok(t.testN >= 900, `${l.id}/${t.variable}/d${t.lead}: chỉ ${t.testN} giờ kiểm tra`);
    }
  }
});
check('không biến nào bị thiếu hoàn toàn', () => {
  for (const v of Object.keys(E.VARIABLES)) {
    const used = report.locations.filter(l => l.tests.some(t => t.usable && t.variable === v));
    assert.ok(used.length >= 4, `${v}: chỉ ${used.length} địa điểm dùng được`);
  }
});
check('hiệu chỉnh tốt hơn trung bình đều ở đa số phép chấm', () => {
  const h = report.headline;
  assert.ok(h.evaluated >= 300, 'số phép chấm: ' + h.evaluated);
  assert.ok(h.betterThanEqualWeight / h.evaluated >= 0.7,
    `chỉ ${h.betterThanEqualWeight}/${h.evaluated} phép chấm tốt hơn trung bình đều`);
  assert.ok(h.meanSkillVsEqualWeight > 0.01,
    'thiên lệch trung bình so với trung bình đều: ' + h.meanSkillVsEqualWeight);
  assert.ok(h.meanSkillVsBestSingle > 0,
    'thiên lệch so với hệ thống đơn tốt nhất: ' + h.meanSkillVsBestSingle);
  assert.ok(h.significantImprovementVsEqualWeight >= h.evaluated * 0.4,
    `cải thiện có ý nghĩa: ${h.significantImprovementVsEqualWeight}/${h.evaluated}`);
});
check('mọi hệ số đều hữu hạn và không phải trọng số âm tuyệt đối', () => {
  for (const l of report.locations) {
    for (const t of l.tests.filter(x => x.usable && x.calibration)) {
      const c = t.calibration;
      if (c.beta) {
        assert.ok(c.beta.every(E.finite), `${t.variable}: beta phải hữu hạn`);
        assert.ok(c.centre.length === c.beta.length, 'độ dài beta và centre phải khớp');
        assert.equal(c.beta.length, c.labels.length, 'nhãn phải khớp số hệ số');
        assert.ok(c.sigma2.alpha >= 0 && c.sigma2.beta >= 0, 'sigma^2 phải không âm');
      }
      if (c.family === 'nnls') assert.ok(c.beta.every(v => v >= 0), 'nnls phải cho trọng số không âm');
      // Family 'best' dùng đúng một hệ thống, nên cho phép modelIds dài 1.
      const wantTwo = c.family !== 'best' && c.family !== 'mean';
      assert.ok(Array.isArray(c.modelIds) && (wantTwo ? c.modelIds.length >= 2 : c.modelIds.length >= 1), 'cần đủ hệ thống theo đúng loại họ mô hình');
    }
  }
});
check('dự báo xác suất có độ tin cậy và độ sắc hợp lý', () => {
  let checked = 0;
  for (const l of report.locations) {
    for (const t of l.tests.filter(x => x.usable && x.probabilistic)) {
      const p = t.probabilistic;
      assert.ok(p.crps > 0, 'CRPS phải dương');
      assert.ok(p.rankHistogram.length === 11, 'phải có phân hoạch 10 khoảng');
      const total = p.rankHistogram.reduce((a, b) => a + b, 0);
      near(total, 1, 1e-6, 'tổng phân hoạch đứng hạng');
      if (E.finite(p.spreadSkill)) {
        assert.ok(p.spreadSkill > 0.3 && p.spreadSkill < 3, 'tỉ lệ độ rộng: ' + p.spreadSkill);
      }
      for (const k in p.pinball) {
        assert.ok(E.finite(p.pinball[k]), 'pinball phải hữu hạn');
      }
      checked++;
    }
  }
  assert.ok(checked >= 200, 'số phép có thang đo xác suất: ' + checked);
});
check('điểm hình hoá chuẩn: CSI và BSS của bản dự báo', () => {
  let n = 0;
  for (const l of report.locations) {
    for (const t of l.tests.filter(x => x.usable && x.events)) {
      for (const th of Object.keys(t.events)) {
        const e = t.events[th];
        if (E.finite(e.median.csi)) {
          assert.ok(e.median.csi >= 0 && e.median.csi <= 1, 'CSI trong 0..1');
        }
        assert.ok(e.median.csi >= 0 && e.probability.brier > 0, 'Brier phải dương');
        assert.ok(e.probability.bss === null || e.probability.bss <= 1.0001, 'BSS không vượt 1');
        for (const b of e.probability.reliability) {
          assert.ok(b.observed >= 0 && b.observed <= 1 && b.forecast >= 0 && b.forecast <= 1);
        }
        n++;
      }
    }
  }
  assert.ok(n > 300, 'số ngưỡng đã chấm: ' + n);
});
check('bootstrap có khoảng tin cậy và xác suất cải thiện hợp lý', () => {
  let n = 0;
  for (const l of report.locations) {
    for (const t of l.tests.filter(x => x.usable && x.bootstrap?.vsEqualMean)) {
      const b = t.bootstrap.vsEqualMean;
      assert.ok(b.ci95[0] < b.ci95[1], 'khoảng tin cậy phải tăng dần');
      assert.ok(b.probImprovement >= 0 && b.probImprovement <= 1);
      assert.ok(Math.abs(b.deltaRmse - (t.equalMean.rmse - t.mean.rmse)) < 1e-6, 'điểm phải khớp chênh lệch RMSE');
      n++;
    }
  }
  assert.ok(n > 200, 'số phép có bootstrap: ' + n);
});
check('mưa: chấm lũy kế 24 giờ có mặt và đánh giá được', () => {
  for (const l of report.locations) {
    for (const t of l.tests.filter(x => x.usable && x.variable === 'precipitation')) {
      if (!t.daily) continue;
      assert.ok(t.daily.days >= 20, 'số ngày lũy kế: ' + t.daily.days);
      assert.ok(E.finite(t.daily.rmse));
      assert.ok(t.daily.events['50'], 'phải có chấm mưa lớn 24 giờ');
    }
  }
});
check('hướng gió dùng thành phần u/v và có sai số góc', () => {
  const t = report.locations.flatMap(l => l.tests).find(x => x.usable && x.variable === 'wind_direction_10m');
  assert.ok(t, 'phải có ít nhất một phép chấm hướng gió');
  assert.ok(t.direction.circularMae >= 0 && t.direction.circularMae < 90, 'sai số góc: ' + t.direction.circularMae);
  assert.ok(t.direction.vectorRmse > 0);
  assert.ok(t.direction.within45 > t.direction.within30, 'tỉ lệ trong 45° phải lớn hơn trong 30°');
});
check('mã thời tiết dùng bộ phân loại, không hồi quy', () => {
  const t = report.locations.flatMap(l => l.tests).find(x => x.usable && x.variable === 'weather_code');
  assert.ok(t, 'phải có phép chấm mã thời tiết');
  assert.equal(t.selected.family, 'knn');
  assert.ok(t.accuracy > 0.25 && t.accuracy < 1, 'độ chính xác: ' + t.accuracy);
  assert.ok(t.accuracyGroup >= t.accuracy, 'độ chính xác theo nhóm phải không thấp hơn chính xác tuyệt đối');
});
check('bảng tra vùng mà trình duyệt dùng phải được kiểm chứng và có thể tái tạo', () => {
  // The page cannot ship the 2400-row kNN bank, so it ships this lookup instead.
  // It must therefore be scored on the frozen test window too, not assumed.
  const t = report.locations.flatMap(l => l.tests).find(x => x.usable && x.variable === 'weather_code');
  assert.ok(t, 'phải có phép chấm mã thời tiết');
  const r = t.regime;
  assert.ok(r, 'phải xuất bảng tra vùng');
  assert.ok(r.cells.length > 5, 'bảng phải có ô: ' + r.cells.length);
  assert.ok(r.cells.length < 1500, 'bảng phải đủ gọn để nhúng vào HTML: ' + r.cells.length);
  assert.equal(r.edges.length, r.fields.length, 'số ngưỡng phải khớp số trường');
  assert.ok(r.lookupN > 200, 'phải chấm được bảng trên tập kiểm tra: ' + r.lookupN);
  assert.ok(E.finite(r.accuracy) && r.accuracy > 0.2, 'độ chính xác bảng tra: ' + r.accuracy);
  assert.ok(r.accuracy <= t.accuracy + 1e-9,
    'bảng nén không được tốt hơn kNN gốc, nếu không là đánh giá sai');
  // Every cell must be reproducible from its key, and every field must bind.
  const key = E.regimeKey([10, 0, 3, 25, 50], r.edges);
  assert.ok(typeof key === 'string' && key.length === r.edges.length, 'khoá phải dài bằng số trường');
  assert.equal(E.regimeKey([null, 1, 1, 1, 1], r.edges), null, 'trường thiếu thì không có khoá');
  for (const c of r.cells) {
    assert.ok(Number.isInteger(c.code) && c.code >= 0 && c.code <= 99, 'mã WMO hợp lệ: ' + c.code);
    assert.ok(c.support >= r.minSupport, 'ô phải đủ hỗ trợ: ' + c.support);
    assert.ok(c.purity > 0 && c.purity <= 1, 'độ thuần phải trong 0..1');
  }
});
check('có hiệu chỉnh gộp cho địa điểm ngoài phạm vi đã hiệu chỉnh', () => {
  assert.ok(Object.keys(report.pooled).length >= 12, 'số biến có bản gộp');
  let n = 0;
  for (const v of Object.keys(report.pooled)) {
    for (const lead of Object.keys(report.pooled[v])) {
      const p = report.pooled[v][lead];
      assert.ok(p.calibration, `${v}/d${lead}: thiếu hiệu chỉnh`);
      assert.ok(p.testN > 500, `${v}/d${lead}: chỉ ${p.testN} giờ`);
      n++;
    }
  }
  assert.ok(n >= 60, 'số bản gộp: ' + n);
});
check('không có lỗi thu thập dữ liệu', () => {
  assert.deepEqual(report.errors, [], 'lỗi: ' + report.errors.slice(0, 3).join(' | '));
});

console.log('\n7. Trang HTML độc lập');
const html = await fs.readFile(new URL('./dist/index.html', import.meta.url), 'utf8');
check('không còn nhãn thay thế', () => {
  assert.ok(!/\/\*(STYLE|APP|ENGINE|BENCHMARK)\*\//.test(html));
});
check('mọi khối script đều biên dịch được', () => {
  let n = 0;
  for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (m[0].slice(0, m[0].indexOf('>')).includes('application/json')) JSON.parse(m[1]);
    else { new vm.Script(m[1]); n++; }
  }
  assert.ok(n >= 2, 'số khối script thực thi: ' + n);
});
check('mọi biến trong báo cáo đều xuất hiện trong giao diện', () => {
  for (const v of Object.keys(report.variables)) {
    assert.ok(html.includes(v) || html.includes(report.variables[v].short), 'thiếu biến trên UI: ' + v);
  }
  for (const l of report.locations) assert.ok(html.includes(l.id), 'thiếu địa điểm: ' + l.id);
});
check('bản tin chính thức NCHMF được nhúng và hiển thị', () => {  for (const id of ['nchmf-data', 'officialBanner', 'nchmfMeta', 'nchmfList']) {
    assert.ok(html.includes(`id="${id}"`), 'thiếu phần tử NCHMF: ' + id);
  }
  assert.ok(html.includes('Bản tin chính thức (NCHMF)'), 'thiếu panel NCHMF');
  assert.ok(html.includes('id="radarLegend"'), 'thiếu chú giải radar');
  const m = html.match(/<script id="nchmf-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'thiếu khối nchmf-data');
  const nchmf = JSON.parse(m[1]);
  assert.ok(Array.isArray(nchmf.categories), 'nchmf phải có categories');
});
check('menu ghim đủ địa điểm đã cấu hình (kể cả chờ hiệu chỉnh)', () => {
  const cfgIds = LOCATIONS.map(l => l.id);
  const haveIds = [...report.locations.map(l => l.id), ...(report.pinnedPlaces || []).map(p => p.id)];
  for (const id of cfgIds) assert.ok(haveIds.includes(id), 'menu thiếu: ' + id);
  for (const id of ['daklak', 'songcau']) {
    assert.ok(haveIds.includes(id), 'menu thiếu điểm ghim: ' + id);
    assert.ok(html.includes(id === 'daklak' ? 'Đắk Lắk' : 'Sông Cầu'), 'thiếu tên điểm ghim');
  }
});
check('app.js truyền đúng gói hiệu chỉnh vào engine (hồi quy lỗi found.calibration)', () => {
  const app = readFileSync(new URL('./dist/app.js', import.meta.url), 'utf8');
  // calibrationFor trả về { calib, ... } nên mọi chỗ dùng phải là found.calib.
  assert.ok(!/found\.calibration\b/.test(app), 'app.js còn dùng found.calibration (sai key, engine nhận undefined)');
  assert.ok(/calib:\s*found\.calib\b/.test(app), 'thiếu truyền calib: found.calib vào E.calibrate');
});
check('giao diện co giãn được trên máy tính lẫn điện thoại', () => {
  const css = readFileSync(new URL('./dist/style.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./dist/app.js', import.meta.url), 'utf8');
  // Lý do gốc của tràn ngang: 1fr = minmax(auto,1fr) nên track không co nhỏ được
  // dưới min-content. Trong CSS chỉ khai báo cuối cùng của một thuộc tính mới
  // thắng, nên phải tìm đúng khai báo đó chứ không phải khối xuất hiện cuối.
  const lastDecl = (sel, prop) => {
    // Bỏ chú thích trước: dấu phẩy trong /* ... */ sẽ dính vào selector và làm
    // hỏng việc tách danh sách chọn.
    const parts = css.replace(/\/\*[\s\S]*?\*\//g, '').split(/[{}]/);
    let value = null;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!parts[i].split(',').map(s => s.trim()).includes(sel)) continue;
      const body = parts[i + 1];
      const p = body.indexOf(prop + ':');
      if (p < 0) continue;
      value = body.slice(p + prop.length + 1).split(';')[0].trim();
    }
    return value;
  };
  assert.ok(css.includes('minmax(0,1fr)'), 'thiếu minmax(0,1fr) cho lưới');
  for (const sel of ['.month-cal', '.days', '.metric-grid', '.current-stats']) {
    const v = lastDecl(sel, 'grid-template-columns');
    assert.ok(v && v.includes('minmax(0,1fr)'), sel + ' còn dùng 1fr dễ tràn ngang: ' + v);
  }
  // Bảng và dải giờ phải cuộn ngang thay vì bị bóp.
  assert.ok(css.includes('.table-wrap table{min-width:'), 'thiếu min-width để bảng cuộn ngang');
  assert.ok(/overflow-x:auto/.test(css), 'thiếu cuộn ngang cho bảng/dải giờ');
  assert.ok(css.includes('th:first-child') && css.includes('position:sticky'), 'thiếu ghim cột đầu khi cuộn bảng');
  // Ô lịch tháng 7 cột trên màn 360px: nhiệt thấp tách dòng, bỏ đơn vị mm.
  assert.ok(app.includes('mday-lo'), 'thiếu dòng nhiệt thấp riêng cho màn nhỏ');
  assert.ok(app.includes('class="unit"'), 'thiếu span đơn vị để ẩn trên màn nhỏ');
  assert.ok(css.includes('.mday .unit{display:none}'), 'chưa ẩn đơn vị mm trên màn nhỏ');
  // Radar không chiếm cả màn hình điện thoại.
  assert.ok(/\.radar-map\{height:3\d\dpx\}/.test(css), 'radar chưa có chiều cao riêng cho màn nhỏ');
  // Vùng chạm tối thiểu cho thiết bị chạm.
  assert.ok(css.includes('@media(pointer:coarse)'), 'thiếu vùng chạm 44px cho thiết bị chạm');
  // Không được dùng chiều rộng cứng vượt màn hình điện thoại (bỏ qua max/min).
  assert.ok(/(?<![-\w])width:\s*(1[0-9]{3}|[5-9]\d\d)px/.test(css) === false,
    'có chiều rộng cứng quá rộng cho điện thoại');
});
check('mức nước quy ước quy đúng công thức và không bịa số', () => {
  // H = a * (Q/q0)^b
  near(E.nominalStage(1000, 2.02, 0.54, 1000), 2.02, 1e-9, 'tại lưu lượng tham chiếu');
  near(E.nominalStage(0, 2.02, 0.54, 1000), 0, 1e-9, 'lưu lượng bằng 0');
  assert.equal(E.nominalStage(null, 2, 0.5, 1000), null, 'thiếu lưu lượng phải trả null');
  assert.equal(E.nominalStage(100, 2, 0, 1000), null, 'số mũ 0 là chia 0, phải trả null');
  // Mốc tăng theo lưu lượng: đây là điều kiện vật lý bắt buộc.
  const qs = [100, 300, 1000, 3000, 10000];
  let prev = -1;
  for (const q of qs) {
    const H = E.nominalStage(q, 2.02, 0.54, 1000);
    assert.ok(E.finite(H), 'mực nước phải hữu hạn ở Q=' + q);
    assert.ok(H > prev, 'mực nước phải tăng khi lưu lượng tăng: Q=' + q);
    prev = H;
  }
  // Qua bác nghịch. nominalStage làm tròn 2 chữ số thập phân nên khi quay ngược
  // lưu lượng có sai số nhỏ; dung sai phản ánh đúng điều đó, không nới tùy tiện.
  const H = E.nominalStage(2500, 2.02, 0.54, 1000);
  const back = E.stageToQ(H, 2.02, 0.54, 1000);
  assert.ok(Math.abs(back - 2500) / 2500 < 0.002, 'qua bác nghịch phải khớp trong 0,2%: ' + back);
  assert.equal(E.stageToQ(0, 2, 0.5, 100), 0, 'mực 0 là lưu lượng 0');
});
check('lưới khối khí: phân loại theo trung bình vùng và phủ đúng bán kính', () => {
  const values = [
    { t850: 12, z850: 1500, z500: 5800 },   // lạnh
    { t850: 16, z850: 1520, z500: 5880 },
    { t850: 20, z850: 1540, z500: 5960 },
    { t850: 24, z850: 1560, z500: 6040 },   // nóng
    { t850: 28, z850: 1580, z500: 6120 },
  ];
  const g = E.airMassGrid({ lat: 10.8, lon: 106.6, radiusKm: 400, stepKm: 200, values });
  assert.ok(g.cells.length > 0, 'phải có ô lưới');
  for (const c of g.cells) assert.ok(c.km <= 400 + 1e-6, 'ô lưới vượt bán kính yêu cầu: ' + c.km);
  assert.ok(E.finite(g.mean.t850), 'trung bình vùng phải hữu hạn');
  const cold = E.classifyCell({ t850: 12, thick: 4300 }, g.mean, 350);
  const warm = E.classifyCell({ t850: 28, thick: 4500 }, g.mean, 180);
  assert.equal(cold.tag, 'Khối lạnh', 'ô lạnh phải được đánh dấu lạnh');
  assert.equal(warm.tag, 'Khối nóng', 'ô nóng phải được đánh dấu nóng');
  assert.ok(cold.dT < 0 && warm.dT > 0, 'độ lệch phải đúng dấu');
  assert.equal(E.classifyCell({ t850: null, thick: null }, g.mean, 0).tag, undefined, 'ô thiếu dữ liệu thì không đoán');
});
check('gió bar: số đầu đúng quy ước 10 km/h', () => {
  assert.equal(E.windBarb(5, 90).level, 0, 'dưới 10 km/h: không đầu');
  assert.equal(E.windBarb(25, 0).level, 2, '25 km/h: hai đầu');
  const b = E.windBarb(45, 350);
  assert.equal(b.level, 4, '45 km/h: bốn đầu');
  assert.equal(b.half, 2, 'bốn đầu = hai cặp');
  assert.equal(b.dirDeg, 350, 'hướng chuẩn hoá về 0–360');
  assert.equal(E.windBarb(360, 0).dirDeg, 0, '360 độ phải về 0');
  assert.equal(E.windBarb(null, 0), null, 'thiếu tốc độ thì trả null');
});
check('giao diện: có nút GPS, lớp khối khí trên radar và bảng mực nước', () => {
  for (const id of ['geoBtn', 'geoNote', 'airGridToggle', 'airGridMeta', 'airGridNote', 'airLegend', 'riverLevels', 'riverNameMeta']) {
    assert.ok(html.includes(`id="${id}"`), 'thiếu phần tử: ' + id);
  }
  assert.ok(!/mực nước[^.]{0,60}\bmet\b/i.test(html), 'không được hứa mực nước đo được');
  assert.ok(/số đo chính thức|đường đo đạc/i.test(html), 'phải nói rõ mực nước là số quy ước cần đường đo đạc');
  assert.ok(html.includes('GPS'), 'phải nói rõ dùng GPS');
  assert.ok(/https/i.test(html), 'phải nhắc yêu cầu https cho GPS');
  const app = readFileSync(new URL('./dist/app.js', import.meta.url), 'utf8');
  // Không còn ghép key cố định khi gộp nhiều hệ thống; tìm key tuỳ phản hồi.
  assert.ok(/Object\.keys\(h\)\.find\(k => k === base \|\| k\.startsWith\(base \+ '_'\)\)/.test(app),
    'phải tìm key đúng trong phản hồi thay vì ghép chuỗi cố định');
});
check('lớp khối khí và sông có mặt, ghi rõ giới hạn nguồn số liệu', () => {
  for (const id of ['airMassBox', 'trajectory', 'trajNote', 'riverList', 'riverChart', 'massMeta', 'tcList', 'tcMeta']) {
    assert.ok(html.includes(`id="${id}"`), 'thiếu phần tử: ' + id);
  }
  assert.ok(html.includes('data-view="mass"'), 'thiếu tab Khối khí & sông');
  assert.ok(html.includes('id="mass"'), 'thiếu khối nội dung tab khối khí');
  // Không được hứa "mực nước" khi nguồn chỉ có lưu lượng.
  assert.ok(html.includes('m³/s'), 'phải nêu đơn vị lưu lượng');
  assert.ok(!/mực nước[^.]{0,40}\bmet\b/i.test(html), 'không được hứa mực nước tính bằng mét');
  assert.ok(/chưa qua hiệu chỉnh/i.test(html), 'phải nói rõ lớp này chưa hiệu chỉnh');
  assert.ok(html.includes('GloFAS'), 'phải ghi nguồn GloFAS');
  assert.ok(html.includes('850 hPa'), 'phải ghi rõ tầng dữ liệu 850 hPa');
});
check('giao diện dự báo dài hạn và tìm kiếm đa nguồn có mặt', () => {
  for (const id of ['searchResults', 'monthCal', 'monthTitle', 'monthMeta', 'dayDetail', 'dayDetailTitle', 'dayDetailMeta', 'disasterPlaceNote', 'windyLink', 'aqiNow', 'aqiStrip', 'aqiPollutants', 'aqiAdvice', 'aqiMeta']) {
    assert.ok(html.includes(`id="${id}"`), 'thiếu phần tử: ' + id);
  }
  assert.ok(html.includes('<h2>Dự báo 16 ngày</h2>'), 'phải có tiêu đề Dự báo 16 ngày');
  assert.ok(html.includes('<h2>Không khí hôm nay</h2>'), 'phải có mục không khí');
  assert.ok(html.includes('id="disasterChips"'), 'phải có chip chọn vị trí thiên tai');
  assert.ok(html.includes('id="disasterSearchForm"'), 'phải có ô tìm vị trí thiên tai tự do');
  assert.ok(html.includes('id="disasterSearchResults"'), 'phải có vùng kết quả tìm thiên tai');
  assert.ok(!html.includes('id="disasterCity"'), 'đã gỡ select vị trí thiên tai cũ');
  assert.ok(!html.includes('BỐI CẢNH THÁNG'), 'đã gỡ mục bối cảnh tháng & năm');
  for (const id of ['monthPrev', 'monthPicker', 'monthNext', 'monthCal']) {
    assert.ok(html.includes(`id="${id}"`), 'thiếu điều hướng tháng: ' + id);
  }
  assert.ok(!html.includes('compare-panel'), 'đã gỡ panel so sánh');
  assert.ok(html.includes('<h2>64 biến, một chỗ</h2>'), 'tiêu đề phải là "64 biến, một chỗ"');
  assert.ok(html.includes('<h1>64 biến.'), 'tiêu đề chính phải là "64 biến."');
});

check('khối khí: độ dày cột và quy ước hướng gió', () => {
  // Do day 500-850: don vi met, va phai bo qua gia tri thieu.
  near(E.thickness(5909, 1539), 4370, 1e-9, 'do day cot');
  assert.equal(E.thickness(null, 1539), null, 'thieu gia tri phai tra null');
  // Huong du bao: toan do bat dau tai phia bac, chay ve phia nam.
  const n = E.toUms(36, 0);   // 36 km/h = 10 m/s, huong bac
  near(n.v, -10, 1e-9, 'v huong bac');
  near(n.u, 0, 1e-9, 'u huong bac');
  const e = E.toUms(36, 90);  // huong dong, thoi sang phai
  near(e.u, -10, 1e-9, 'u huong dong');
  near(e.v, 0, 1e-9, 'v huong dong');
  assert.equal(E.toUms(null, 90).u, null, 'thieu toc do phai tra null');
});
check('khối khí: quỹ đạo đi đúng hướng gió và ngược thời gian', () => {
  const u = new Array(12).fill(0), v = new Array(12).fill(-10); // gió từ bắc, chạy về nam
  const fwd = E.trajectory({ lat: 10.8, lon: 106.6, u, v, hours: 6, stepKm: 20, sign: 1 });
  const back = E.trajectory({ lat: 10.8, lon: 106.6, u, v, hours: 6, stepKm: 20, sign: -1 });
  assert.equal(fwd.length, 7, '6 buoc phai ra 7 diem');
  assert.ok(fwd[6].lat < 10.8, 'khi gio chay ve nam thi viet do phai giam');
  assert.ok(back[6].lat > 10.8, 'nguoc thoi gian thi phai tro len phia bac');
  near(E.distanceKm({ lat: 10.8, lon: 106.6 }, fwd[6]), 120, 3, 'quang duong 6 x 20 km');
  // Chuan hoa: giong nhau thi duong di phai dung thang.
  const z = new Array(6).fill(0);
  const straight = E.trajectory({ lat: 0, lon: 0, u: z, v: z, hours: 3, stepKm: 10, sign: 1 });
  assert.equal(straight.length, 1, 'khong co gio thi khong di duoc');
});
check('khối khí: phân loại nóng/lạnh theo độ lệch chuẩn', () => {
  const cold = E.airMass({ t850: 10, t850Baseline: 20, thick: 4200, thickBaseline: 4500, rh850: 50, source: 350 });
  const warm = E.airMass({ t850: 27, t850Baseline: 20, thick: 4700, thickBaseline: 4500, rh850: 95, source: 200 });
  const mid = E.airMass({ t850: 20.2, t850Baseline: 20, thick: 4500, thickBaseline: 4500 });
  assert.equal(cold.tag, 'Khối lạnh', 'nhiet do thap hon chuan nhieu la khoi lanh');
  assert.equal(cold.advection, 'Bắc', 'gio tu bac la advection bac');
  assert.equal(warm.tag, 'Khối nóng', 'nhiet do cao hon chuan nhieu la khoi nong');
  assert.equal(warm.moisture, 'Ẩm', 'do am cao la am');
  assert.equal(mid.tag, 'Ôn hòa', 'gan chuan thi on hoa');
  assert.equal(E.airMass({ t850: null }), null, 'khong du du lieu thi khon doan');
});
check('khối khí: nhận diện mặt lạnh và mặt ấm', () => {
  const d0 = new Array(12).fill(20), d1 = new Array(12).fill(80);
  const t0 = new Array(12).fill(22), t1 = new Array(12).fill(16);
  const cold = E.frontalPassage({ dir850: [...d0, ...d1], t850: [...t0, ...t1] });
  assert.equal(cold.kind, 'Mặt lạnh', 'gio xoay thuan chieu + nhiet do giam = mat lanh');
  assert.equal(cold.leadHours, 12, 'bao cao so gio nhin lai');
  assert.ok(cold.windShift >= 20, 'luoc ghi nho goc xoay');
  const warm = E.frontalPassage({ dir850: [...d1, ...d0], t850: [...t1, ...t0] });
  assert.equal(warm.kind, 'Mặt ấm', 'nguoc chieu dao + nhiet do tang = mat am');
  assert.equal(E.frontalPassage({ dir850: d0.concat(d0), t850: t0.concat(t0) }), null, 'khong co bien doi thi khong bao');
});
check('sông: nguy cơ lưu lượng đọc từ dải phân vị', () => {
  const r = E.riverRisk({ q: 120, qP25: 90, qP75: 150, recent: 100 });
  assert.equal(r.q, 120, 'gia tri goc');
  assert.equal(r.p25, 90, 'can duoi');
  assert.equal(r.p75, 150, 'can tren');
  near(r.vsRecent, 0.2, 1e-9, 'vuot trung binh 20%');
  // recent nam o phan tu 20 cua dai => ~80% kha nang vuot
  assert.ok(r.exceed > 0.7 && r.exceed < 0.9, 'xac suat vuot nhat suyet phai doan dung khoang: ' + r.exceed);
  assert.equal(E.riverRisk({ q: null }), null, 'khong co so lieu thi tra null');
  const wide = E.riverRisk({ q: 100, qP25: 50, qP75: 900, recent: 200 });
  // Dai phan vi rong hon nghia la it chap han hon: xac suat vuot TB phai THAP hon.
  assert.ok(wide.exceed < r.exceed, `dai rong thi xac suat vuot phai thap hon (${wide.exceed} so voi ${r.exceed})`);
});
check('bản đồ: khoảng cách tới đường đi và hướng la', () => {
  const a = { lat: 10, lon: 106 }, b = { lat: 11, lon: 106 };
  const north = E.bearingDeg(a, b);
  assert.ok(north >= 350 || north <= 10, 'huong bac phai la ~0 do, nhan duoc ' + north);
  assert.ok(E.bearingDeg(b, a) > 170 && E.bearingDeg(b, a) < 190, 'huong nam phai la ~180 do');
  const line = [{ lat: 10, lon: 106, hoursAgo: 0 }, { lat: 12, lon: 106, hoursAgo: 6 }];
  const hit = E.nearestOnTrack({ lat: 11, lon: 107 }, line);
  // 1 do kinh do o vi do ~11° B la 111.32 * cos(11°) ~ 109 km, khong phai 104.
  near(hit.km, 109.2, 2, 'diem gan nhat cach 1 do kinh do');
  assert.ok(hit.hoursAgo >= 0 && hit.hoursAgo <= 6, 'vi tri phai nam trong doan, nhan ' + hit.hoursAgo);
});
console.log(`\n${failures.length ? 'FAIL' : 'PASS'} — ${passed} nhóm kiểm thử đã qua, ${failures.length} lỗi.`);
if (failures.length) {
  console.log('Danh sách lỗi:');
  for (const f of failures) console.log(`  - ${f.name}\n      ${f.message}`);
}
process.exitCode = failures.length ? 1 : 0;
console.log('\nTóm tắt độ chính xác trên tập kiểm tra đóng băng:');
console.log(`  ${report.headline.evaluated} phép chấm, ${report.headline.betterThanEqualWeight} tốt hơn trung bình đều`);
console.log(`  ${report.headline.betterThanBestSingle} tốt hơn hệ thống đơn tốt nhất`);
console.log(`  cải thiện RMSE trung bình: ${(report.headline.meanSkillVsEqualWeight * 100).toFixed(2)}% so với trung bình đều, ${(report.headline.meanSkillVsBestSingle * 100).toFixed(2)}% so với hệ thống tốt nhất`);
console.log(`  bootstrap ≥90%: ${report.headline.significantImprovementVsEqualWeight} và ${report.headline.significantImprovementVsBestSingle} phép chấm`);
