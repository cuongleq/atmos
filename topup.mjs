// Top-up driver: keeps asking Open-Meteo for the series still missing in raw/,
// then immediately re-runs the verification chain so the site ships a complete
// 8-location corpus. Safe to leave running: a rate-limit reply is treated as
// "not yet" and only the successful download is written to disk.
//
//   node topup.mjs                       # all missing series, chain runs after
//   node topup.mjs --locations nhatrang  # just one place
//   node topup.mjs --chain-only          # skip collecting, only re-run the chain
//   node topup.mjs --max-minutes 720     # give up after 12 h (default 18 h)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, RAW, LOCATIONS, DET_MODELS, PERIOD } from './config.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const list = name => (arg(name, '') || '').split(',').map(s => s.trim()).filter(Boolean);
const maxMinutes = Number(arg('--max-minutes', 1080));
const chainOnly = process.argv.includes('--chain-only');
const runBench = !process.argv.includes('--no-bench');

const wantedLocations = list('--locations');
const wantedModels = list('--models');
const keep = (id, sel) => !sel.length || sel.includes(id);

// Same acceptance rule as collect.mjs: the series must span the whole period.
const windowStart = PERIOD.start + 'T00:00';
const windowEnd = PERIOD.end + 'T23:00';

function have(file) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(RAW, file), 'utf8'));
    const t = json?.hourly?.time;
return Array.isArray(t) && t.length > 1 && t[0] <= windowStart && t[t.length - 1] >= windowEnd;
  } catch { return false; }
}

function missing() {
  const out = [];
  for (const loc of LOCATIONS.filter(l => keep(l.id, wantedLocations))) {
    if (!have(`${loc.id}-era5.json`)) out.push({ loc: loc.id, model: null });
    for (const m of DET_MODELS.filter(m => keep(m.id, wantedModels))) {
      if (!have(`${loc.id}-${m.id}.json`)) out.push({ loc: loc.id, model: m.id });
    }
  }
  return out;
}

function run(script, args = []) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit', cwd: ROOT });
    child.on('close', code => resolve(code ?? 1));
  });
}

const log = msg => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function collectRound() {
  const todo = missing();
  if (!todo.length) return true;
  const locations = [...new Set(todo.map(t => t.loc))].join(',');
  const models = [...new Set(todo.map(t => t.model).filter(Boolean))].join(',');
  const args = ['--locations', locations, '-j', '1', '--interval', '45000', '--max-rate-waits', '6'];
  if (models) args.push('--models', models);
  log(`còn thiếu ${todo.length} series (${locations} / ${models || 'era5'}) — thử tải`);
  const code = await run('collect.mjs', args);
  log(`collect.mjs xong với mã ${code}`);
  return code === 0 && missing().length === 0;
}

if (process.argv.includes('--list')) {
  const todo = missing();
  log(`thiếu ${todo.length} series: ${todo.map(t => `${t.loc}${t.model ? '/' + t.model : '/era5'}`).join(', ') || 'không có'}`);
  process.exit(0);
}

const deadline = Date.now() + maxMinutes * 60000;
let ready = chainOnly ? missing().length === 0 : false;

if (!chainOnly) {
  while (!ready) {
    if (Date.now() > deadline) {
      log('hết thời gian chờ quota — dừng vẫn giữ được mọi tệp đã tải');
      process.exit(2);
    }
    ready = await collectRound();
    if (!ready) await new Promise(r => setTimeout(r, 10 * 60000));   // nghỉ 10 phút rồi thử lại
  }
}

const left = missing();
if (left.length) log(`cảnh báo: vẫn thiếu ${left.length} series — chuỗi kiểm thử sẽ báo lỗi`);

if (runBench) {
  log('chạy bench.mjs');
  await run('bench.mjs');
}
log('ráp dist/index.html');
await run('build.mjs');
log('chạy test.mjs');
const code = await run('test.mjs');
log(`xong toàn bộ chuỗi (test exit=${code}), còn thiếu ${missing().length} series`);
process.exit(code);