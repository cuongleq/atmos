import './dist/engine.js';
const E = globalThis.AtmosEngine;

const SPLIT = { trainEnd: '2025-10-14', testStart: '2025-10-22', purgeDays: 7 };
const r = E.rng(42);

const times = [], truth = [], models = {};
for (let i = 0; i < 6; i++) models['m' + i] = [];
for (let d = 0; d < 420; d++) {
  for (let h = 0; h < 24; h++) {
    times.push(new Date(Date.UTC(2025, 0, 1) + (d * 24 + h) * 3600000).toISOString().slice(0, 16));
    const seasonal = 26 * Math.sin(2 * Math.PI * d / 365.25);
    const diurnal = 5 * Math.sin(2 * Math.PI * (h - 4) / 24);
    const base = seasonal + diurnal;
    const obs = base + (r() - 0.5) * 2;
    truth.push(obs);
    for (let i = 0; i < 6; i++) {
      const bias = (i - 3) * 0.25;
      const spread = 0.3 + i * 0.12;
      models['m' + i].push(obs + bias + (r() - 0.5) * 2 * spread);
    }
  }
}

const res = E.evaluate({
  times, obs: truth, series: models, variable: 'precipitation', lead: 1,
  modelNames: Object.fromEntries(Object.keys(models).map(k => [k, k])),
  utcOffset: 0, ...SPLIT,
});

console.log('Calibration family:', res.calibration.family);
console.log('Test hours:', res.testN);

const live = E.calibrate({
  times: times.slice(0, 48),
  variable: 'precipitation',
  series: { 'm0': models['m0'].slice(0, 48), 'm1': models['m1'].slice(0, 48), 'm2': models['m2'].slice(0, 48) },
  calib: res.calibration,
  utcOffset: 0,
});

console.log('\nFirst 6 hours of calibrated precipitation forecast:');
for (let i = 0; i < 6; i++) {
  const l = live[i];
  if (l) {
    const prob = l.probs ? (l.probs[1] * 100).toFixed(0) : 'N/A';
    console.log(`  Hour ${i}: median=${l.median.toFixed(1)}mm, p10=${l.p10.toFixed(1)}, p90=${l.p90.toFixed(1)}, prob>1mm=${prob}%`);
  }
}