/**
 * ATMOS App - NCHMF News
 * Vietnam National Center for Hydro-Meteorological Forecasting
 */

import { selectors } from '../state/index.js';
import { $, fmt, esc, dateDM, timeHM } from '../helpers/index.js';

/** Render NCHMF news from embedded data */
export function renderNchmf(): void {
  const live = selectors.currentLive();
  const wrapper = document.getElementById('nchmfSectionWrapper');
  const listEl = document.getElementById('nchmfList');
  const metaEl = document.getElementById('nchmfMeta');
  const btn = document.getElementById('btnReloadNews');
  
  if (!wrapper || !listEl || !metaEl) return;
  
  // Get NCHMF data from embedded JSON
  let nchmfData = { collectedAt: null, categories: [], errors: ['chua thu thap'] };
  try {
    const el = document.getElementById('nchmf-data');
    if (el) nchmfData = JSON.parse(el.textContent);
  } catch {}
  
  if (btn) {
    btn.onclick = () => { btn.textContent = 'Dang tai...'; renderNchmf(); };
  }
  
  const { collectedAt, categories, errors } = nchmfData;
  
  if (metaEl) {
    metaEl.textContent = collectedAt 
      ? 'Cap nhat: ' + new Date(collectedAt).toLocaleString('vi-VN') 
      : 'Chua co du lieu';
  }
  
  if (errors?.length && !collectedAt) {
    listEl.innerHTML = '<p class="muted">Khong the tai ban tin NCHMF: ' + errors.join(', ') + '. <button class="btn-ghost" onclick="renderNchmf()">Thu lai</button></p>';
    return;
  }
  
  if (!categories?.length) {
    listEl.innerHTML = '<p class="muted">Khong co ban tin nao.</p>';
    return;
  }
  
  let html = '';
  for (const cat of categories) {
    const { name, items } = cat;
    if (!items?.length) continue;
    
    html += '<div class="nchmf-category"><h4>' + esc(name) + '</h4><ul class="nchmf-list">';
    
    for (const item of items.slice(0, 10)) {
      const { title, url, published_at, severity } = item;
      const date = published_at ? new Date(published_at) : null;
      
      html += '<li class="nchmf-item' + (severity ? ' ' + severity : '') + '">';
      html += '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="nchmf-title">' + esc(title) + '</a>';
      if (date) {
        html += '<span class="nchmf-meta">' + dateDM(date) + ' ' + timeHM(date) + '</span>';
      }
      html += '</li>';
    }
    
    html += '</ul></div>';
  }
  
  listEl.innerHTML = html;
}

/** Filter news by category */
export function filterNews(filter: string): void {
  const nchmfWrapper = document.getElementById('nchmfSectionWrapper');
  const intlWrapper = document.getElementById('intlSectionWrapper');
  const buttons = document.querySelectorAll('.news-filter-btn');
  
  buttons.forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  
  switch (filter) {
    case 'vn':
      if (nchmfWrapper) nchmfWrapper.style.display = '';
      if (intlWrapper) intlWrapper.style.display = 'none';
      break;
    case 'intl':
      if (nchmfWrapper) nchmfWrapper.style.display = 'none';
      if (intlWrapper) intlWrapper.style.display = '';
      break;
    case 'alerts':
      if (nchmfWrapper) nchmfWrapper.style.display = '';
      if (intlWrapper) intlWrapper.style.display = 'none';
      // Could filter to only alerts
      break;
    default:
      if (nchmfWrapper) nchmfWrapper.style.display = '';
      if (intlWrapper) intlWrapper.style.display = '';
  }
}

// Make filterNews globally accessible
(window as any).filterNews = filterNews;