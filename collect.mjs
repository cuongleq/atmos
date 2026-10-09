// Downloads the verification corpus into raw/. Idempotent: an existing file is
// reused unless --force is passed. Requests run through a small worker pool
// because each response is a few megabytes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RAW, LOCATIONS, DET_MODELS, VARIABLES, LEADS, PERIOD, API,
} from './config.mjs';

const force = process.argv.includes('--force');
const flag = name => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const concurrency = Number(flag('-j')) || 2;
// The archive serves exactly the requested window, hour by hour, so a cached
// file is valid when it starts no later than PERIOD.start and reaches
// PERIOD.end. Comparing an hour *count* against the span is brittle: an
// off-by-N tolerance either re-downloads good data (burning the daily quota)
// or accepts a truncated file.
const windowStart = PERIOD.start + 'T00:00';
const windowEnd = PERIOD.end + 'T23:00';
const covers = json => {
  const t = json?.hourly?.time;
  return Array.isArray(t) && t.length > 1 && t[0] <= windowStart && t[t.length - 1] >= windowEnd;
};
const fields = VARIABLES.flatMap(v => LEADS.map(l => `${v}_previous_day${l}`));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Open-Meteo's free tier rejects bursts with "Hourly API request limit
// exceeded". Requests are therefore serialised through a shared gate, and a
// rejected request widens the interval instead of hammering the same limit.
const gate = { last: 0, interval: Number(flag('--interval')) || 12000, tail: Promise.resolve() };
async function throttle() {
  const run = async () => {
    const wait = gate.last + gate.interval - Date.now();
    if (wait > 0) await sleep(wait);
    gate.last = Date.now();
  };
  const next = gate.tail.then(run, run);
  gate.tail = next.catch(() => {});
  return next;
}
const RATE_LIMIT = /request limit|too many requests|429/i;

async function cached(file, build) {
  const target = path.join(RAW, file);
  if (!force) {
    try {
      const json = JSON.parse(await fs.readFile(target, 'utf8'));
      if (covers(json)) return { json, cached: true };
      // Stale period. Leave the file in place: it is only replaced once a
      // fresh download succeeds, so a rate limit never destroys working data.
    } catch { /* fall through and download */ }
  }
  /*
 * Rate-limit rejections are treated as "not yet", not as failure: the free
 * Open-Meteo tier allows only a handful of large requests per hour, so the loop
 * keeps waiting and the run resumes from the cache. Any other error still gets a
 * bounded number of retries before it is reported.
 */
const RATE_RETRY_CAP = Number(flag('--max-rate-waits')) || 40;
let rateWaits = 0;

let last;
for (let attempt = 0; attempt < 8; attempt++) {
  await throttle();
  try {
    const r = await fetch(build(), { signal: AbortSignal.timeout(240000) });
    const json = JSON.parse(await r.text());
    if (json.error) throw new Error(json.reason || `HTTP ${r.status}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!json.hourly || !json.hourly.time?.length) throw new Error('không có khối hourly');
    await fs.writeFile(target, JSON.stringify(json));
    gate.interval = Math.max(8000, gate.interval * 0.85);   // relax slowly on success
    rateWaits = 0;
    return { json, cached: false };
  } catch (e) {
    last = e;
    if (RATE_LIMIT.test(e.message)) {
      rateWaits++;
      if (rateWaits > RATE_RETRY_CAP) throw new Error(`còn giới hạn tần suất sau ${rateWaits} lần chờ`);
      gate.interval = Math.min(240000, gate.interval * 1.5);
      const wait = Math.min(600000, gate.interval * 2);
      console.log(`  [${file}] giới hạn tần suất (lần ${rateWaits}), chờ ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;                     // do not consume the normal retry budget
    }
    await sleep(3000 * 2 ** attempt + Math.random() * 2000);
  }
}
throw new Error(`${last.message} (sau 8 lần thử)`);
}

// `--locations a,b` and `--models c,d` narrow the run so a single missing
// series can be topped up without re-walking the whole corpus.
const onlyLocations = (flag('--locations') || '').split(',').map(s => s.trim()).filter(Boolean);
const onlyModels = (flag('--models') || '').split(',').map(s => s.trim()).filter(Boolean);
const useLocation = id => !onlyLocations.length || onlyLocations.includes(id);
const useModel = id => !onlyModels.length || onlyModels.includes(id);

const jobs = [];
for (const loc of LOCATIONS.filter(l => useLocation(l.id))) {
  const geo = { latitude: loc.lat, longitude: loc.lon, start_date: PERIOD.start, end_date: PERIOD.end, timezone: 'GMT' };
  jobs.push({
    file: `${loc.id}-era5.json`,
    label: `ERA5 ${loc.id}`,
    url: `${API.archive}?${new URLSearchParams({ ...geo, hourly: VARIABLES.join(','), models: 'era5' })}`,
  });
  for (const model of DET_MODELS.filter(m => useModel(m.id))) {
    jobs.push({
      file: `${loc.id}-${model.id}.json`,
      label: `${model.id} ${loc.id}`,
      url: `${API.previous}?${new URLSearchParams({ ...geo, hourly: fields.join(','), models: model.id })}`,
    });
  }
}

await fs.mkdir(RAW, { recursive: true });
console.log(`${jobs.length} requests, concurrency ${concurrency}, ${fields.length} fields each`);

let cursor = 0, done = 0, failed = 0, bytes = 0;
const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    try {
      const { json, cached: hit } = await cached(job.file, () => job.url);
      bytes += (json.hourly.time?.length ?? 0);
      done++;
      console.log(`[${String(done).padStart(2)}/${jobs.length}] ${hit ? 'cached ' : 'fetched'} ${job.label} — ${json.hourly.time.length} h`);
    } catch (e) {
      failed++;
      console.error(`[FAILED] ${job.label}: ${e.message}`);
    }
  }
}));

const minutes = ((Date.now() - started) / 60000).toFixed(1);
console.log(`\nDone. ${done} ok, ${failed} failed, ${(bytes / 1000).toFixed(0)}k hourly samples in ${minutes} min.`);
if (failed) process.exitCode = 1;
