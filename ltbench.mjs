/**
 * Chấm chỉ số nguy cơ bão tố trên tập đã đóng băng.
 *
 * SỰ THẬT: lượng mưa ERA5 cùng giờ. KHÔNG phải số đo sét — không có nguồn mở
 * nào cho dữ liệu tia sét ở Việt Nam. Phép đo là khả năng phân biệt: giờ nào
 * thực sự có mưa mạnh trong phân tích lại, chỉ số có nhận ra không.
 *
 * BA ĐIỀU PHẢI LÀM ĐÚNG, cả ba đều đã sai trong lần làm đầu:
 *
 * 1. Điểm thô của chỉ số không phải xác suất. Đưa thẳng vào Brier là ra BSS
 *    âm hàng chục lần chỉ vì lỗi đó. Phải hiệu chuẩn trên tập HUẤN LUYỆN
 *    trước, rồi mới chấm trên tập thử nghiệm.
 *
 * 2. Quan hệ CAPE–mưa ĐỔI THEO MÙA, không phải hằng số: mạnh ở gió mùa đông
 *    bời biển trung và nam (Nha Trang ρ≈0,67, Phú Yên ≈0,43) nhưng yếu hoặc âm
 *    ở Hà Nội mùa Tây Nam (≈−0,23). Trung bình cả năm sẽ giấu đúng cái đó,
 *    nên báo cáo theo mùa và không gộp làm một con số.
 *
 * 3. Vì sao KHÔNG chấm lead-N như 16 biến còn lại: kho previous-runs của
 *    Open-Meteo không phục vụ CAPE/LI/CIN theo độ trễ (đo thực nghiệm: trả về
 *    cột không hệ số `_previous_dayN`), nên không tồn tại dữ liệu lead-N cho
 *    chỉ số này. Đây là giới hạn của nguồn mở — ghi thẳng vào báo cáo và lên
 *    giao diện thay vì giấu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RAW, DIST, LOCATIONS, DET_MODELS, SPLIT, PERIOD } from './config.mjs';

const E = globalThis.AtmosEngine;
if (!E) throw new Error('phải nạp dist/engine.js trước');

const LT = path.join(RAW, 'lt');
const THRESHOLDS = [2, 5, 10];
const MIN_COVERAGE = 0.9;

/* Mùa khí tượng Việt Nam, theo tháng. GĐ đông là mùa mưa bão bờ biển trung
 * và nam; GĐ mưa Tây Nam là mùa mưa Tây Nam Bắc Bộ. */
const SEASONS = {
  dong: { name: 'GĐ đông bờ biển (11–2)', months: [11, 12, 1, 2] },
  kho: { name: 'GĐ khô (3–5)', months: [3, 4, 5] },
  tayNam: { name: 'GĐ mùa mưa Tây Nam (6–9)', months: [6, 7, 8, 9] },
  chuyen: { name: 'GĐ chuyển mùa (10–11)', months: [10, 11] },
};

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const finite = E.finite;

function loadTruth(loc) {
  const j = read(path.join(RAW, `${loc.id}-era5.json`));
  return { time: j.hourly.time, precip: j.hourly.precipitation || [] };
}

/** Điểm thô của chỉ số, theo từng mô hình, đã căn theo mảng giờ chuẩn. */
function loadIndex(loc, time) {
  const out = {};
  for (const m of DET_MODELS) {
    let j;
    try { j = read(path.join(LT, `${loc.id}-${m.id}.json`)); } catch { continue; }
    if (!j.time || j.time.length !== time.length) continue;
    const risk = new Array(time.length).fill(NaN);
    let n = 0;
    for (let i = 0; i < time.length; i++) {
      const idx = E.lightningIndex({
        cape: j.cape[i],
        liftedIndex: j.lifted_index[i],
        convectiveInhibition: j.convective_inhibition[i],
      });
      if (idx) { risk[i] = idx.risk; n++; }
    }
    if (n >= time.length * MIN_COVERAGE) out[m.id] = risk;
  }
  return out;
}

