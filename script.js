/* ═══════════════════════════════════════════════
   TICKERBOARD v3  ·  script.js
   Polygon.io Snapshot — preMarket / afterHours
   ═══════════════════════════════════════════════

   Polygon /v2/snapshot response — relevant fields:
   ticker: {
     todaysChange,       ← price change vs prevDay.c
     todaysChangePerc,   ← % change vs prevDay.c
     day:     { o,h,l,c, v, vw }   regular session
     prevDay: { c }                 previous close  ← OUR REFERENCE
     lastTrade: { p }               last trade price
     preMarket:  { o,h,l,c, v }    04:00–09:30 ET  ← PRIMARY
     afterHours: { o,h,l,c, v }    16:00–20:00 ET  ← FALLBACK
   }

   Display priority:
     preMarket.c  → label "PRE-MARKET"
     afterHours.c → label "AFTER-HOURS"
     lastTrade.p / day.c → label "CLOSED" or "OPEN"

   Color = ext price vs prevDay.c (positive → green, negative → red)
   Refresh: random 10–15 s
   ═══════════════════════════════════════════════ */

'use strict';

/* ── Storage keys ─────────────────────────────── */
const KEY_TICKERS = 'tickerboard_tickers';
const KEY_APIKEY  = 'tickerboard_apikey';
const KEY_PRICES  = 'tickerboard_prices';

const MAX_TICKERS = 10;
const REFRESH_MIN = 10_000;
const REFRESH_MAX = 15_000;
const FALLBACK_MS = 4_000;

/* ── localStorage helpers ─────────────────────── */
const store = {
  getTickers: () => { try { return JSON.parse(localStorage.getItem(KEY_TICKERS) || '[]'); } catch { return []; } },
  setTickers: (v) => localStorage.setItem(KEY_TICKERS, JSON.stringify(v)),
  getApiKey:  () => localStorage.getItem(KEY_APIKEY) || '',
  setApiKey:  (v) => localStorage.setItem(KEY_APIKEY, v.trim()),
  getPrices:  () => { try { return JSON.parse(localStorage.getItem(KEY_PRICES) || '{}'); } catch { return {}; } },
  setPrices:  (v) => localStorage.setItem(KEY_PRICES, JSON.stringify(v)),
};

/* ── Formatting ───────────────────────────────── */

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  n = +n;
  return n >= 10000 ? n.toFixed(0) : n >= 1000 ? n.toFixed(1) : n.toFixed(2);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + (+n).toFixed(2) + '%';
}

function fmtChange(n) {
  if (n == null || isNaN(n)) return '';
  return (n >= 0 ? '+' : '') + (+n).toFixed(2);
}

/* Direction based on extended-hours % vs prevClose */
function calcDir(p) {
  if (!p) return 'neu';
  const pct = p.extChangePct ?? p.changePct;
  if (pct == null) return 'neu';
  if (pct >  0.01) return 'pos';
  if (pct < -0.01) return 'neg';
  return 'neu';
}

/* Approximate ET session (handles DST) */
function currentSession() {
  const now    = new Date();
  const utcMs  = now.getTime() + now.getTimezoneOffset() * 60000;
  const etOff  = _isDST(now) ? -4 : -5;
  const et     = new Date(utcMs + etOff * 3600000);
  const h      = et.getHours() + et.getMinutes() / 60;
  if (h >= 4   && h < 9.5)  return 'PRE-MARKET';
  if (h >= 9.5 && h < 16)   return 'OPEN';
  if (h >= 16  && h < 20)   return 'AFTER-HOURS';
  return 'CLOSED';
}

function _isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return Math.min(jan, jul) === date.getTimezoneOffset();
}

/* ── Polygon.io fetch ─────────────────────────── */

