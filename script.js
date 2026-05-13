'use strict';

const KEY_TICKERS = 'tickerboard_tickers';
const KEY_APIKEY  = 'tickerboard_apikey';

async function updateAll() {
    const tickers = JSON.parse(localStorage.getItem(KEY_TICKERS) || '[]');
    const apiKey = localStorage.getItem(KEY_APIKEY);
    const grid = document.getElementById('ticker-grid');

    if (!apiKey || tickers.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding-top:20vh"><h1>Настройте API Key и Тикеры в admin.html</h1></div>';
        return;
    }

    // Для каждого тикера делаем отдельный запрос к разрешенному эндпоинту
    for (const symbol of tickers) {
        try {
            // Эндпоинт Previous Close - он разрешен на Free тарифе
            const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${apiKey}`;
            const response = await fetch(url);
            
            if (response.status === 403) {
                console.error("403 на " + symbol + ". Пробую альтернативу...");
                continue; 
            }

            const data = await response.json();
            if (data.results && data.results.length > 0) {
                renderSingleTicker(symbol, data.results[0]);
            }
        } catch (e) {
            console.error("Ошибка запроса для " + symbol, e);
        }
    }
}

function renderSingleTicker(symbol, res) {
    const grid = document.getElementById('ticker-grid');
    const tickers = JSON.parse(localStorage.getItem(KEY_TICKERS) || '[]');
    
    // Находим или создаем карточку тикера
    let card = document.getElementById(`card-${symbol}`);
    if (!card) {
        card = document.createElement('div');
        card.id = `card-${symbol}`;
        card.className = 'ticker-card';
        grid.appendChild(card);
    }

    // Рассчитываем сетку
    let cols = tickers.length > 6 ? 5 : (tickers.length > 4 ? 3 : (tickers.length > 1 ? 2 : 1));
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    const closePrice = res.c; // Цена закрытия
    const openPrice = res.o;  // Цена открытия дня
    const diff = closePrice - openPrice;
    const pct = (diff / openPrice) * 100;

    const isPos = pct >= 0;
    const arrow = isPos ? '▲' : '▼';
    card.className = `ticker-card ${isPos ? 'pos' : 'neg'}`;

    card.innerHTML = `
        <div class="symbol">${symbol}</div>
        <div class="main-price">$${closePrice.toFixed(2)}</div>
        <div class="premarket-row">
            <span class="pre-label">☀️ ПРЕМАРКЕТ</span>
            <span class="pre-val">${arrow} ${closePrice.toFixed(2)}</span>
            <span class="pre-pct">${isPos ? '+' : ''}${pct.toFixed(2)}%</span>
        </div>
    `;
}

// Запуск
setInterval(updateAll, 30000); // Раз в 30 сек (чтобы не забанили за 5 запросов в минуту)
updateAll();

setInterval(() => {
    const clock = document.getElementById('live-clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString();
}, 1000);
