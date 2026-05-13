/* =============================================
   TICKER DASHBOARD — script.js
   ============================================= */

'use strict';

// ── Constants ──────────────────────────────────

const STORAGE_KEY  = 'tickerboard_tickers';
const MAX_TICKERS  = 10;
const UPDATE_MIN   = 3000;   // ms
const UPDATE_MAX   = 5000;   // ms

// ── Shared helpers ─────────────────────────────

function getTickers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTickers(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function getLayoutClass(count) {
  if (count <= 0)  return 'layout-0';
  if (count === 1) return 'layout-1';
  if (count <= 4)  return 'layout-' + count;   // 2-4 → 2×2
  if (count <= 6)  return 'layout-' + count;   // 5-6 → 3×2
  return 'layout-' + count;                     // 7-10 → 5×2
}

// ── Price simulation state ─────────────────────

const priceState = {}; // { SYMBOL: { price, change, volume } }

function initPrice(symbol) {
  if (priceState[symbol]) return;
  const base = +(100 + Math.random() * 900).toFixed(2);
  priceState[symbol] = {
    price:  base,
    change: +(Math.random() * 4 - 2).toFixed(2),
    volume: +(Math.random() * 80 + 20).toFixed(0),
  };
}

function tickPrice(symbol) {
  const s = priceState[symbol];
  if (!s) return;
  const prevChange = s.change;
  // Random walk
  const delta = +(Math.random() * 2.4 - 1.2).toFixed(2);
  s.change = +(prevChange + delta * 0.35).toFixed(2);
  s.change = Math.max(-9.99, Math.min(9.99, s.change));
  s.price  = +(s.price * (1 + delta / 100)).toFixed(2);
  s.price  = Math.max(0.01, s.price);
  s.volume = +(Math.random() * 80 + 20).toFixed(0);
  return { prev: prevChange, curr: s.change };
}

function formatPrice(price) {
  if (price >= 1000) return price.toFixed(1);
  if (price >= 100)  return price.toFixed(2);
  return price.toFixed(2);
}

function formatChange(change) {
  const sign = change >= 0 ? '+' : '';
  return sign + change.toFixed(2) + '%';
}

function getDirection(s) {
  if (s.change > 0) return 'positive';
  if (s.change < 0) return 'negative';
  return 'neutral';
}

// ── Arrow symbol ───────────────────────────────

function arrowFor(dir) {
  if (dir === 'positive') return '▲';
  if (dir === 'negative') return '▼';
  return '●';
}

/* ==============================================
   DISPLAY SCREEN
   ============================================== */

let displayInterval = null;

function initDisplayScreen() {
  renderDisplay();
  startClock();

  // Listen for admin changes
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      renderDisplay();
    }
  });
}

function renderDisplay() {
  const tickers = getTickers();
  const grid    = document.getElementById('ticker-grid');
  const empty   = document.getElementById('empty-state');

  // Clear old interval
  if (displayInterval) {
    clearInterval(displayInterval);
    displayInterval = null;
  }

  if (!tickers.length) {
    grid.innerHTML  = '';
    grid.className  = 'ticker-grid';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';

  const layoutClass = getLayoutClass(tickers.length);
  grid.className = 'ticker-grid ' + layoutClass;

  // Init prices for new symbols
  tickers.forEach(initPrice);

  // Remove orphan price states
  Object.keys(priceState).forEach(sym => {
    if (!tickers.includes(sym)) delete priceState[sym];
  });

  // Build cards
  grid.innerHTML = tickers.map(sym => buildCard(sym, layoutClass)).join('');

  // Start simulation
  scheduleNextTick();
}

function buildCard(sym, layoutClass) {
  const s   = priceState[sym];
  const dir = getDirection(s);
  return `
    <div class="ticker-card ${dir}" id="card-${sym}">
      <div class="ticker-flash-overlay"></div>
      <div class="ticker-name">${sym}</div>
      <div class="ticker-price">$${formatPrice(s.price)}</div>
      <div class="ticker-change">
        <span class="arrow">${arrowFor(dir)}</span>
        ${formatChange(s.change)}
      </div>
      <div class="ticker-vol-bar" style="width:${s.volume}%"></div>
    </div>
  `;
}

function updateCard(sym) {
  const card = document.getElementById('card-' + sym);
  if (!card) return;

  const dirs = tickPrice(sym);
  const s    = priceState[sym];
  const dir  = getDirection(s);

  card.className = 'ticker-card ' + dir;

  card.querySelector('.ticker-name').textContent  = sym;
  card.querySelector('.ticker-price').textContent = '$' + formatPrice(s.price);

  const chEl   = card.querySelector('.ticker-change');
  chEl.querySelector('.arrow').textContent = arrowFor(dir);
  chEl.lastChild.textContent = ' ' + formatChange(s.change);

  card.querySelector('.ticker-vol-bar').style.width = s.volume + '%';

  // Flash
  if (dirs) {
    const flashClass = dirs.curr >= dirs.prev ? 'flash-up' : 'flash-down';
    card.classList.add(flashClass);
    setTimeout(() => card.classList.remove(flashClass), 550);
  }
}

function scheduleNextTick() {
  const delay = UPDATE_MIN + Math.random() * (UPDATE_MAX - UPDATE_MIN);
  displayInterval = setTimeout(() => {
    const tickers = getTickers();
    if (!tickers.length) return;
    // Randomly update 1–3 cards per cycle
    const count  = Math.min(tickers.length, Math.ceil(Math.random() * 3));
    const chosen = [...tickers].sort(() => Math.random() - 0.5).slice(0, count);
    chosen.forEach(updateCard);
    scheduleNextTick();
  }, delay);
}

// ── Clock ──────────────────────────────────────

function startClock() {
  function tick() {
    const now   = new Date();
    const hh    = String(now.getHours()).padStart(2, '0');
    const mm    = String(now.getMinutes()).padStart(2, '0');
    const ss    = String(now.getSeconds()).padStart(2, '0');
    const el    = document.getElementById('live-clock');
    if (el) el.textContent = hh + ':' + mm + ':' + ss;
  }
  tick();
  setInterval(tick, 1000);
}

/* ==============================================
   ADMIN PANEL
   ============================================== */

let adminPreviewInterval = null;

function initAdminPanel() {
  renderAdminList();
  renderPreview();

  // Enter key on input
  const input = document.getElementById('ticker-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') adminAddTicker();
    });
  }

  // Listen for changes from other admin tabs
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      renderAdminList();
      renderPreview();
    }
  });

  startPreviewSimulation();
}

