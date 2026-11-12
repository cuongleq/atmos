import './dist/engine.js';
const E = globalThis.AtmosEngine;

const SPLIT = { trainEnd: '2025-10-14', testStart: '2025-10-22', purgeDays: 7 };

const r = E.rng(42);
const times = [];
const precip = [];
const wind = [];
for (let d = 0; d < 2; d++) {
  for (let h = 0; h < 24; h++) {
    times.push(new Date(Date.UTC(2025, 0, 1) + (d * 24 + h) * 3600000).toISOString().slice(0, 16));
    const base = 5 * Math.sin(2 * Math.PI * h / 24);
    precip.push(Math.max(0, base + (r() - 0.5) * 2));
    wind.push(Math.max(0, 10 + 5 * Math.sin(2 * Math.PI * (h - 13) / 24) + r() * 3));
  }
}

console.log('Sample hourly precipitation (mm):');
for (let i = 0; i < 6; i++) console.log(`  ${times[i]}: ${precip[i].toFixed(1)}`);

console.log('\nSample hourly wind (km/h):');
for (let i = 0; i < 6; i++) console.log(`  ${times[i]}: ${wind[i].toFixed(1)}`);

const daily = new Map();
for (let i = 0; i < times.length; i++) {
  const day = times[i].slice(0, 10);
  if (!daily.has(day)) daily.set(day, 0);
  daily.set(day, daily.get(day) + precip[i]);
}
console.log('\nDaily precipitation totals:');
for (const [day, total] of daily) console.log(`  ${day}: ${total.toFixed(1)} mm`);