async function fetchTicker(sym, apiKey) {
  const url =
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/` +
    `${encodeURIComponent(sym)}?apiKey=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.status === 'ERROR' || data.status === 'NOT_AUTHORIZED')
    throw new Error(data.error ?? data.message ?? 'API error');

  const t = data?.ticker;
  if (!t) throw new Error('Empty ticker response');

  /* Named fields from Polygon snapshot */
  const day        = t.day        || {};
  const prevDay    = t.prevDay    || {};
  const lastTrade  = t.lastTrade  || {};
  const preMarket  = t.preMarket  || {};   // { o,h,l,c,v }
  const afterHours = t.afterHours || {};   // { o,h,l,c,v }

  const prevClose = prevDay.c ?? null;     // reference for % calculation
  const regClose  = day.c     ?? null;
  const regVolume = day.v     ?? null;

  /* Overall change from Polygon (most reliable) */
  const polyChangePct = t.todaysChangePerc ?? null;
  const polyChange    = t.todaysChange     ?? null;

  /* ── Extended-hours price resolution ── */
  // Pre-market takes priority (fresher data for morning display)
  let extPrice  = null;
  let extVolume = null;
  let extLabel  = 'CLOSED';

  if (preMarket.c) {
    extPrice  = preMarket.c;
    extVolume = preMarket.v ?? null;
    extLabel  = 'PRE-MARKET';
  } else if (afterHours.c) {
    extPrice  = afterHours.c;
    extVolume = afterHours.v ?? null;
    extLabel  = 'AFTER-HOURS';
  }

  const sess = currentSession();
  if (sess === 'OPEN') extLabel = 'OPEN';

  /* Main display price */
  const displayPrice = extPrice ?? lastTrade.p ?? regClose ?? null;

  /* Extended % vs prevClose */
  let extChangePct = null;
  if (extPrice != null && prevClose) {
    extChangePct = ((extPrice - prevClose) / prevClose) * 100;
  }

  /* Overall % (prefer Polygon's own field) */
  const changePct = polyChangePct ?? (
    displayPrice != null && prevClose
      ? ((displayPrice - prevClose) / prevClose) * 100
      : null
  );
  const change = polyChange ?? (
    displayPrice != null && prevClose ? displayPrice - prevClose : null
  );

  return {
    price:        displayPrice,
    prevClose,
    change,
    changePct,
    extPrice,
    extChangePct,
    extVolume,
    extLabel,
    regClose,
    regVolume,
    session:      extLabel,
    ts:           Date.now(),
  };
}

async function fetchAll(tickers, apiKey) {
  const prices  = store.getPrices();
  const results = await Promise.allSettled(tickers.map(s => fetchTicker(s, apiKey)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') prices[tickers[i]] = r.value;
    else console.warn(`[fetch] ${tickers[i]}:`, r.reason?.message ?? r.reason);
  });
  store.setPrices(prices);
  return prices;
}

/* ── Simulation fallback ──────────────────────── */
const _sim = {};
function simInit(sym) {
  if (_sim[sym]) return;
  const base = +(100 + Math.random() * 900).toFixed(2);
  _sim[sym] = { price: base, changePct: +(Math.random()*6-3).toFixed(2), extChangePct: +(Math.random()*4-2).toFixed(2), vol: +(Math.random()*5e6+1e5) };
}
function simTick(sym) {
  const s = _sim[sym]; if (!s) return;
  const d = +(Math.random()*1.8-0.9);
  s.price        = Math.max(0.01, +(s.price*(1+d/100)).toFixed(2));
  s.changePct    = Math.max(-9.99,Math.min(9.99,+(s.changePct+d*0.3).toFixed(2)));
  s.extChangePct = Math.max(-9.99,Math.min(9.99,+(s.extChangePct+d*0.2).toFixed(2)));
  s.vol          = +(Math.random()*5e6+1e5);
}
function simGet(sym) {
  simInit(sym);
  const s = _sim[sym];
  const sess = currentSession();
  const prevClose = +(s.price/(1+s.changePct/100)).toFixed(2);
  const extPrice  = +(s.price*(1+s.extChangePct/100)).toFixed(2);
  const extLabel  = sess === 'PRE-MARKET' ? 'PRE-MARKET' : sess === 'AFTER-HOURS' ? 'AFTER-HOURS' : sess === 'OPEN' ? 'OPEN' : 'CLOSED';
  return {
    price: extPrice, prevClose,
    change: +(extPrice-prevClose).toFixed(2),
    changePct: s.changePct,
    extPrice, extChangePct: s.extChangePct,
    extVolume: s.vol, extLabel,
    regClose: s.price, regVolume: s.vol,
    session: extLabel, ts: Date.now(),
  };
}