function adminAddTicker() {
  const input   = document.getElementById('ticker-input');
  const errEl   = document.getElementById('error-msg');
  const raw     = input.value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
  errEl.textContent = '';

  if (!raw) {
    errEl.textContent = 'Введите название тикера.';
    return;
  }

  const tickers = getTickers();

  if (tickers.length >= MAX_TICKERS) {
    errEl.textContent = 'Достигнут лимит: максимум 10 тикеров.';
    return;
  }

  if (tickers.includes(raw)) {
    errEl.textContent = `Тикер "${raw}" уже добавлен.`;
    return;
  }

  tickers.push(raw);
  saveTickers(tickers);
  input.value = '';
  renderAdminList();
  renderPreview();
}

function adminDeleteTicker(sym) {
  const tickers = getTickers().filter(t => t !== sym);
  saveTickers(tickers);
  renderAdminList();
  renderPreview();
}

function adminClearAll() {
  if (!confirm('Удалить все тикеры?')) return;
  saveTickers([]);
  renderAdminList();
  renderPreview();
}

function renderAdminList() {
  const tickers  = getTickers();
  const listEl   = document.getElementById('ticker-list');
  const countEl  = document.getElementById('ticker-count');

  if (countEl) countEl.textContent = tickers.length + ' / ' + MAX_TICKERS + ' тикеров';

  if (!listEl) return;

  if (!tickers.length) {
    listEl.innerHTML = '<div class="list-empty">Список пуст</div>';
    return;
  }

  listEl.innerHTML = tickers.map((sym, i) => `
    <div class="ticker-list-item">
      <div class="ticker-list-item-label">
        <span class="ticker-list-index">${i + 1}.</span>
        <span class="ticker-list-name">${sym}</span>
      </div>
      <button class="btn btn-delete" onclick="adminDeleteTicker('${sym}')">✕</button>
    </div>
  `).join('');
}

// ── Preview simulation ─────────────────────────

const previewState = {};

function initPreviewPrice(sym) {
  if (previewState[sym]) return;
  previewState[sym] = {
    change: +(Math.random() * 6 - 3).toFixed(2),
  };
}

function tickPreview(sym) {
  const s = previewState[sym];
  if (!s) return;
  const delta = +(Math.random() * 2 - 1).toFixed(2);
  s.change = +(s.change + delta * 0.3).toFixed(2);
  s.change = Math.max(-9.99, Math.min(9.99, s.change));
}

function getPreviewDir(sym) {
  const s = previewState[sym];
  if (!s) return 'neutral';
  if (s.change > 0) return 'positive';
  if (s.change < 0) return 'negative';
  return 'neutral';
}

function renderPreview() {
  const grid    = document.getElementById('grid-preview');
  if (!grid) return;
  const tickers = getTickers();

  if (!tickers.length) {
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gridTemplateRows    = '1fr';
    grid.innerHTML = '<div class="preview-cell neutral" style="font-size:0.75rem;opacity:0.4;">Нет тикеров</div>';
    return;
  }

  // Set grid columns/rows
  let cols, rows;
  const n = tickers.length;
  if (n === 1)       { cols = 1; rows = 1; }
  else if (n <= 4)   { cols = 2; rows = 2; }
  else if (n <= 6)   { cols = 3; rows = 2; }
  else               { cols = 5; rows = 2; }

  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;

  tickers.forEach(initPreviewPrice);

  grid.innerHTML = tickers.map(sym => {
    const dir = getPreviewDir(sym);
    return `<div class="preview-cell ${dir}" id="prev-${sym}">${sym}</div>`;
  }).join('');
}

function startPreviewSimulation() {
  if (adminPreviewInterval) clearInterval(adminPreviewInterval);
  adminPreviewInterval = setInterval(() => {
    const tickers = getTickers();
    tickers.forEach(sym => {
      tickPreview(sym);
      const cell = document.getElementById('prev-' + sym);
      if (cell) {
        const dir = getPreviewDir(sym);
        cell.className = 'preview-cell ' + dir;
      }
    });
  }, 2000);
}
