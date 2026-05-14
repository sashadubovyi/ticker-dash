/* ═══════════════════════════════════════════════════════
   TICKERBOARD v4  ·  script.js
   Firebase Realtime Database  +  Finnhub Quote API
   ═══════════════════════════════════════════════════════

   Finnhub /quote response fields used:
     c  — Current price (extended / last trade)
     d  — Change ($) vs previous close
     dp — Change (%) vs previous close
     pc — Previous close price

   Firebase DB structure:
     config/
       apiKey:  "your-finnhub-token"
       tickers: { "AAPL": true, "TSLA": true, … }

   Grid layout (no scroll, fills 100vh/100vw):
     n=1 → 1 col, 1 row
     n=2 → 2 cols, 1 row
     n=3 → 3 cols, 1 row
     n=4 → 4 cols, 1 row
     n>4 → ceil(n/2) cols, 2 rows
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ── Firebase configuration ───────────────────────────
   ВСТАВЬТЕ СВОЮ КОНФИГУРАЦИЮ НИЖЕ:
   Найдите её в Firebase Console → Project Settings → Your apps
   ──────────────────────────────────────────────────── */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBQOmdf7FGEnk2UHA_8CrZhLSeP6BPvVRY",
  authDomain: "mytickerboard.firebaseapp.com",
  databaseURL: "https://mytickerboard-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mytickerboard",
  storageBucket: "mytickerboard.firebasestorage.app",
  messagingSenderId: "842033577784",
  appId: "1:842033577784:web:12f8cfe9e6e93795890bcd"
};

/* ── Constants ────────────────────────────────────────── */
const DB_PATH      = 'config';          // Firebase DB path
const REFRESH_MS   = 15_000;           // Finnhub poll interval: 15 s
const MAX_TICKERS  = 10;

/* ── Init Firebase ────────────────────────────────────── */
let _app = null;
let _db  = null;

function initFirebase() {
  if (_app) return true;
  if (!FIREBASE_CONFIG.databaseURL) {
    console.error('[TB] Firebase databaseURL не задан в FIREBASE_CONFIG');
    return false;
  }
  try {
    _app = firebase.initializeApp(FIREBASE_CONFIG);
    _db  = firebase.database();
    return true;
  } catch (e) {
    console.error('[TB] Firebase init error:', e);
    return false;
  }
}

/* ── Finnhub fetch ────────────────────────────────────── */

async function fetchQuote(symbol, apiKey) {
  const url =
    `https://finnhub.io/api/v1/quote` +
    `?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Finnhub HTTP ${r.status}`);
  const data = await r.json();
  // Finnhub returns { c, d, dp, h, l, o, pc, t }
  if (data.c === 0 && data.pc === 0) throw new Error(`No data for ${symbol}`);
  return {
    c:  data.c  ?? null,   // current / extended price
    d:  data.d  ?? null,   // change $
    dp: data.dp ?? null,   // change %
    pc: data.pc ?? null,   // previous close
  };
}

/* Fetch all tickers, return map { sym: {c,d,dp,pc} | null } */
async function fetchAllQuotes(tickers, apiKey) {
  const results = await Promise.allSettled(
    tickers.map(sym => fetchQuote(sym, apiKey))
  );
  const map = {};
  results.forEach((r, i) => {
    map[tickers[i]] = r.status === 'fulfilled' ? r.value : null;
    if (r.status === 'rejected') console.warn(`[TB] ${tickers[i]}:`, r.reason?.message);
  });
  return map;
}

/* ── Market session detection (US Eastern Time) ──────── */

function getMarketSession() {
  const now    = new Date();
  const utcMs  = now.getTime() + now.getTimezoneOffset() * 60_000;
  const isDST  = (() => {
    const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
    return Math.min(jan, jul) === now.getTimezoneOffset();
  })();
  const etMs   = utcMs + (isDST ? -4 : -5) * 3_600_000;
  const et     = new Date(etMs);
  const h      = et.getHours() + et.getMinutes() / 60;

  if (h >= 4   && h < 9.5)  return 'PRE-MARKET';
  if (h >= 9.5 && h < 16)   return 'OPEN';
  if (h >= 16  && h < 20)   return 'AFTER-HOURS';
  return 'CLOSED';
}

