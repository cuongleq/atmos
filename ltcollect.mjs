/**
 * Tải dữ liệu chỉ số bão tố cho tập kiểm chứng.
 *
 * CAPE, lifted index và CIN là sản phẩm của MÔ HÌNH, không có trong ERA5 —
 * đó là lý do phải lấy từ kho lưu trữ dự báo của chính các mô hình đó, đúng
 * khoảng thời gian và đúng địa điểm mà bộ kiểm thử đã dùng. Như vậy chỉ số
 * được chấm trên cùng tập chấm đã đóng băng, không phải một kỳ riêng.
 *
 * Phủ đo trước khi tải hàng loạt (8 địa điểm × 7 mô hình):
 *   cape                  6/7 mô hình (thiếu JMA), GEM thiếu 459 giờ
 *   lifted_index          1/7 (chỉ GFS)
 *   convective_inhibition 2/7 (GFS, UKMO)
 * Vì vậy công thức phải chịu được thiếu thành phần mà không làm sai lệch —
 * xem lightningIndex trong dist/engine.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RAW, PERIOD, DET_MODELS, LOCATIONS, API } from './config.mjs';

const FIELDS = 'cape,lifted_index,convective_inhibition';
const OUT = path.join(RAW, 'lt');

const only = process.argv.includes('--locations')
  ? process.argv[process.argv.indexOf('--locations') + 1].split(',')
  : null;
const onlyModels = process.argv.includes('--models')
  ? process.argv[process.argv.indexOf('--models') + 1].split(',')
  : null;

fs.mkdirSync(OUT, { recursive: true });

/** Kiểm tra tệp đã tải đúng phủ cả khoảng thời gian chưa. */
function covers(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
  const t = j.time;
  return Array.isArray(t) && t.length > 0
    && t[0].slice(0, 10) <= PERIOD.start && t[t.length - 1].slice(0, 10) >= PERIOD.end;
}

const todo = [];
for (const loc of LOCATIONS) {
  if (only && !only.includes(loc.id)) continue;
  for (const m of DET_MODELS) {
    if (onlyModels && !onlyModels.includes(m.id)) continue;
    const file = path.join(OUT, `${loc.id}-${m.id}.json`);
    todo.push({ loc, m, file, done: covers(file) });
  }
}

const need = todo.filter(t => !t.done);
console.log(`${todo.length} cặp địa điểm×mô hình · đã có ${todo.length - need.length} · cần tải ${need.length}`);
if (!need.length) process.exit(0);

let okCount = 0, failCount = 0;
const missing = [];

for (const t of need) {
  const u = new URLSearchParams({
    latitude: String(t.loc.lat), longitude: String(t.loc.lon),
    start_date: PERIOD.start, end_date: PERIOD.end,
    hourly: FIELDS, timezone: 'GMT', models: t.m.id,
  });
  let done = false;
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    try {
      const r = await fetch(API.archive + '?' + u, { signal: AbortSignal.timeout(120000) });
      const body = await r.text();
      if (!r.ok) {
        // Mô hình không phục vụ biến này là chuyện bình thường, không phải lỗi.
        if (r.status === 400) { done = true; missing.push(`${t.loc.id}/${t.m.id}`); break; }
        await new Promise(x => setTimeout(x, 2000 * (attempt + 1)));
        continue;
      }
      const h = JSON.parse(body).hourly;
      const count = k => (h[k] || []).filter(v => v != null).length;
      fs.writeFileSync(t.file, JSON.stringify({
        id: t.loc.id, model: t.m.id, time: h.time,
        cape: h.cape || [], lifted_index: h.lifted_index || [],
        convective_inhibition: h.convective_inhibition || [],
        n: { cape: count('cape'), lifted_index: count('lifted_index'), convective_inhibition: count('convective_inhibition') },
      }));
      okCount++; done = true;
      console.log(`  ${t.loc.id}/${t.m.id}: ${h.time.length} giờ · cape ${count('cape')} · LI ${count('lifted_index')} · CIN ${count('convective_inhibition')}`);
    } catch (e) {
      if (attempt === 3) { failCount++; console.log(`  ${t.loc.id}/${t.m.id}: LỖI ${e.message.slice(0, 50)}`); }
      else await new Promise(x => setTimeout(x, 2500 * (attempt + 1)));
    }
  }
  await new Promise(x => setTimeout(x, 250));
}

console.log(`xong: ${okCount} tệp · ${failCount} lỗi`);
if (missing.length) console.log(`mô hình không có biến này (đã ghi tệp rỗng): ${[...new Set(missing.map(m => m.split('/')[1]))].join(', ')}`);