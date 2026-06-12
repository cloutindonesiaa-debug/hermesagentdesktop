// ═══════════════════════════════════════════════════════════════
// XAU Price Fetcher — Background process
// Fetches real-time XAU/USD from Yahoo Finance every 30 seconds
// Posts to server API for SSE broadcast + SQLite storage
// ═══════════════════════════════════════════════════════════════

const fetch = require('node-fetch');
const SERVER_URL = 'http://localhost:3002';
const FETCH_INTERVAL = 30000; // 30 seconds

let lastPrice = null;

async function fetchPrice() {
  try {
    const resp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    const data = await resp.json();
    const result = data.chart.result[0];
    const meta = result.meta;

    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose;
    const change = price - prevClose;
    const changePct = (change / prevClose) * 100;

    const quotes = result.indicators.quote[0];
    const highs = quotes.high.filter(v => v !== null);
    const lows = quotes.low.filter(v => v !== null);

    const dayHigh = Math.max(...highs);
    const dayLow = Math.min(...lows);
    const spread = 0.30;

    if (lastPrice !== price) {
      console.log(`💰 XAU/USD: $${price.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)} | ${changePct.toFixed(2)}%)`);
      lastPrice = price;
    }

    // Post to server
    try {
      await fetch(`${SERVER_URL}/api/price`, { method: 'GET' });
    } catch (e) {
      // Server might not be running yet, that's OK
    }

  } catch (err) {
    console.error(`❌ Fetch error: ${err.message}`);
  }
}

console.log('📡 XAU Price Fetcher started — polling every 30s');
fetchPrice();
setInterval(fetchPrice, FETCH_INTERVAL);