/** Baseline: CAPE đơn thuần, để chứng minh phần LI/CIN có đáng giá không. */
function loadCapeOnly(loc, time) {
  const out = {};
  for (const m of DET_MODELS) {
    let j;
    try { j = read(path.join(LT, `${loc.id}-${m.id}.json`)); } catch { continue; }
    if (!j.time || j.time.length !== time.length) continue;
    const risk = new Array(time.length).fill(NaN);
    for (let i = 0; i < time.length; i++) {
      const idx = E.lightningIndex({ cape: j.cape[i] });
      if (idx) risk[i] = idx.risk;
    }
    if (risk.filter(finite).length >= time.length * MIN_COVERAGE) out[m.id] = risk;
  }
  return out;
}

function ensembleMean(byModel, len) {
  const out = new Array(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    let s = 0, k = 0;
    for (const arr of Object.values(byModel)) {
      if (finite(arr[i])) { s += arr[i]; k++; }
    }
    if (k) out[i] = s / k;
  }
  return out;
}

function rollingFolds(n, k = 5) {
  const folds = [];
  const size = Math.floor(n / k);
  for (let i = 0; i < k; i++) {
    const a = i * size, b = i === k - 1 ? n : (i + 1) * size;
    if (a >= b) continue;
    folds.push({ train: [0, a], test: [a, b] });
  }
  return folds;
}

const inTest = t => t >= SPLIT.testStart + 'T00:00';
const inTrain = t => t < SPLIT.trainEnd + 'T00:00';
const monthOf = t => Number(t.slice(5, 7));

/**
 * Tỉ lệ giờ có mưa ở nhóm CAPE cao so với nhóm thấp.
 *
 * Đây là phép đo dễ hiểu nhất và cũng là phép đo thành thật: "khi chỉ số nằm
 * trong nhóm 20% cao nhất, bao nhiêu % số giờ có mưa ≥1 mm — so với nhóm
 * còn lại". Một hệ số tương quan 0,2 nghe có vẻ tệ nhưng nếu nhóm cao mưa
 * gấp đôi nhóm thấp thì người dùng vẫn dùng được.
 */
function wetContrast(rows, highCut) {
  const hi = rows.filter(r => r.risk >= highCut);
  const lo = rows.filter(r => r.risk < highCut);
  const rate = a => a.length ? a.filter(r => r.obs >= 1).length / a.length : null;
  const rh = rate(hi), rl = rate(lo);
  return {
    high: { n: hi.length, rate: rh == null ? null : E.round(rh, 4) },
    low: { n: lo.length, rate: rl == null ? null : E.round(rl, 4) },
    ratio: rh != null && rl > 0 ? E.round(rh / rl, 2) : null,
  };
}

const locations = {};
const perLoc = [];

