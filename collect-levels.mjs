/*
 * Thu thap du lieu muc ap luc (850/500 hPa) cho 8 dia diem de kiem chung
 * lop "khoi khi lanh/nong".
 *
 * Vai tro:
 *   - ERA5 (tai phan tich) cho chuan khi hau va do doi chinh xac cua
 *     nhung gi bien can do (nhiet do 850 hPa, do day cot).
 *   - Previous runs (du bao phat hanh truoc) cho phep do sai so thuc te cua
 *     du bao o cac moc 1/2/3/5/7 ngay, dung chung khuong cach ly 7 ngay voi
 *     phan du bao 16 bien hien tai.
 *
 * Khong sua gi vao dist/ hay benchmark.json. Script nay chi ghi vao raw/ (co
 * trong .gitignore) va in ra bao cao de dung cho viec danh gia.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCATIONS, RAW } from './config.mjs';

const LEVEL_VARS = [
  'temperature_850hPa', 'geopotential_height_850hPa', 'geopotential_height_500hPa',
  'wind_speed_850hPa', 'wind_direction_850hPa', 'relative_humidity_850hPa',
];
const MODELS = [
  'gfs_global', 'ecmwf_ifs025', 'icon_global', 'jma_seamless',
  'gem_seamless', 'meteofrance_seamless', 'ukmo_seamless',
];
const LEADS = [1, 2, 3, 5, 7];
const START = '2024-12-01';
const END = '2025-11-30';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const INTERVAL_MS = Number(flag('interval', 30000));
const MAX_WAITS = Number(flag('max-rate-waits', 60));

fs.mkdirSync(RAW, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let rateWaits = 0;

async function getJson(url, file) {
  const dest = path.join(RAW, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 500) return { cached: true };
  for (let attempt = 0; attempt < 8; attempt++) {
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(90000) });
    } catch (e) {
      console.log(`  loi mang (${e.message.slice(0, 60)}) - thu lai`);
      await sleep(INTERVAL_MS);
      continue;
    }
    if (r.status === 429 || r.status === 503) {
      rateWaits++;
      const back = Math.min(480, 30 * 2 ** Math.min(6, rateWaits)) * 1000;
      console.log(`  [${r.status}] cho toi ${Math.round(back / 1000)}s`);
      await sleep(back);
      continue;
    }
    if (r.status === 400) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.reason || 'HTTP 400');
    }
    if (!r.ok) { console.log(`  HTTP ${r.status} - thu lai`); await sleep(INTERVAL_MS); continue; }
    const j = await r.json();
    fs.writeFileSync(dest, JSON.stringify(j));
    return { ok: true, hours: (j.hourly?.time || []).length };
  }
  return { ok: false };
}

function summary(loc) {
  const rows = [];
  for (const m of MODELS) {
    const f = path.join(RAW, `levels-${loc.id}-${m}.json`);
    if (!fs.existsSync(f)) { rows.push(`    ${m.padEnd(20)} chua co`); continue; }
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const h = j.hourly || {};
    const good = LEVEL_VARS.every(v => (h[v] || []).some(Number.isFinite));
    rows.push(`    ${m.padEnd(20)} ${good ? 'du' : 'thieu bien'} · ${(h.time || []).length} gio`);
  }
  console.log(`  ${loc.name}\n${rows.join('\n')}`);
}

console.log('Thu thap du lieu muc ap luc — khoi khi lanh/nong');
console.log(`Ky ${START} → ${END} · ${MODELS.length} mo hinh × ${LOCATIONS.length} dia diem · gian doi lan ${Math.round(INTERVAL_MS / 1000)}s\n`);

for (const loc of LOCATIONS) {
  console.log(`${loc.name} (${loc.lat}, ${loc.lon})`);

  // 1) Chuan khi hau: ERA5 cho mot nam, dung de biet "lanh so voi chuan".
  const eraUrl = 'https://archive-api.open-meteo.com/v1/archive?' + new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon,
    start_date: START, end_date: END,
    hourly: LEVEL_VARS.join(','), timezone: 'auto',
  });
  console.log('  ERA5 (tai phan tich)...');
  console.log('   ', await getJson(eraUrl, `levels-era5-${loc.id}.json`));

  // 2) Du bao phat hanh truoc: mot ban cho moi moc truoc do.
  for (const m of MODELS) {
    for (const lead of LEADS) {
      const url = 'https://previous-runs-api.open-meteo.com/v1/forecast?' + new URLSearchParams({
        latitude: loc.lat, longitude: loc.lon,
        start_date: START, end_date: END,
        hourly: LEVEL_VARS.join(','),
        models: m,
        previous_days: lead,
        timezone: 'auto',
      });
      const file = `levels-${loc.id}-${m}-d${lead}.json`;
      const r = await getJson(url, file);
      const tag = r.cached ? 'da co' : r.ok ? `${r.hours} gio` : 'that bai';
      console.log(`    ${m.padEnd(20)} -${lead}d ${tag}`);
      if (!r.cached) await sleep(INTERVAL_MS);
      if (rateWaits > MAX_WAITS) {
        console.log('\nDa gap gioi han tan suat nhieu lan. Dung lai: node collect-levels.mjs');
        process.exit(0);
      }
    }
  }
  summary(loc);
}

console.log('\nXong. Du lieu nam trong raw/ (khong dua len git).');
console.log('Buoc tiep theo: mo rong cac kiem thu de do chinh xac cua lop khoi khi.');