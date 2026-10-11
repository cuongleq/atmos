// Thu thập bản tin chính thức NCHMF phía server từ trang chủ và các chuyên mục
// (trình duyệt không đọc trực tiếp được do NCHMF không mở CORS và không có API JSON).
// Chạy trước build.mjs. Không bao giờ làm hỏng build: lỗi mạng chỉ ghi nhận trạng thái.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = h => (h || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();

const isoOf = (d, m, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function parseDateFromText(text) {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const d = String(m[1]).padStart(2, '0');
  const mo = String(m[2]).padStart(2, '0');
  const y = m[3];
  const iso = `${y}-${mo}-${d}`;
  const time = m[4] ? `${m[4]}:${m[5]}${m[6] ? ':' + m[6] : ''}` : null;
  return { iso, time, raw: m[0] };
}

function levelOf(title, kind) {
  const T = (title || '').toUpperCase();
  if (/BÃO|ÁP THẤP|LŨ QUÉT|SẠT LỞ|SỤT LÚN|LŨ TRÊN SÔNG/.test(T)) return 'red';
  if (/MƯA LỚN|MƯA DÔNG|GIÓ MẠNH|SÓNG LỚN|LỐC|SÉT|MƯA ĐÁ|GIÓ GIẬT|TRIỀU CƯỜNG/.test(T)) {
    return (kind === 'rain' || /ĐẶC BIỆT LỚN|KHẨN CẤP/.test(T)) ? 'red' : 'orange';
  }
  if (/KHÔNG KHÍ LẠNH|RÉT|NẮNG NÓNG/.test(T)) return 'orange';
  return 'info';
}

const todayIso = new Date().toISOString().slice(0, 10);
const isFresh = (iso, daysLimit = 3) => {
  if (!iso) return false;
  const days = (Date.parse(todayIso) - Date.parse(iso)) / 86400000;
  return days >= -1 && days <= daysLimit;
};

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

async function collectAll() {
  const report = {
    collectedAt: new Date().toISOString(),
    source: 'Trung tâm Dự báo Khí tượng Thủy văn Quốc gia (NCHMF) — https://nchmf.gov.vn',
    note: 'Bản tin cập nhật tự động từ trang chủ và các chuyên mục chính thức NCHMF. Bấm vào từng tiêu đề để đọc toàn văn trên website chính thống.',
    breaking: [],
    categories: [],
    errors: [],
  };

  // 1. Quét trang chủ NCHMF (nguồn cập nhật tin khẩn cấp nhanh nhất theo thời gian thực)
  try {
    const homeRes = await fetch('https://www.nchmf.gov.vn/', { signal: AbortSignal.timeout(35000) });
    if (homeRes.ok) {
      const html = await homeRes.text();
      const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const href = m[1];
        const text = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (/^(TIN|BẢN TIN|DỰ BÁO)/i.test(text) && text.length > 20) {
          const dt = parseDateFromText(text);
          const cleanTitle = text.replace(/\(\s*\d{1,2}\/\d{1,2}\/\d{4}[\s\d:]*\)\s*$/, '').trim();
          const fullUrl = href.startsWith('http') ? href : new URL(href, 'https://www.nchmf.gov.vn/').href;
          if (!report.breaking.some(b => b.title === cleanTitle || b.url === fullUrl)) {
            const iso = dt?.iso || null;
            report.breaking.push({
              title: cleanTitle,
              url: fullUrl,
              iso,
              time: dt?.time || null,
              level: levelOf(cleanTitle),
              fresh: isFresh(iso, 2),
            });
          }
        }
      }
    }
  } catch (e) {
    report.errors.push(`homepage: ${e.message}`);
  }

  // 2. Quét các chuyên mục NCHMF
  for (const cat of CATEGORIES) {
    try {
      const r = await fetch(cat.url, { signal: AbortSignal.timeout(35000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();

      const postLinks = [];
      const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let lm;
      while ((lm = linkRe.exec(html)) !== null) {
        const h = lm[1];
        const t = lm[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (h.includes('-post') && t.length > 20) {
          const dt = parseDateFromText(t);
          const cleanT = t.replace(/\(\s*\d{1,2}\/\d{1,2}\/\d{4}[\s\d:]*\)\s*$/, '').trim();
          const fUrl = h.startsWith('http') ? h : new URL(h, cat.url).href;
          if (!postLinks.some(p => p.url === fUrl)) {
            postLinks.push({
              title: cleanT,
              url: fUrl,
              iso: dt?.iso || null,
              time: dt?.time || null,
              level: levelOf(cleanT, cat.kind),
              fresh: isFresh(dt?.iso, 3),
            });
          }
        }
      }

      let title = '';
      let docIso = null;
      let excerpt = '';

      if (cat.id === 'datlien' || cat.id === 'bien') {
        const h1m = html.match(/<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i);
        const h1 = (h1m?.[1] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const idx = h1m?.index ?? 0;
        const body = strip(html.slice(Math.max(0, idx), idx + 15000)).slice(0, 1600);
        const dates = parseDateFromText(h1 + ' ' + body.slice(0, 400));
        title = h1 || cat.label;
        docIso = dates?.iso || null;
        excerpt = body.slice(0, 600);
      } else {
        if (postLinks.length > 0) {
          title = postLinks[0].title;
          docIso = postLinks[0].iso;
          excerpt = postLinks[0].title;
        } else {
          title = cat.label;
          excerpt = 'Đang cập nhật dữ liệu';
        }
      }

      for (const pl of postLinks) {
        if (pl.fresh && !report.breaking.some(b => b.title === pl.title || b.url === pl.url)) {
          report.breaking.push({ ...pl, category: cat.label });
        }
      }

      report.categories.push({
        id: cat.id,
        label: cat.label,
        url: cat.url,
        title: title || cat.label,
        docIso,
        fresh: isFresh(docIso, 3),
        level: postLinks.some(p => p.fresh && p.level === 'red') ? 'red' :
               postLinks.some(p => p.fresh && p.level === 'orange') ? 'orange' :
               (docIso && isFresh(docIso, 3) ? 'info' : 'stale'),
        excerpt,
        warnings: postLinks.slice(0, 8),
        freshWarnings: postLinks.filter(p => p.fresh).length,
      });
      console.log(`OK ${cat.id}: "${title.slice(0, 45)}" date=${docIso} posts=${postLinks.length}`);
    } catch (e) {
      report.errors.push(`${cat.id}: ${e.message}`);
      console.log(`FAIL ${cat.id}: ${e.message}`);
    }
    await sleep(800);
  }

  // Sắp xếp tin khẩn cấp: Đỏ trước, Cam tiếp theo, sau đó theo thời gian
  report.breaking.sort((a, b) => {
    if (a.level === 'red' && b.level !== 'red') return -1;
    if (b.level === 'red' && a.level !== 'red') return 1;
    if (a.level === 'orange' && b.level === 'info') return -1;
    if (b.level === 'orange' && a.level === 'info') return 1;
    return 0;
  });

  return report;
}

const report = await collectAll();
await fs.mkdir(DIST, { recursive: true });
await fs.writeFile(path.join(DIST, 'nchmf.json'), JSON.stringify(report, null, 2));
console.log(`\nXong. Đã lưu dist/nchmf.json: ${report.breaking.length} tin nóng, ${report.categories.length} chuyên mục, lỗi ${report.errors.length}.`);