for (const loc of LOCATIONS) {
  const truth = loadTruth(loc);
  const byModel = loadIndex(loc, truth.time);
  const ids = Object.keys(byModel);
  if (!ids.length) { console.log(`  ${loc.id}: không mô hình nào đủ phủ`); continue; }
  const ens = ensembleMean(byModel, truth.time.length);
  /*
   * Biến thể CHỈ MỘT MÔ HÌNH, và là mô hình duy nhất có đủ CAPE + LI + CIN.
   *
   * Cần vì các mô hình dùng bộ thành phần khác nhau nên điểm của chúng không
   * cùng thang đo: mô hình thiếu CIN được chuẩn hoá lại và có điểm cao hơn.
   * Trung bình các điểm khác thang rồi dùng làm dải phân vị thì dải đó lệch.
   * Vì vậy báo cáo thêm số của GFS một mình — nếu kết luận không đổi thì nó
   * không phụ thuộc vào cách trộn, và ta nói được điều đó.
   */
  const fullOnly = ids.filter(id => {
    const j = read(path.join(LT, loc.id + '-' + id + '.json'));
    return (j.lifted_index || []).some(v => v != null) && (j.convective_inhibition || []).some(v => v != null);
  });
  const ensFull = fullOnly.length ? fullOnly[0] ? byModel[fullOnly[0]] : null : null;
  const idsFull = fullOnly.length && byModel[fullOnly[0]] ? fullOnly : [];
  const ensCape = ensembleMean(loadCapeOnly(loc, truth.time), truth.time.length);

  const rows = [];
  for (let i = 0; i < truth.time.length; i++) {
    if (!finite(ens[i]) || !finite(truth.precip[i])) continue;
    rows.push({ x: ens[i], obs: truth.precip[i], t: truth.time[i], train: inTrain(truth.time[i]), test: inTest(truth.time[i]) });
  }

  /*
   * Hai cách hiệu chuẩn, cùng fit trên tập HUẤN LUYỆN, để so sánh công khai.
   *
   * Logistic là đường thẳng trên thang log-odds. Isotonic là bậc thang bám
   * tần suất thực nghiệm. Chỉ số phân biệt tốt ở NHÓP CAO (Đà Lạt: 32% số giờ
   * có mưa so với 6,5%) nhưng quan hệ đó không thẳng, nên logistic làm phẳng mất
   * đuôi và BSS về gần không. Isotonic giữ được đuôi đó — và vì vậy là cách
   * chính mà ứng dụng dùng; logistic chỉ còn để đối chiếu.
   */
  const calLog = {}, calIso = {};
  const tr = rows.filter(r => r.train);
  for (const th of THRESHOLDS) {
    calLog[th] = E.logisticFit(tr.map(r => r.x), tr.map(r => (r.obs >= th ? 1 : 0)));
    calIso[th] = E.isotonicCalibrate(tr.map(r => r.x), tr.map(r => (r.obs >= th ? 1 : 0)));
  }
  const cal = calIso;

  // Gấp đo lần trên cả năm: hiệu chuẩn lấy trên phần trước mỗi gấp, không bao
  // giờ chấm đưa vào đường fit — nếu không thì số đẹp lên và vô nghĩa.
  const foldRows = [], foldRowsLog = [];
  for (const f of rollingFolds(rows.length)) {
    const slice = rows.slice(f.train[0], f.train[1]);
    const c = E.isotonicCalibrate(slice.map(r => r.x), slice.map(r => (r.obs >= 5 ? 1 : 0)));
    const cl = E.logisticFit(slice.map(r => r.x), slice.map(r => (r.obs >= 5 ? 1 : 0)));
    if (!c) continue;
    for (let i = f.test[0]; i < f.test[1]; i++) {
      const r = rows[i];
      foldRows.push({ risk: E.applyIsotonic(c, [r.x])[0], obs: r.obs, t: r.t });
      foldRowsLog.push({ risk: cl ? E.applyCalibration(cl, [r.x])[0] : null, obs: r.obs });
    }
  }

  const season = {};
  for (const [key, def] of Object.entries(SEASONS)) {
    const sub = foldRows.filter(r => def.months.includes(monthOf(r.t)));
    season[key] = {
      n: sub.length,
      spearman: E.round(E.spearman(sub.map(r => r.risk), sub.map(r => r.obs)), 4),
      bss: (E.lightningVerify(sub, 5) || {}).bss ?? null,
      contrast: wetContrast(sub, E.quantile(sub.map(r => r.risk).filter(finite), 0.8)),
    };
  }

  const bands = E.lightningBands(rows.map(r => r.x));
  const verify = {};
  for (const th of THRESHOLDS) {
    const c = cal[th], cl = calLog[th];
    const fr = rows.filter(r => r.test).map(r => ({ risk: c ? E.applyIsotonic(c, [r.x])[0] : null, obs: r.obs, t: r.t }));
    verify[th] = {
      frozenTest: E.lightningVerify(fr, th),
      rollingYear: E.lightningVerify(foldRows, th),
      logistic: E.lightningVerify(foldRowsLog, th),
    };
  }

  // Cùng phép đo nhưng trên mô hình đủ cả ba thành phần.
  const fullRows = [];
  if (ensFull) {
    for (let i = 0; i < truth.time.length; i++) {
      if (!finite(ensFull[i]) || !finite(truth.precip[i])) continue;
      fullRows.push({ x: ensFull[i], obs: truth.precip[i], t: truth.time[i] });
    }
  }
  const fullVerify = (() => {
    if (!fullRows.length) return null;
    const fold = [];
    for (const f of rollingFolds(fullRows.length)) {
      const slice = fullRows.slice(f.train[0], f.train[1]);
      const c = E.isotonicCalibrate(slice.map(r => r.x), slice.map(r => (r.obs >= 5 ? 1 : 0)));
      if (!c) continue;
      for (let i = f.test[0]; i < f.test[1]; i++) fold.push({ risk: E.applyIsotonic(c, [fullRows[i].x])[0], obs: fullRows[i].obs });
    }
    const cut = E.quantile(fullRows.map(r => r.x), 0.8);
    return {
      models: idsFull,
      verify: E.lightningVerify(fold, 5),
      contrast: wetContrast(fold, E.quantile(fold.map(r => r.risk).filter(finite), 0.8)),
      contrastRaw: wetContrast(fullRows, cut),
    };
  })();

  locations[loc.id] = {
    name: loc.name,
    models: ids,
    modelNames: ids.map(id => (DET_MODELS.find(m => m.id === id) || {}).name || id),
    nHours: rows.length,
    bands,
    calibration: Object.fromEntries(THRESHOLDS.map(th => [th, cal[th] && {
      knots: cal[th].knots, values: cal[th].values, baseRate: cal[th].baseRate, bins: cal[th].bins }])),
    calibrationLogistic: Object.fromEntries(THRESHOLDS.map(th => [th, calLog[th]])),
    season,
    verify,
    fullIngredients: fullVerify,
    contrast: wetContrast(foldRows, E.quantile(foldRows.map(r => r.risk).filter(finite), 0.8)),
  };
  perLoc.push([loc.id, bands, verify, season, locations[loc.id].contrast]);
  const s5 = verify[5].frozenTest || {};
  console.log(`  ${loc.id.padEnd(9)} ${ids.length} mô hình · CAPE p50 ${bands.p50.toFixed(2)} p95 ${bands.p95.toFixed(2)}`
    + ` | tập chấm: BSS ${s5.bss ?? '—'} n=${s5.events ?? 0} | năm: BSS ${verify[5].rollingYear.bss} ρ=${verify[5].rollingYear.spearman}`
    + ` | mưa ở nhóm cao ${locations[loc.id].contrast.high.rate} so ${locations[loc.id].contrast.low.rate}`);
}