/* ── Formatting helpers ───────────────────────────────── */

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  n = +n;
  if (n >= 10000) return n.toFixed(0);
  if (n >= 1000)  return n.toFixed(1);
  return n.toFixed(2);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + (+n).toFixed(2) + '%';
}

function fmtChange(n) {
  if (n == null || isNaN(n)) return '';
  return (n >= 0 ? '+' : '') + (+n).toFixed(2);
}

/* Direction for card coloring: c vs pc */
function calcDir(q) {
  if (!q || q.c == null || q.pc == null) return 'neu';
  if (q.c > q.pc + 0.001) return 'pos';
  if (q.c < q.pc - 0.001) return 'neg';
  return 'neu';
}

/* ── Grid layout calculator ──────────────────────────── */

function calcGrid(n) {
  if (n <= 0) return { cols: 1, rows: 1 };
  if (n <= 4) return { cols: n, rows: 1 };            // 1–4: single row
  return { cols: Math.ceil(n / 2), rows: 2 };         // 5+: two rows
}

/* Font sizes per cell count — scales for 55" */
function calcFontSizes(n) {
  if (n === 1) return { sym: '18vw', price: '7vw',  chg: '5.5vw', badge: '2.5vw' };
  if (n <= 2)  return { sym: '10vw', price: '4.5vw',chg: '3.2vw', badge: '1.9vw' };
  if (n <= 4)  return { sym: '7vw',  price: '3.2vw',chg: '2.4vw', badge: '1.6vw' };
  if (n <= 6)  return { sym: '5.5vw',price: '2.5vw',chg: '1.9vw', badge: '1.3vw' };
  return             { sym: '4vw',  price: '1.9vw',chg: '1.5vw', badge: '1.1vw' };
}

/* ════════════════════════════════════════════════════════
   DISPLAY PAGE  (index.html)
   ════════════════════════════════════════════════════════ */