/* ═══════════════════════════════════════════════
   CARD RENDERER
   Produces inner HTML for a ticker card.
   Containers expected in index.html:
     .t-session-tag  — top-left session badge
     .t-symbol       — big ticker name
     .t-price        — main price
     .t-change       — triangle + overall %
     .t-ext-row      — "PRE-MARKET: +1.23%" line  ← NEW
     .t-prev-close   — "CLOSE $xxx  +n.nn"        ← NEW
     .t-flash        — flash overlay
     .t-vol          — volume bar
   ═══════════════════════════════════════════════ */

function buildCardInner(sym, p) {
  if (!p) {
    return `<span class="t-session-tag">…</span>
            <div class="t-symbol">${sym}</div>
            <div class="t-loading">загрузка…</div>
            <div class="t-flash"></div>
            <div class="t-vol" style="width:0%"></div>`;
  }

  const dir     = calcDir(p);
  const mainPct = p.extChangePct ?? p.changePct;   // best % to show on card
  const volPct  = p.extVolume ?? p.regVolume
    ? Math.min(100, ((p.extVolume ?? p.regVolume) / 8e6) * 100)
    : 30;

  /* Extended session row: "PRE-MARKET: +1.23%" */
  let extRow = '';
  if (p.extChangePct != null && p.extLabel && p.extLabel !== 'OPEN') {
    extRow = `<div class="t-ext-row">
                <span class="t-ext-label">${p.extLabel}</span>
                <span class="t-ext-sep">:</span>
                <span class="t-ext-pct ${dir}">${fmtPct(p.extChangePct)}</span>
              </div>`;
  } else if (p.extLabel) {
    extRow = `<div class="t-ext-row t-ext-dim">${p.extLabel}</div>`;
  }

  /* Previous close row */
  let prevRow = '';
  if (p.prevClose != null) {
    const chgStr = fmtChange(p.change);
    prevRow = `<div class="t-prev-close">
                 CLOSE&nbsp;$${fmtPrice(p.prevClose)}
                 <span class="t-chg-abs ${dir}">${chgStr}</span>
               </div>`;
  }

  return `
    <span class="t-session-tag">${p.extLabel ?? '—'}</span>
    <div class="t-symbol">${sym}</div>
    <div class="t-price">$${fmtPrice(p.price)}</div>
    <div class="t-change">
      <span class="t-triangle"></span>
      <span class="t-pct">${fmtPct(mainPct)}</span>
    </div>
    ${extRow}
    ${prevRow}
    <div class="t-flash"></div>
    <div class="t-vol" style="width:${volPct.toFixed(1)}%"></div>
  `;
}

/* ═══════════════════════════════════════════════
   DISPLAY MODULE
   ═══════════════════════════════════════════════ */