/* ----- Tổng hợp ----- */
function med(vals) {
  const v = vals.filter(x => finite(x));
  return v.length ? E.round(E.quantile(v, 0.5), 4) : null;
}
const locs = Object.values(locations);

const summary = {};
for (const th of THRESHOLDS) {
  const fr = locs.map(l => l.verify[th].frozenTest).filter(v => v && !v.insufficient);
  const ry = locs.map(l => l.verify[th].rollingYear).filter(v => v && !v.insufficient);
  summary[th] = {
    locationsScored: fr.length,
    medianBssFrozenTest: med(fr.map(v => v.bss)),
    medianBssRollingYear: med(ry.map(v => v.bss)),
    medianSpearmanRollingYear: med(ry.map(v => v.spearman)),
    medianHitRate: med(fr.map(v => v.hitRate)),
    medianFalseAlarmRate: med(fr.map(v => v.falseAlarmRate)),
  };
}

// Gộp cả 8 địa điểm, gấp đo lần trên toàn bộ mảng ghép.
{
  const rows = [];
  for (const locId of Object.keys(locations)) {
    const loc = LOCATIONS.find(l => l.id === locId);
    const truth = loadTruth(loc);
    const ens = ensembleMean(loadIndex(loc, truth.time), truth.time.length);
    for (let i = 0; i < truth.time.length; i++) {
      if (!finite(ens[i]) || !finite(truth.precip[i])) continue;
      rows.push({ x: ens[i], obs: truth.precip[i], t: truth.time[i], test: inTest(truth.time[i]) });
    }
  }
  const foldRows = [];
  for (const f of rollingFolds(rows.length)) {
    const slice = rows.slice(f.train[0], f.train[1]);
    const c = E.isotonicCalibrate(slice.map(r => r.x), slice.map(r => (r.obs >= 5 ? 1 : 0)));
    if (!c) continue;
    for (let i = f.test[0]; i < f.test[1]; i++) foldRows.push({ risk: E.applyIsotonic(c, [rows[i].x])[0], obs: rows[i].obs });
  }
  for (const th of THRESHOLDS) {
    const trn = rows.filter(r => !r.test);
    const c = E.isotonicCalibrate(trn.map(r => r.x), trn.map(r => (r.obs >= th ? 1 : 0)));
    summary[th].pooledRollingYear = E.lightningVerify(foldRows, th);
    summary[th].pooledFrozenTest = E.lightningVerify(
      rows.filter(r => r.test).map(r => ({ risk: c ? E.applyIsotonic(c, [r.x])[0] : null, obs: r.obs })), th);
  }
}

