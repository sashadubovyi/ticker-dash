/* ═══════════════════════════════════════════════
   TICKERBOARD v2  ·  script.js
   Polygon.io extended-hours data  +  Admin panel
   ═══════════════════════════════════════════════ */

'use strict';

/* ── Storage keys ──────────────────────────────── */
const KEY_TICKERS = 'tickerboard_tickers';
const KEY_APIKEY  = 'tickerboard_apikey';
const KEY_PRICES  = 'tickerboard_prices';   // shared price cache

const MAX_TICKERS    = 10;
const REFRESH_MS     = 60_000;              // poll every 60 s
const FALLBACK_MS    = 4_000;              // sim tick if no API key

/* ── Shared helpers ──────────────────────────── */

const store = {
  getTickers : ()       => { try { return JSON.parse(localStorage.getItem(KEY_TICKERS) || '[]'); } catch { return []; } },
  setTickers : (v)      => localStorage.setItem(KEY_TICKERS, JSON.stringify(v)),
  getApiKey  : ()       => localStorage.getItem(KEY_APIKEY) || '',
  setApiKey  : (v)      => localStorage.setItem(KEY_APIKEY, v.trim()),
  getPrices  : ()       => { try { return JSON.parse(localStorage.getItem(KEY_PRICES) || '{}'); } catch { return {}; } },
  setPrices  : (v)      => localStorage.setItem(KEY_PRICES, JSON.stringify(v)),
};

/* price shape:
   { price, prevClose, change, changePct, volume, session, ts }
*/

function calcDir(p) {
  if (!p || p.changePct == null) return 'neu';
  if (p.changePct >  0.001) return 'pos';
  if (p.changePct < -0.001) return 'neg';
  return 'neu';
}

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '—';
  return (+n).toFixed(dec);
}

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  n = +n;
  return n >= 1000 ? n.toFixed(1) : n.toFixed(2);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  const s = n >= 0 ? '+' : '';
  return s + n.toFixed(2) + '%';
}

function sessionLabel() {
  const h = new Date().getHours();
  if (h >= 4  && h < 9)  return 'PRE-MARKET';
  if (h >= 9  && h < 16) return 'MARKET OPEN';
  if (h >= 16 && h < 20) return 'AFTER-HOURS';
  return 'MARKET CLOSED';
}

/* ── Polygon.io fetch ────────────────────────── */

async function fetchTicker(sym, apiKey) {
  // Snapshot endpoint with extendedHours data
  const url =
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(sym)}` +
    `?apiKey=${apiKey}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();

  const t = data?.ticker;
  if (!t) throw new Error('No ticker data');

  // day values (regular session)
  const day       = t.day   || {};
  const prevDay   = t.prevDay || {};
  const lastTrade = t.lastTrade || {};
  const extHours  = t.extendedHours;   // may be undefined on free plan

  // prefer extended-hours price if available
  let price = extHours?.p ?? lastTrade.p ?? day.c ?? null;
  const prevClose = prevDay.c ?? day.o ?? null;

  // If extended-hours price not available, use closing price
  if (!price && day.c) price = day.c;

  const change    = (price != null && prevClose != null) ? price - prevClose : null;
  const changePct = (change != null && prevClose) ? (change / prevClose) * 100 : null;

  return {
    price,
    prevClose,
    change,
    changePct,
    volume: extHours?.s ?? day.v ?? null,
    session: extHours ? 'EXT' : 'DAY',
    ts: Date.now(),
  };
}

/* Batch fetch all tickers and update price cache */
async function fetchAll(tickers, apiKey) {
  const prices = store.getPrices();
  const results = await Promise.allSettled(
    tickers.map(sym => fetchTicker(sym, apiKey))
  );
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      prices[tickers[i]] = r.value;
    }
    // on rejection, keep stale data
  });
  store.setPrices(prices);
  return prices;
}

/* ── Simulation fallback (no API key) ─────────── */

const _sim = {};   // { sym: { price, changePct, volume } }

function simInit(sym) {
  if (_sim[sym]) return;
  _sim[sym] = {
    price:     +(100 + Math.random() * 900).toFixed(2),
    changePct: +(Math.random() * 6 - 3).toFixed(2),
    volume:    +(Math.random() * 80 + 20).toFixed(0),
  };
}

function simTick(sym) {
  const s = _sim[sym]; if (!s) return;
  const delta = +(Math.random() * 1.8 - 0.9);
  s.price     = Math.max(0.01, +(s.price * (1 + delta / 100)).toFixed(2));
  s.changePct = Math.max(-9.99, Math.min(9.99, +(s.changePct + delta * 0.35).toFixed(2)));
  s.volume    = +(Math.random() * 80 + 20).toFixed(0);
}

