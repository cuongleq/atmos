// Thu thap ban tin chinh thuc NCHMF phia server (trinh duyet khong doc truc
// tiep duoc do NCHMF khong mo CORS va khong co API JSON). Chay truoc build.mjs.
// Khong bao gio lam hong build: loi mang chi ghi nhan trang thai, khong throw.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');

// Cac chuyen muc co ban tin ngay. Trang danh muc render san ban tin moi nhat.
const CATEGORIES = [
  { id: 'datlien', label: 'Thời tiết đất liền 24h', url: 'https://nchmf.gov.vn/kttvsite/vi-VN/1/thoi-tiet-dat-lien-24h-12h2-15.html', kind: 'routine' },
  { id: 'bien', label: 'Thời tiết biển 24h', url: 'https://nchmf.gov.vn/kttvsite/vi-VN/1/thoi-tiet-bien-24h-s12h3-15.html', kind: 'routine' },
  { id: 'muoi-ngay', label: 'Thời tiết 10 ngày tới', url: 'https://nchmf.gov.vn/kttvsite/vi-VN/1/thoi-tiet-10-ngay-toi-4-15.html', kind: 'routine' },
  { id: 'bao', label: 'Bão / áp thấp nhiệt đới', url: 'https://nchmf.gov.vn/kttvsite/vi-VN/1/bao-ap-thap-nhiet-doi-2049-15.html', kind: 'storm' },
  { id: 'mualon', label: 'Mưa lớn diện rộng', url: 'https://nchmf.gov.vn/kttvsite/vi-VN/1/mua-lon-mua-lon-dien-rong-2053-15.html', kind: 'rain' },
  { id: 'nguyhiem', label: 'Thời tiết nguy hiểm', url: 'https://nchmf.gov.vn/kttvsite/vi-VN/1/thoi-tiet-nguy-hiem-5-15.html', kind: 'hazard' },
  { id: 'kkhlanh', label: 'Không khí lạnh', url: 'https://nchmf.gov.vn/kttvsite/vi-VN/1/khong-khi-lanh-2050-15.html', kind: 'cold' },
  { id: 'nangnong', label: 'Nắng nóng', url: 'https://nchmf.gov.vn/kttvsite/vi-VN/1/nang-nong-2051-15.html', kind: 'heat' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();

const isoOf = (d, m, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
// Cac mau ngay trong ban tin: "07/10/2026", "( 07/10/2026 03:30 )", "Ngày và đêm 07/10/2026"
function findDates(text) {
  const out = [];
  for (const m of text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/g)) {
    out.push({ iso: isoOf(m[1], m[2], m[3]), time: m[4] ? `${m[4]}:${m[5]}` : null, raw: m[0] });
  }
  return out;
}

// Trich cac dong "TIN ... ( DD/MM/YYYY HH:MM )" — dinh dang canh bao cua NCHMF.
function findWarnings(text) {
  const out = [];
  for (const m of text.matchAll(/TIN\s[^()]{8,160}?\(\s*(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\d{1,2}:\d{2}))?\s*\)/gi)) {
    const title = m[0].replace(/\s+/g, ' ').trim().slice(0, 220);
    const [d, mo, y] = m[1].split('/');
    out.push({ title, iso: isoOf(d, mo, y), time: m[2] || null });
  }
  return out;
}

function levelOf(text, kind) {
  const T = text.toUpperCase();
  if (/BÃO|ÁP THẤP/.test(T)) return 'red';
  if (/LŨ QUÉT|LŨ |SẠT LỞ/.test(T)) return 'red';
  if (/MƯA LỚN|MƯA DÔNG|LỐC|GIÓ GIẬT/.test(T)) return kind === 'rain' ? 'red' : 'orange';
  if (/KHÔNG KHÍ LẠNH|RÉT|NẮNG NÓNG/.test(T)) return 'orange';
  return 'info';
}

const todayIso = new Date().toISOString().slice(0, 10);
const freshDays = 3;
const isFresh = iso => {
  const days = (Date.parse(todayIso) - Date.parse(iso)) / 86400000;
  return days >= -1 && days <= freshDays;
};

const report = {
  collectedAt: new Date().toISOString(),
  source: 'Trung tâm Dự báo KTTV Quốc gia (NCHMF) — thu thập tự động phía server, hiển thị nguyên văn tiêu đề và trích đoạn. NCHMF không có API mở/JSON nên không thể lấy số liệu định lượng để trộn vào mô hình số.',
  note: 'Mức cảnh báo do ứng dụng suy ra từ từ khóa tiêu đề + độ tươi của bản tin; luôn đọc bản tin gốc trước khi ra quyết định.',
  categories: [],
  errors: [],
};

for (const cat of CATEGORIES) {
  try {
    const r = await fetch(cat.url, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const h1m = html.match(/<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i);
    const h1 = (h1m?.[1] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    const idx = h1m?.index ?? 0;
    const body = strip(html.slice(Math.max(0, idx), idx + 15000)).slice(0, 1600);
    const dates = findDates(h1 + ' ' + body.slice(0, 400));
    const docIso = dates.length ? dates[0].iso : null;
    const warnings = findWarnings(body).map(w => ({
      ...w,
      fresh: isFresh(w.iso),
      level: levelOf(w.title, cat.kind),
    }));
    const freshWarn = warnings.filter(w => w.fresh);
    report.categories.push({
      id: cat.id, label: cat.label, url: cat.url,
      title: h1 || cat.label, docIso, fresh: docIso ? isFresh(docIso) : false,
      level: freshWarn.length ? freshWarn[0].level : (docIso && isFresh(docIso) ? (cat.kind === 'storm' || cat.kind === 'rain' ? 'orange' : 'info') : 'stale'),
      excerpt: body.slice(0, 500),
      warnings: warnings.slice(0, 6),
      freshWarnings: freshWarn.length,
    });
    console.log(`${cat.id}: "${h1.slice(0, 60)}" date=${docIso} warnings=${warnings.length} fresh=${freshWarn.length}`);
  } catch (e) {
    report.errors.push(`${cat.id}: ${e.message}`);
    console.log(`${cat.id} FAILED: ${e.message}`);
  }
  await sleep(1500);
}

await fs.mkdir(DIST, { recursive: true });
await fs.writeFile(path.join(DIST, 'nchmf.json'), JSON.stringify(report));
console.log(`\nXong. ${report.categories.length} chuyên mục, lỗi ${report.errors.length}.`);