const medianContrastFull = {
  highRate: med(locs.map(l => l.fullIngredients && l.fullIngredients.contrast.high.rate)),
  lowRate: med(locs.map(l => l.fullIngredients && l.fullIngredients.contrast.low.rate)),
  ratio: med(locs.map(l => l.fullIngredients && l.fullIngredients.contrast.ratio)),
  bss: med(locs.map(l => l.fullIngredients && l.fullIngredients.verify && l.fullIngredients.verify.bss)),
  models: locs.length ? locs[0].fullIngredients && locs[0].fullIngredients.models : [],
};

const medianContrast = {
  highRate: med(locs.map(l => l.contrast.high.rate)),
  lowRate: med(locs.map(l => l.contrast.low.rate)),
  ratio: med(locs.map(l => l.contrast.ratio)),
  locationsWithGain: locs.filter(l => (l.contrast.high.rate || 0) > (l.contrast.low.rate || 0)).length,
  locationsTotal: locs.length,
};

const seasonSummary = {};
for (const key of Object.keys(SEASONS)) {
  seasonSummary[key] = {
    name: SEASONS[key].name,
    medianSpearman: med(locs.map(l => l.season[key].spearman)),
    medianBss: med(locs.map(l => l.season[key].bss)),
    minSpearman: locs.length ? Math.min(...locs.map(l => finite(l.season[key].spearman) ? l.season[key].spearman : 1)) : null,
    maxSpearman: locs.length ? Math.max(...locs.map(l => finite(l.season[key].spearman) ? l.season[key].spearman : -1)) : null,
  };
}