/* Only run on index.html */
if (document.getElementById('ticker-grid') !== null) {

  let _config    = { apiKey: '', tickers: [] };
  let _pollTimer = null;

  /* ── Bootstrap ────────────────────────────────── */
  function displayBoot() {
    startClock();
    updateSessionLabel();
    setInterval(updateSessionLabel, 10_000);

    const ok = initFirebase();
    if (!ok) {
      setEmptyMsg('Ошибка: заполните FIREBASE_CONFIG в script.js');
      return;
    }

    // Listen for config changes in realtime
    _db.ref(DB_PATH).on('value', snapshot => {
      const raw = snapshot.val() || {};
      const apiKey  = raw.apiKey || '';
      const tickers = raw.tickers ? Object.keys(raw.tickers) : [];

      const changed =
        apiKey !== _config.apiKey ||
        JSON.stringify(tickers.sort()) !== JSON.stringify((_config.tickers || []).slice().sort());

      _config = { apiKey, tickers };

      if (!apiKey || !tickers.length) {
        stopPoll();
        renderEmpty(!apiKey
          ? 'Добавьте Finnhub API Key в Admin-панели'
          : 'Добавьте тикеры в Admin-панели'
        );
        return;
      }

      if (changed) {
        buildGrid(tickers);
      }
      startPoll();
    }, err => {
      console.error('[Display] Firebase read error:', err);
      setEmptyMsg('Ошибка чтения Firebase: ' + err.message);
    });
  }

  /* ── Clock ────────────────────────────────────── */
  function startClock() {
    function tick() {
      const now = new Date(), p = n => String(n).padStart(2, '0');
      const el = document.getElementById('live-clock');
      if (el) el.textContent = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    }
    tick();
    setInterval(tick, 1000);
  }

  function updateSessionLabel() {
    const el = document.getElementById('hud-session');
    if (el) el.textContent = getMarketSession();
  }

  /* ── Empty / Grid toggle ──────────────────────── */
  function renderEmpty(msg) {
    document.getElementById('ticker-grid').style.display  = 'none';
    document.getElementById('empty-state').style.display  = 'flex';
    setEmptyMsg(msg);
  }

  function setEmptyMsg(msg) {
    const el = document.getElementById('empty-msg');
    if (el) el.textContent = msg;
  }

  /* ── Build grid skeletons ─────────────────────── */
  function buildGrid(tickers) {
    const grid = document.getElementById('ticker-grid');
    const es   = document.getElementById('empty-state');
    es.style.display   = 'none';
    grid.style.display = 'grid';

    const n   = tickers.length;
    const { cols, rows } = calcGrid(n);
    const fs  = calcFontSizes(n);

    grid.style.setProperty('--cols', cols);
    grid.style.setProperty('--rows', rows);
    grid.style.setProperty('--sym-fs',   fs.sym);
    grid.style.setProperty('--price-fs', fs.price);
    grid.style.setProperty('--chg-fs',   fs.chg);
    grid.style.setProperty('--badge-fs', fs.badge);

    grid.innerHTML = tickers.map(sym => `
      <div class="t-card neu" id="card-${cssId(sym)}">
        <div class="t-symbol">${sym}</div>
        <div class="t-loading">загрузка…</div>
        <div class="t-flash"></div>
        <div class="t-vol" style="width:0%"></div>
      </div>
    `).join('');
  }

  /* ── Poll Finnhub ─────────────────────────────── */
  function startPoll() {
    stopPoll();
    poll();
  }

  function stopPoll() {
    if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
  }

  async function poll() {
    const { apiKey, tickers } = _config;
    if (!apiKey || !tickers.length) return;

    try {
      const quotes = await fetchAllQuotes(tickers, apiKey);
      tickers.forEach(sym => updateCard(sym, quotes[sym]));
      markUpdated();
    } catch (e) {
      console.warn('[Display] poll error:', e);
    }

    _pollTimer = setTimeout(poll, REFRESH_MS);
  }

  /* ── Update single card ───────────────────────── */
  function updateCard(sym, q) {
    const card = document.getElementById('card-' + cssId(sym));
    if (!card) return;

    const prevDir = card.classList.contains('pos') ? 'pos'
                  : card.classList.contains('neg') ? 'neg' : 'neu';
    const dir = calcDir(q);

    card.className = `t-card ${dir}`;
    card.innerHTML = buildCardHTML(sym, q, dir);

    // Flash on direction change
    if (dir !== prevDir && dir !== 'neu') {
      const fl = card.querySelector('.t-flash');
      if (fl) {
        fl.className = 't-flash';
        void fl.offsetWidth;          // force reflow
        fl.className = `t-flash ${dir === 'pos' ? 'on-g' : 'on-r'}`;
      }
    }
  }

  /* ── Card HTML builder ────────────────────────── */
  function buildCardHTML(sym, q, dir) {
    if (!q) {
      return `<div class="t-symbol">${sym}</div>
              <div class="t-loading">нет данных</div>
              <div class="t-flash"></div>
              <div class="t-vol" style="width:0%"></div>`;
    }

    const session   = getMarketSession();
    const showBadge = session !== 'OPEN';  // hide badge during regular hours
    const icon      = session === 'PRE-MARKET'  ? '☀️'
                    : session === 'AFTER-HOURS' ? '🌙' : '●';
    const badgeLabel = session === 'PRE-MARKET'  ? 'ПРЕМАРКЕТ'
                     : session === 'AFTER-HOURS' ? 'ПОСТМАРКЕТ' : session;

    // Volume bar width: visual only, scaled by abs(dp)
    const volW = q.dp != null ? Math.min(100, Math.abs(q.dp) * 8) : 15;

    const badgeHidden = showBadge ? '' : 'hidden';

    return `
      <div class="t-symbol">${sym}</div>
      <div class="t-prev-close">$${fmtPrice(q.pc)}</div>
      <div class="t-change-row">
        <span class="t-tri"></span>
        <span class="t-dp">${fmtPct(q.dp)}</span>
      </div>
      <div class="t-ext-badge ${badgeHidden}">
        <span class="t-ext-icon">${icon}</span>
        <span class="t-ext-label">${badgeLabel}</span>
        <span class="t-ext-price">$${fmtPrice(q.c)}</span>
        <span class="t-ext-chg">${fmtChange(q.d)}</span>
      </div>
      <div class="t-flash"></div>
      <div class="t-vol" style="width:${volW.toFixed(1)}%"></div>
    `;
  }

  /* ── Helpers ──────────────────────────────────── */
  function markUpdated() {
    const el = document.getElementById('last-update');
    if (!el) return;
    const d = new Date(), p = n => String(n).padStart(2, '0');
    el.textContent = `обновлено ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // CSS-safe id (dots → dashes etc.)
  function cssId(sym) { return sym.replace(/[^a-zA-Z0-9]/g, '-'); }

  /* ── Start ────────────────────────────────────── */
  displayBoot();
}

/* ════════════════════════════════════════════════════════
   ADMIN PAGE  (admin.html)
   ════════════════════════════════════════════════════════ */

if (document.getElementById('adm-ticker-list') !== null) {

  let _tickers = [];   // local working copy before save

  /* ── Bootstrap ────────────────────────────────── */
  function adminBoot() {
    const ok = initFirebase();
    setStatus(ok ? 'Подключение к Firebase…' : 'Ошибка: заполните FIREBASE_CONFIG', ok ? '' : 'error');
    if (!ok) return;

    // Load existing config from Firebase
    _db.ref(DB_PATH).once('value').then(snap => {
      const raw    = snap.val() || {};
      const apiKey = raw.apiKey || '';
      _tickers     = raw.tickers ? Object.keys(raw.tickers) : [];

      const inp = document.getElementById('inp-apikey');
      if (inp && apiKey) inp.value = apiKey;

      renderList();
      setStatus('Firebase подключён ✓', 'ok');
    }).catch(e => {
      setStatus('Ошибка чтения: ' + e.message, 'error');
    });

    // Enter key on ticker input
    const ti = document.getElementById('inp-ticker');
    if (ti) ti.addEventListener('keydown', e => { if (e.key === 'Enter') adminAddTicker(); });
  }

  /* ── Status banner ────────────────────────────── */
  function setStatus(msg, cls) {
    const el = document.getElementById('adm-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'adm-status' + (cls ? ' ' + cls : '');
  }

  /* ── Key visibility toggle ────────────────────── */
  function adminToggleKeyVis() {
    const inp = document.getElementById('inp-apikey');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  }

  /* ── Add ticker ───────────────────────────────── */
  function adminAddTicker() {
    const inp = document.getElementById('inp-ticker');
    const err = document.getElementById('adm-ticker-err');
    err.textContent = '';
    const raw = (inp?.value || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    if (!raw) { err.textContent = 'Введите символ тикера'; return; }
    if (_tickers.length >= MAX_TICKERS) { err.textContent = 'Максимум ' + MAX_TICKERS + ' тикеров'; return; }
    if (_tickers.includes(raw)) { err.textContent = `"${raw}" уже в списке`; return; }
    _tickers.push(raw);
    if (inp) inp.value = '';
    renderList();
  }

  /* ── Delete ticker ────────────────────────────── */
  function adminDeleteTicker(sym) {
    _tickers = _tickers.filter(t => t !== sym);
    renderList();
  }

  /* ── Render list ──────────────────────────────── */
  function renderList() {
    const listEl = document.getElementById('adm-ticker-list');
    const cntEl  = document.getElementById('adm-count');
    if (cntEl) cntEl.textContent = _tickers.length + ' / ' + MAX_TICKERS;
    if (!listEl) return;
    if (!_tickers.length) {
      listEl.innerHTML = '<div class="adm-list-empty">Список пуст</div>';
      return;
    }
    listEl.innerHTML = _tickers.map((sym, i) => `
      <div class="adm-item">
        <span class="adm-item-sym">${i + 1}. ${sym}</span>
        <button class="adm-del-btn" onclick="adminDeleteTicker('${sym}')">✕</button>
      </div>
    `).join('');
  }

  /* ── Save to Firebase ─────────────────────────── */
  async function adminSave() {
    const apiKey = (document.getElementById('inp-apikey')?.value || '').trim();
    if (!apiKey) { setStatus('Введите Finnhub API Key', 'error'); return; }
    if (!_tickers.length) { setStatus('Добавьте хотя бы один тикер', 'error'); return; }

    const btn = document.getElementById('adm-save-btn');
    if (btn) btn.disabled = true;
    setStatus('Сохранение…', 'saving');

    // Build tickers map: { "AAPL": true, "TSLA": true }
    const tickersMap = {};
    _tickers.forEach(sym => { tickersMap[sym] = true; });

    try {
      await _db.ref(DB_PATH).set({ apiKey, tickers: tickersMap });
      setStatus('Сохранено ✓ — дисплей обновится автоматически', 'ok');
    } catch (e) {
      setStatus('Ошибка сохранения: ' + e.message, 'error');
      console.error('[Admin] save error:', e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ── Start ────────────────────────────────────── */
  adminBoot();
}