const Display = (() => {
  let _pollTimer = null;
  let _simTimer  = null;

  function init() {
    _startClock();
    _render();
    window.addEventListener('storage', e => {
      if (e.key === KEY_TICKERS || e.key === KEY_PRICES) _render();
    });
  }

  function _startClock() {
    function tick() {
      const now = new Date(), pad = n => String(n).padStart(2,'0');
      const cl = document.getElementById('live-clock');
      if (cl) cl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const sl = document.getElementById('market-session');
      if (sl) sl.textContent = currentSession();
    }
    tick(); setInterval(tick, 1000);
  }

  function _render() {
    const tickers = store.getTickers();
    const apiKey  = store.getApiKey();
    const grid    = document.getElementById('ticker-grid');
    const empty   = document.getElementById('empty-state');

    clearTimeout(_pollTimer);
    clearInterval(_simTimer);

    if (!tickers.length) {
      grid.classList.add('hidden');
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';
    grid.classList.remove('hidden');
    grid.setAttribute('data-layout', String(tickers.length));

    if (apiKey) {
      _buildSkeletons(tickers, grid);
      _poll(tickers, apiKey);
    } else {
      tickers.forEach(simInit);
      grid.innerHTML = tickers.map(sym => {
        const p = simGet(sym);
        return `<div class="t-card ${calcDir(p)}" id="card-${sym}">${buildCardInner(sym, p)}</div>`;
      }).join('');
      _simTimer = setInterval(() => {
        tickers.forEach(sym => { simTick(sym); _patchCard(sym, simGet(sym)); });
      }, FALLBACK_MS);
    }
  }

  function _buildSkeletons(tickers, grid) {
    grid.innerHTML = tickers.map(sym =>
      `<div class="t-card neu" id="card-${sym}">${buildCardInner(sym, null)}</div>`
    ).join('');
  }

  async function _poll(tickers, apiKey) {
    try {
      const prices = await fetchAll(tickers, apiKey);
      tickers.forEach(sym => _patchCard(sym, prices[sym]));
      _updateLastUpdate();
    } catch(e) { console.warn('[Display] poll:', e); }
    const delay = REFRESH_MIN + Math.random() * (REFRESH_MAX - REFRESH_MIN);
    _pollTimer = setTimeout(() => _poll(tickers, apiKey), delay);
  }

  function _patchCard(sym, p) {
    const card = document.getElementById('card-' + sym);
    if (!card) return;
    const wasDir = card.classList.contains('pos') ? 'pos' : card.classList.contains('neg') ? 'neg' : 'neu';
    const dir    = calcDir(p);
    card.className = `t-card ${dir}`;
    card.innerHTML = buildCardInner(sym, p);
    if (dir !== wasDir && dir !== 'neu') {
      const fl = card.querySelector('.t-flash');
      if (fl) { fl.className='t-flash'; void fl.offsetWidth; fl.className=`t-flash ${dir==='pos'?'on-g':'on-r'}`; }
    }
  }

  function _updateLastUpdate() {
    const el = document.getElementById('last-update');
    if (!el) return;
    const d = new Date(), pad = n => String(n).padStart(2,'0');
    el.textContent = `обновлено ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  return { init };
})();

/* ═══════════════════════════════════════════════
   ADMIN MODULE
   ═══════════════════════════════════════════════ */
const Admin = (() => {
  let _previewTimer = null;
  const _prevSim = {};

  function init() {
    _loadApiKeyField(); _renderList(); _renderPreview(); _startPreviewAnim();
    const inp = document.getElementById('ticker-input');
    if (inp) inp.addEventListener('keydown', e => { if (e.key==='Enter') addTicker(); });
    window.addEventListener('storage', e => {
      if (e.key===KEY_TICKERS||e.key===KEY_PRICES) { _renderList(); _renderPreview(); }
    });
  }

  function _loadApiKeyField() {
    const key = store.getApiKey();
    const inp = document.getElementById('api-key-input');
    if (inp && key) inp.value = key;
    _updateApiBadge(!!key);
  }

  function saveApiKey() {
    const inp = document.getElementById('api-key-input');
    const err = document.getElementById('api-error');
    err.textContent = '';
    const val = (inp?.value||'').trim();
    if (!val) { err.textContent='Введите API-ключ.'; return; }
    store.setApiKey(val); _updateApiBadge(true); fetchAll_admin();
  }

  function toggleApiVis() {
    const inp = document.getElementById('api-key-input');
    if (inp) inp.type = inp.type==='password' ? 'text' : 'password';
  }

  function _updateApiBadge(ok) {
    const b = document.getElementById('api-badge');
    if (!b) return;
    b.textContent = ok ? 'сохранён' : 'не задан';
    b.className   = ok ? 'badge ok' : 'badge';
  }

  function addTicker() {
    const inp = document.getElementById('ticker-input');
    const err = document.getElementById('ticker-error');
    err.textContent = '';
    const raw = (inp?.value||'').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g,'');
    if (!raw) { err.textContent='Введите символ тикера.'; return; }
    const list = store.getTickers();
    if (list.length >= MAX_TICKERS) { err.textContent='Максимум 10 тикеров.'; return; }
    if (list.includes(raw)) { err.textContent=`"${raw}" уже добавлен.`; return; }
    list.push(raw); store.setTickers(list);
    if (inp) inp.value='';
    _renderList(); _renderPreview();
    if (store.getApiKey()) fetchAll_admin();
  }

  function deleteTicker(sym) {
    store.setTickers(store.getTickers().filter(t=>t!==sym));
    _renderList(); _renderPreview();
  }

  function clearAll() {
    if (!confirm('Удалить все тикеры?')) return;
    store.setTickers([]); _renderList(); _renderPreview();
  }

  async function fetchAll_admin() {
    const tickers = store.getTickers(), apiKey = store.getApiKey();
    if (!tickers.length||!apiKey) return;
    try { await fetchAll(tickers, apiKey); _renderList(); _renderPreview(); }
    catch(e) { console.warn('[Admin]',e); }
  }

  function _renderList() {
    const tickers=store.getTickers(), prices=store.getPrices();
    const listEl=document.getElementById('ticker-list'), cntEl=document.getElementById('ticker-count');
    if (cntEl) cntEl.textContent=tickers.length+' / '+MAX_TICKERS;
    if (!listEl) return;
    if (!tickers.length) { listEl.innerHTML='<div class="list-empty">Список пуст</div>'; return; }
    listEl.innerHTML=tickers.map((sym,i)=>{
      const p=prices[sym], dir=calcDir(p);
      const pct = p?.extChangePct!=null ? fmtPct(p.extChangePct) : p?.changePct!=null ? fmtPct(p.changePct) : '…';
      const lbl = p?.extLabel ?? '…';
      return `<div class="t-list-item">
        <div class="t-list-label">
          <span class="t-list-idx">${i+1}</span>
          <span class="t-list-sym">${sym}</span>
          <span class="t-list-status ${dir}">${lbl}: ${pct}</span>
        </div>
        <button class="btn btn-icon" onclick="Admin.deleteTicker('${sym}')">✕</button>
      </div>`;
    }).join('');
  }

  function _prevSimInit(sym) { if (!_prevSim[sym]) _prevSim[sym]=+(Math.random()*6-3).toFixed(2); }
  function _prevSimTick(sym) {
    _prevSimInit(sym);
    _prevSim[sym]=Math.max(-9.99,Math.min(9.99,+(_prevSim[sym]+(Math.random()*1.4-0.7)).toFixed(2)));
  }

  function _renderPreview() {
    const tickers=store.getTickers(), prices=store.getPrices();
    const grid=document.getElementById('grid-preview'); if (!grid) return;
    if (!tickers.length) {
      grid.style.cssText='grid-template-columns:1fr;grid-template-rows:1fr';
      grid.innerHTML='<div class="preview-empty">Нет тикеров</div>'; return;
    }
    const n=tickers.length;
    const cols=n===1?1:n<=4?2:n<=6?3:n<=8?4:5, rows=n===1?1:2;
    grid.style.gridTemplateColumns=`repeat(${cols},1fr)`;
    grid.style.gridTemplateRows=`repeat(${rows},1fr)`;
    grid.innerHTML=tickers.map(sym=>{
      const p=prices[sym]; let dir,pct;
      if(p){dir=calcDir(p);pct=fmtPct(p.extChangePct??p.changePct);}
      else{_prevSimInit(sym);const v=_prevSim[sym];dir=v>0?'pos':v<0?'neg':'neu';pct=fmtPct(v);}
      return `<div class="prev-cell ${dir}" id="prev-${sym}"><span class="prev-sym">${sym}</span><span class="prev-pct">${pct}</span></div>`;
    }).join('');
  }

  function _startPreviewAnim() {
    if (_previewTimer) clearInterval(_previewTimer);
    _previewTimer=setInterval(()=>{
      const tickers=store.getTickers(), prices=store.getPrices();
      tickers.forEach(sym=>{
        const cell=document.getElementById('prev-'+sym); if(!cell) return;
        const p=prices[sym]; let dir,pct;
        if(p){dir=calcDir(p);pct=fmtPct(p.extChangePct??p.changePct);}
        else{_prevSimTick(sym);const v=_prevSim[sym];dir=v>0?'pos':v<0?'neg':'neu';pct=fmtPct(v);}
        cell.className='prev-cell '+dir;
        const ps=cell.querySelector('.prev-pct'); if(ps) ps.textContent=pct;
      });
    }, 2500);
  }

  return { init, saveApiKey, toggleApiVis, addTicker, deleteTicker, clearAll, fetchAll: fetchAll_admin };
})();