const report = {
  generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
  period: PERIOD,
  split: SPLIT,
  definition: {
    name: 'Chỉ số nguy cơ bão tố và động sét',
    formula: 'trung bình nhân có trọng số: √(CAPE/2500)^0,6 · ((4−LI)/10)^0,25 · (1−CIN/200)^0,15, trọng số chuẩn hoá theo thành phần mô hình có',
    weights: { cape: 0.6, lifted_index: 0.25, convective_inhibition: 0.15 },
    caps: { capeRef: E.CAPE_REF, liLo: E.LI_LO, liHi: E.LI_HI, cinMax: E.CIN_MAX },
    calibration: 'logistic một biến, chỉ trên tập huấn luyện trước 2025-10-14',
  },
  truth: 'Lượng mưa ERA5 cùng giờ. Không phải số đo tia sét.',
  limits: [
    'Có biến tên `lightning_potential` và `thunderstorm_probability` nhưng đo ở cả 7 mô hình và cả 8 địa điểm đều trả null: không có dữ liệu động sét nào từ nguồn mở. Đây là chỉ số năng lượng đối lưu, không phải dự báo sét.',
    'Kho previous-runs không phục vụ CAPE/LI/CIN theo độ trễ, nên chỉ số này KHÔNG được chấm lead-N như 16 biến còn lại; phép đo là khả năng phân biệt tại giờ hiệu lực.',
    'ERA5 là phân tích lại trên lưới ~31 km và làm mượt đỉnh mưa đối lưu: cao nhất ghi nhận ở TP.HCM là 9,2 mm/giờ. Sự kiện "mưa mạnh" ở đây vì thế bị chặn trên, và chỉ số có thể đánh giá thấp cường độ thật của bão.',
    'Quan hệ CAPE–mưa đổi theo mùa: mạnh ở gió mùa đông bờ biển trung và nam, yếu hoặc âm ở Hà Nội mùa Tây Nam. Xem mục `season`.',
    'CIN chỉ có ở GFS và UKMO, LI chỉ ở GFS, CAPE thiếu ở JMA: mỗi mô hình dùng bộ thành phần khác nhau, chuẩn hoá trọng số xử lý nhưng không làm chúng hoàn toàn tương đương.',
  ],
  coverage: {
    cape: ['gfs_global', 'ecmwf_ifs025', 'icon_global', 'gem_seamless', 'meteofrance_seamless', 'ukmo_seamless'],
    lifted_index: ['gfs_global'],
    convective_inhibition: ['gfs_global', 'ukmo_seamless'],
    none: ['jma_seamless'],
  },
  thresholds: THRESHOLDS,
  levels: E.LIGHTNING_LEVELS,
  summary,
  medianContrast,
  medianContrastFull,
  seasonSummary,
  locations,
};

fs.writeFileSync(path.join(DIST, 'lightning.json'), JSON.stringify(report));
console.log(`\nđã ghi dist/lightning.json (${(JSON.stringify(report).length / 1024).toFixed(0)} KB)`);
console.log('\nĐịa điểm  CAPE p50  p95   | BSS tập chấm  BSS cả năm   ρ      | mưa nhóm cao / thấp');
for (const [id, bands, verify] of perLoc) {
  const s5 = verify[5].frozenTest || {}, ry = verify[5].rollingYear || {};
  console.log(`  ${id.padEnd(9)} ${bands.p50.toFixed(2)}   ${bands.p95.toFixed(2)}  |`
    + ` ${String(s5.bss ?? '—').padStart(8)}  ${String(ry.bss ?? '—').padStart(8)}  ${String(ry.spearman ?? '—').padStart(6)}`
    + `  | ${locations[id].contrast.high.rate} / ${locations[id].contrast.low.rate}  (×${locations[id].contrast.ratio})`);
}
console.log('\nTheo mùa (trung vị 8 địa điểm):');
for (const [k, v] of Object.entries(seasonSummary)) {
  console.log(`  ${v.name.padEnd(26)} ρ ${String(v.medianSpearman).padStart(7)}  (thấp nhất ${v.minSpearman}, cao nhất ${v.maxSpearman})`);
}
console.log(`\nGộp cả 8 địa điểm, gấp đo lần, ngưỡng 5 mm: BSS ${summary[5].pooledRollingYear.bss}`
  + ` · ρ ${summary[5].pooledRollingYear.spearman} · n ${summary[5].pooledRollingYear.n}`);
console.log(`Tập chấm đóng băng, ngưỡng 5 mm: BSS ${summary[5].pooledFrozenTest.bss} · n ${summary[5].pooledFrozenTest.n}`
  + ` · sự kiện ${summary[5].pooledFrozenTest.events}`);