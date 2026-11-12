import './dist/engine.js';
const E = globalThis.AtmosEngine;

const r = E.rng(41);
const nDays = 320, nModels = 5;
const times = [], obsSpeed = [], obsDir = [], models = {};
for (let i = 0; i < nModels; i++) models['m' + i] = { u: [], v: [], speed: [], dir: [] };
for (let d = 0; d < nDays; d++) {
  for (let h = 0; h < 24; h++) {
    times.push(new Date(Date.UTC(2025, 0, 1) + (d * 24 + h) * 3600000).toISOString().slice(0, 16));
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
  const res = E.evaluate({
    times, series: models, obsSpeed, obsDirection: obsDir,
    variable: 'wind_direction_10m', lead: 1, modelNames: {}, utcOffset: 0,
    trainEnd: '2025-08-01', testStart: '2025-09-01', purgeDays: 7,
  });
  console.log('usable:', res.usable);
  console.log('calibration keys:', Object.keys(res.calibration));
  console.log('calibration.u:', res.calibration.u ? 'exists' : 'undefined');
  console.log('calibration.v:', res.calibration.v ? 'exists' : 'undefined');
  if (res.calibration.u) console.log('u keys:', Object.keys(res.calibration.u));
  if (res.calibration.v) console.log('v keys:', Object.keys(res.calibration.v));