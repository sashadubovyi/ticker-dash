
'use strict';

const KEY_TICKERS = 'tickerboard_tickers';
const KEY_APIKEY  = 'tickerboard_apikey';
const KEY_PRICES  = 'tickerboard_prices';

const store = {
  getTickers : () => JSON.parse(localStorage.getItem(KEY_TICKERS) || '[]'),
  getApiKey  : () => localStorage.getItem(KEY_APIKEY) || '',
  getPrices  : () => JSON.parse(localStorage.getItem(KEY_PRICES) || '{}'),
  setPrices  : (v) => localStorage.setItem(KEY_PRICES, JSON.stringify(v)),
};

async function fetchStockData() {
    const apiKey = store.getApiKey();
    const tickers = store.getTickers();
    if (!apiKey || tickers.length === 0) return;

    try {
        // Fetching Snapshot for all tickers
        const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.join(',')}&apiKey=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'OK') {
            const newPrices = {};
            data.tickers.forEach(t => {
                // Determine which price to use as primary and what to show as premarket
                const prevClose = t.prevDay.c;
                const lastPrice = t.lastTrade.p || t.day.c || prevClose;
                
                // Extended hours data
                const prePrice = t.min?.c || t.lastTrade.p; 
                const preChange = prePrice - prevClose;
                const preChangePct = (preChange / prevClose) * 100;

                newPrices[t.ticker] = {
                    price: lastPrice,
                    prevClose: prevClose,
                    preMarketPrice: prePrice,
                    preMarketChange: preChange,
                    preMarketChangePct: preChangePct,
                    updated: Date.now()
                };
            });
            store.setPrices(newPrices);
            renderDisplay();
        }
    } catch (e) {
        console.error("Fetch error:", e);
    }
}

function renderDisplay() {
    const grid = document.getElementById('ticker-grid');
    const empty = document.getElementById('empty-state');
    const tickers = store.getTickers();
    const prices = store.getPrices();

    if (tickers.length === 0) {
        grid.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }

    grid.classList.remove('hidden');
    empty.classList.add('hidden');

    // Grid layout logic
    let cols = 1;
    if (tickers.length >= 7) cols = 5;
    else if (tickers.length >= 5) cols = 3;
    else if (tickers.length >= 2) cols = 2;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    grid.innerHTML = tickers.map(sym => {
        const d = prices[sym];
        if (!d) return `<div class="ticker-card"><h1>${sym}</h1><p>Loading...</p></div>`;

        const isPos = d.preMarketChangePct >= 0;
        const colorClass = isPos ? 'pos' : 'neg';
        const arrow = isPos ? '▲' : '▼';

        return `
            <div class="ticker-card ${colorClass}">
                <div class="symbol">${sym}</div>
                <div class="main-price">$${d.price.toFixed(2)}</div>
                <div class="premarket-row">
                    <span class="pre-label">☀️ ПРЕМАРКЕТ</span>
                    <span class="pre-val">${arrow} ${d.preMarketPrice.toFixed(2)}</span>
                    <span class="pre-pct">${isPos ? '+' : ''}${d.preMarketChangePct.toFixed(2)}%</span>
                </div>
            </div>
        `;
    }).join('');
}

// Initial Run
if (document.body.classList.contains('display-screen')) {
    setInterval(fetchStockData, 15000);
    fetchStockData();
    renderDisplay();
    
    // Live Clock
    setInterval(() => {
        const now = new Date();
        document.getElementById('live-clock').innerText = now.toLocaleTimeString('ru-RU');
    }, 1000);
}

// Admin Logic (minimal placeholder to keep file functional if user overwrites)
window.Admin = {
    addTicker: () => {
        const input = document.getElementById('ticker-input');
        const val = input.value.toUpperCase().trim();
        if(!val) return;
        const list = store.getTickers();
        if(!list.includes(val)) {
            list.push(val);
            localStorage.setItem(KEY_TICKERS, JSON.stringify(list));
            location.reload();
        }
    },
    clearAll: () => {
        localStorage.setItem(KEY_TICKERS, '[]');
        location.reload();
    }
};