function simGetPrice(sym) {
  simInit(sym);
  return {
    price:     _sim[sym].price,
    prevClose: null,
    change:    null,
    changePct: _sim[sym].changePct,
    volume:    _sim[sym].volume,
    session:   'SIM',
    ts:        Date.now(),
  };
}

/* ═══════════════════════════════════════════════
   DISPLAY MODULE
   ═══════════════════════════════════════════════ */

const Display = (() => {
  let _pollTimer  = null;
  let _simTimer   = null;
  let _clockTimer = null;

  function init() {
    _startClock();
    _render();
    window.addEventListener('storage', (e) => {
      if (e.key === KEY_TICKERS || e.key === KEY_PRICES) _render();
    });
  }

  /* ── Clock ───────────────────────────── */
  function _startClock() {
    function tick() {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const el = document.getElementById('live-clock');
      if (el) el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const sl = document.getElementById('market-session');
      if (sl) sl.textContent = sessionLabel();
    }
    tick();
    _clockTimer = setInterval(tick, 1000);
  }

  /* ── Main render ─────────────────────── */
  function _render() {
    const tickers = store.getTickers();
    const apiKey  = store.getApiKey();
    const grid    = document.getElementById('ticker-grid');
    const empty   = document.getElementById('empty-state');

    // Stop previous loops
    clearTimeout(_pollTimer);
    clearInterval(_simTimer);

    if (!tickers.length) {
      grid.classList.add('hidden');
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    grid.classList.remove('hidden');

    const n = tickers.length;
    grid.setAttribute('data-layout', String(n));

    if (apiKey) {
      // Real data mode
      _buildSkeletons(tickers, grid);
      _poll(tickers, apiKey, grid);
    } else {
      // Simulation mode
      tickers.forEach(simInit);
      _renderSim(tickers, grid);
      _simTimer = setInterval(() => {
        tickers.forEach(sym => { simTick(sym); _updateCard(sym, simGetPrice(sym)); });
      }, FALLBACK_MS);
    }
  }

  /* ── Skeleton placeholders ───────────── */
  function _buildSkeletons(tickers, grid) {
    grid.innerHTML = tickers.map(sym => `
      <div class="t-card neu" id="card-${sym}">
        <span class="t-session-tag">…</span>
        <div class="t-symbol">${sym}</div>
        <div class="t-loading">загрузка…</div>
        <div class="t-flash"></div>
        <div class="t-vol" style="width:0%"></div>
      </div>
    `).join('');
  }

  /* ── Simulation render ───────────────── */
  function _renderSim(tickers, grid) {
    grid.innerHTML = tickers.map(sym => _cardHTML(sym, simGetPrice(sym))).join('');
  }

  /* ── Poll Polygon ────────────────────── */
  async function _poll(tickers, apiKey, grid) {
    try {
      const prices = await fetchAll(tickers, apiKey);
      tickers.forEach(sym => _updateCard(sym, prices[sym]));
      _updateLastUpdate();
    } catch (e) {
      console.warn('[Display] poll error', e);
    }
    _pollTimer = setTimeout(() => _poll(tickers, apiKey, grid), REFRESH_MS);
  }

  /* ── Build card HTML ─────────────────── */
  function _cardHTML(sym, p) {
    const dir  = calcDir(p);
    const pct  = p?.changePct;
    const tri  = dir === 'pos' ? 'pos' : dir === 'neg' ? 'neg' : 'neu';
    const volW = p?.volume ? Math.min(100, (p.volume / 1e7) * 100) : Math.random() * 60 + 20;
    return `
      <div class="t-card ${dir}" id="card-${sym}">
        <span class="t-session-tag">${p?.session ?? '…'}</span>
        <div class="t-symbol">${sym}</div>
        <div class="t-price">$${fmtPrice(p?.price)}</div>
        <div class="t-change">
          <span class="t-triangle"></span>
          <span class="t-pct">${fmtPct(pct)}</span>
        </div>
        <div class="t-flash"></div>
        <div class="t-vol" style="width:${volW}%"></div>
      </div>
    `;
  }

  /* ── Update existing card ────────────── */
  function _updateCard(sym, p) {
    const card = document.getElementById('card-' + sym);
    if (!card) return;

    const prevDir = card.className.includes('pos') ? 'pos' : card.className.includes('neg') ? 'neg' : 'neu';
    const dir     = calcDir(p);
    const pct     = p?.changePct;
    const volW    = p?.volume ? Math.min(100, (p.volume / 1e7) * 100) : 40;

    card.className = `t-card ${dir}`;

    const sesEl   = card.querySelector('.t-session-tag');
    const priceEl = card.querySelector('.t-price');
    const pctEl   = card.querySelector('.t-pct');
    const loadEl  = card.querySelector('.t-loading');
    const volEl   = card.querySelector('.t-vol');
    const flashEl = card.querySelector('.t-flash');

    if (sesEl)   sesEl.textContent   = p?.session ?? '—';
    if (volEl)   volEl.style.width   = volW + '%';
    if (loadEl)  loadEl.remove();

    if (!priceEl) {
      // First real data after skeleton — rebuild inner
      card.innerHTML = `
        <span class="t-session-tag">${p?.session ?? '—'}</span>
        <div class="t-symbol">${sym}</div>
        <div class="t-price">$${fmtPrice(p?.price)}</div>
        <div class="t-change">
          <span class="t-triangle"></span>
          <span class="t-pct">${fmtPct(pct)}</span>
        </div>
        <div class="t-flash"></div>
        <div class="t-vol" style="width:${volW}%"></div>
      `;
      return;
    }

    // Detect direction change for flash
    if (dir !== prevDir && flashEl) {
      flashEl.className = 't-flash';
      void flashEl.offsetWidth; // reflow
      flashEl.className = 't-flash ' + (dir === 'pos' ? 'on-g' : dir === 'neg' ? 'on-r' : '');
    }

    if (priceEl) priceEl.textContent = '$' + fmtPrice(p?.price);
    if (pctEl)   pctEl.textContent   = fmtPct(pct);
  }

  function _updateLastUpdate() {
    const el = document.getElementById('last-update');
    if (!el) return;
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    el.textContent = `обновлено ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  return { init };
})();

/* ═══════════════════════════════════════════════
   ADMIN MODULE
   ═══════════════════════════════════════════════ */

const Admin = (() => {

  let _previewTimer = null;

  function init() {
    _loadApiKeyField();
    _renderList();
    _renderPreview();
    _startPreviewSim();

    const inp = document.getElementById('ticker-input');
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') addTicker(); });

    window.addEventListener('storage', e => {
      if (e.key === KEY_TICKERS || e.key === KEY_PRICES) {
        _renderList(); _renderPreview();
      }
    });
  }

  /* ── API Key ─────────────────────────── */

  function _loadApiKeyField() {
    const key = store.getApiKey();
    const inp = document.getElementById('api-key-input');
    if (inp && key) inp.value = key;
    _updateApiBadge(!!key);
  }

  function saveApiKey() {
    const inp = document.getElementById('api-key-input');
    const errEl = document.getElementById('api-error');
    errEl.textContent = '';
    const val = (inp?.value || '').trim();
    if (!val) { errEl.textContent = 'Введите API-ключ.'; return; }
    store.setApiKey(val);
    _updateApiBadge(true);
    // Trigger re-fetch
    fetchAll_admin();
  }

  function toggleApiVis() {
    const inp = document.getElementById('api-key-input');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }

  function _updateApiBadge(ok) {
    const b = document.getElementById('api-badge');
    if (!b) return;
    b.textContent = ok ? 'сохранён' : 'не задан';
    b.className   = ok ? 'badge ok' : 'badge';
  }

  /* ── Add / Remove ────────────────────── */

  function addTicker() {
    const inp   = document.getElementById('ticker-input');
    const errEl = document.getElementById('ticker-error');
    errEl.textContent = '';
    const raw = (inp?.value || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    if (!raw) { errEl.textContent = 'Введите символ тикера.'; return; }
    const list = store.getTickers();
    if (list.length >= MAX_TICKERS) { errEl.textContent = 'Максимум 10 тикеров.'; return; }
    if (list.includes(raw)) { errEl.textContent = `"${raw}" уже добавлен.`; return; }
    list.push(raw);
    store.setTickers(list);
    if (inp) inp.value = '';
    _renderList();
    _renderPreview();
    // Try fetch immediately if key set
    if (store.getApiKey()) fetchAll_admin();
  }

  function deleteTicker(sym) {
    store.setTickers(store.getTickers().filter(t => t !== sym));
    _renderList();
    _renderPreview();
  }

  function clearAll() {
    if (!confirm('Удалить все тикеры?')) return;
    store.setTickers([]);
    _renderList();
    _renderPreview();
  }

  /* ── Fetch (from admin) ──────────────── */

  async function fetchAll_admin() {
    const tickers = store.getTickers();
    const apiKey  = store.getApiKey();
    if (!tickers.length || !apiKey) return;
    try {
      await fetchAll(tickers, apiKey);
      _renderList();
      _renderPreview();
    } catch(e) {
      console.warn('[Admin] fetch error', e);
    }
  }

  /* ── Render list ─────────────────────── */

  function _renderList() {
    const tickers = store.getTickers();
    const prices  = store.getPrices();
    const listEl  = document.getElementById('ticker-list');
    const cntEl   = document.getElementById('ticker-count');
    if (cntEl) cntEl.textContent = tickers.length + ' / ' + MAX_TICKERS;
    if (!listEl) return;
    if (!tickers.length) { listEl.innerHTML = '<div class="list-empty">Список пуст</div>'; return; }

    listEl.innerHTML = tickers.map((sym, i) => {
      const p   = prices[sym];
      const dir = calcDir(p);
      const pct = p?.changePct != null ? fmtPct(p.changePct) : '…';
      return `
        <div class="t-list-item">
          <div class="t-list-label">
            <span class="t-list-idx">${i+1}</span>
            <span class="t-list-sym">${sym}</span>
            <span class="t-list-status ${dir}">${pct}</span>
          </div>
          <button class="btn btn-icon" onclick="Admin.deleteTicker('${sym}')">✕</button>
        </div>
      `;
    }).join('');
  }

  /* ── Preview grid ────────────────────── */

  const _prevSim = {};
  function _prevSimInit(sym) {
    if (!_prevSim[sym]) _prevSim[sym] = +(Math.random() * 6 - 3).toFixed(2);
  }
  function _prevSimTick(sym) {
    _prevSimInit(sym);
    _prevSim[sym] = Math.max(-9.99, Math.min(9.99, +(_prevSim[sym] + (Math.random() * 1.4 - 0.7)).toFixed(2)));
  }

  function _renderPreview() {
    const tickers = store.getTickers();
    const prices  = store.getPrices();
    const grid    = document.getElementById('grid-preview');
    if (!grid) return;

    if (!tickers.length) {
      grid.style.gridTemplateColumns = '1fr';
      grid.style.gridTemplateRows    = '1fr';
      grid.innerHTML = '<div class="preview-empty">Нет тикеров</div>';
      return;
    }

    const n = tickers.length;
    let cols, rows;
    if (n === 1)      { cols = 1; rows = 1; }
    else if (n <= 4)  { cols = 2; rows = 2; }
    else if (n <= 6)  { cols = 3; rows = 2; }
    else if (n <= 8)  { cols = 4; rows = 2; }
    else              { cols = 5; rows = 2; }

    grid.style.gridTemplateColumns = `repeat(${cols},1fr)`;
    grid.style.gridTemplateRows    = `repeat(${rows},1fr)`;

    const apiKey = store.getApiKey();

    grid.innerHTML = tickers.map(sym => {
      const p   = prices[sym];
      let dir, pct;
      if (p) {
        dir = calcDir(p); pct = fmtPct(p.changePct);
      } else {
        _prevSimInit(sym);
        dir = _prevSim[sym] > 0 ? 'pos' : _prevSim[sym] < 0 ? 'neg' : 'neu';
        pct = fmtPct(_prevSim[sym]);
      }
      return `
        <div class="prev-cell ${dir}" id="prev-${sym}">
          <span class="prev-sym">${sym}</span>
          <span class="prev-pct">${pct}</span>
        </div>
      `;
    }).join('');
  }

  function _startPreviewSim() {
    if (_previewTimer) clearInterval(_previewTimer);
    _previewTimer = setInterval(() => {
      const tickers = store.getTickers();
      const prices  = store.getPrices();
      const apiKey  = store.getApiKey();
      tickers.forEach(sym => {
        const cell = document.getElementById('prev-' + sym);
        if (!cell) return;
        const p = prices[sym];
        let dir, pct;
        if (p) {
          dir = calcDir(p); pct = fmtPct(p.changePct);
        } else {
          _prevSimTick(sym);
          dir = _prevSim[sym] > 0 ? 'pos' : _prevSim[sym] < 0 ? 'neg' : 'neu';
          pct = fmtPct(_prevSim[sym]);
        }
        cell.className = 'prev-cell ' + dir;
        const ps = cell.querySelector('.prev-pct');
        if (ps) ps.textContent = pct;
      });
    }, 2500);
  }

  /* public API */
  return { init, saveApiKey, toggleApiVis, addTicker, deleteTicker, clearAll, fetchAll: fetchAll_admin };
})();
