// ═══════════════════════════════════════════════════════════════
// XAU/USD INSTITUTIONAL TRADING COMPANY — Hermes Agent Pipeline
// 9 Sub-Agents + CIO Orchestrator + Real-time Dashboard
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const http = require('http');
const fetch = require('node-fetch');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3002;
const DB_PATH = path.join(__dirname, 'xau-agents.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;

// ═══════════════════════════════════════════════════════════════
// DATABASE INIT
// ═══════════════════════════════════════════════════════════════
async function initDB() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();

  // Price history (OHLC per timeframe)
  db.run(`CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price REAL, high REAL, low REAL, open REAL, close REAL,
    volume INTEGER, change REAL, change_pct REAL,
    timeframe TEXT DEFAULT 'M1',
    fetched_at TEXT DEFAULT (datetime('now'))
  )`);

  // Analysis results per cycle
  db.run(`CREATE TABLE IF NOT EXISTS analysis_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id TEXT UNIQUE,
    data_status TEXT,
    bid REAL, ask REAL, spread REAL,
    tech_bias TEXT, tech_score INTEGER,
    fund_bias TEXT, fund_score INTEGER,
    news_permission TEXT,
    final_score INTEGER,
    decision TEXT,
    confidence INTEGER,
    entry REAL, sl REAL, tp1 REAL, tp2 REAL,
    rr REAL, lot_size REAL, risk_pct REAL,
    reasoning TEXT,
    timeframe_json TEXT,
    technical_json TEXT,
    fundamental_json TEXT,
    risk_json TEXT,
    journal TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Trade journal
  db.run(`CREATE TABLE IF NOT EXISTS trade_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id TEXT,
    action TEXT,
    symbol TEXT DEFAULT 'XAU/USD',
    entry REAL, sl REAL, tp1 REAL, tp2 REAL,
    lot_size REAL, risk_pct REAL, rr REAL,
    confidence INTEGER,
    tech_score INTEGER, fund_score INTEGER,
    reasoning TEXT,
    result TEXT,
    pnl REAL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Agent activities
  db.run(`CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT, agent_id TEXT, description TEXT, data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Inter-agent messages
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_agent TEXT, to_agent TEXT, content TEXT,
    type TEXT DEFAULT 'message',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // News events
  db.run(`CREATE TABLE IF NOT EXISTS news_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    headline TEXT, source TEXT, impact TEXT,
    sentiment TEXT, category TEXT,
    agent_id TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Daily stats
  db.run(`CREATE TABLE IF NOT EXISTS daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE,
    total_analyses INTEGER DEFAULT 0,
    buy_signals INTEGER DEFAULT 0,
    sell_signals INTEGER DEFAULT 0,
    wait_signals INTEGER DEFAULT 0,
    no_trade_signals INTEGER DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    max_drawdown REAL DEFAULT 0,
    win_rate REAL DEFAULT 0,
    trades_taken INTEGER DEFAULT 0
  )`);

  saveDB();
  console.log('✅ DB initialized — all tables ready');
}

function queryAll(sql, p = []) {
  const st = db.prepare(sql);
  if (p.length) st.bind(p);
  const r = [];
  while (st.step()) r.push(st.getAsObject());
  st.free();
  return r;
}

function runSQL(sql, p = []) {
  db.run(sql, p);
  const r = db.exec('SELECT last_insert_rowid()');
  return r.length ? r[0].values[0][0] : null;
}

function saveDB() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ═══════════════════════════════════════════════════════════════
// SSE — Real-time push to dashboard
// ═══════════════════════════════════════════════════════════════
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(msg); } catch (e) { sseClients.delete(res); }
  });
}

function logActivity(type, agentId, desc, data = null) {
  runSQL('INSERT INTO activities (type,agent_id,description,data) VALUES (?,?,?,?)',
    [type, agentId, desc, data ? JSON.stringify(data) : null]);
  broadcast('activity', { type, agent_id: agentId, description: desc, data, created_at: new Date().toISOString() });
}

// ═══════════════════════════════════════════════════════════════
// AGENT DEFINITIONS
// ═══════════════════════════════════════════════════════════════
const AGENTS = {
  cio: { id: 'cio', name: 'Hermes CIO', role: '🏦 Chief Investment Officer', color: '#8b5cf6', avatar: '🏦' },
  market_data: { id: 'market-data', name: 'Market Data Agent', role: '📡 Real-time Data Feed', color: '#06b6d4', avatar: '📡' },
  technical: { id: 'technical', name: 'Technical Analyst', role: '📊 Chart & Indicators', color: '#10b981', avatar: '📊' },
  fundamental: { id: 'fundamental', name: 'Fundamental Macro', role: '🏛️ Macro Economics', color: '#f59e0b', avatar: '🏛️' },
  news: { id: 'news', name: 'News & Event Risk', role: '📰 News Intelligence', color: '#ef4444', avatar: '📰' },
  quant: { id: 'quant', name: 'Quant Scoring', role: '🧮 Quantitative Analysis', color: '#6366f1', avatar: '🧮' },
  risk: { id: 'risk', name: 'Risk Manager', role: '🛡️ Risk Control', color: '#f97316', avatar: '🛡️' },
  execution: { id: 'execution', name: 'Execution Agent', role: '⚡ Trade Execution', color: '#14b8a6', avatar: '⚡' },
  journal: { id: 'journal', name: 'Trade Journal', role: '📝 Trade Documentation', color: '#a78bfa', avatar: '📝' },
  killswitch: { id: 'killswitch', name: 'Kill Switch', role: '🚨 Compliance & Safety', color: '#dc2626', avatar: '🚨' }
};

// ═══════════════════════════════════════════════════════════════
// TRADINGVIEW QUOTE FEED — same source family as TradingView embed
// ═══════════════════════════════════════════════════════════════
let tvQuoteCache = null;
let tvQuoteCacheAt = 0;

function packTVMessage(method, params) {
  const payload = JSON.stringify({ m: method, p: params });
  return `~m~${payload.length}~m~${payload}`;
}

function parseTVMessages(data) {
  const s = data.toString();
  const out = [];
  let i = 0;
  while (i < s.length) {
    const a = s.indexOf('~m~', i);
    if (a === -1) break;
    const b = s.indexOf('~m~', a + 3);
    if (b === -1) break;
    const len = parseInt(s.slice(a + 3, b), 10);
    const start = b + 3;
    const payload = s.slice(start, start + len);
    try { out.push(JSON.parse(payload)); } catch (e) {}
    i = start + len;
  }
  return out;
}

async function fetchTradingViewQuote(symbol = 'OANDA:XAUUSD', cacheMs = 4500) {
  const now = Date.now();
  if (tvQuoteCache && tvQuoteCache.symbol === symbol && now - tvQuoteCacheAt < cacheMs) return tvQuoteCache;

  return new Promise((resolve, reject) => {
    const session = 'qs_' + Math.random().toString(36).slice(2, 14);
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?from=chart%2F', {
      headers: {
        Origin: 'https://www.tradingview.com',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    let latest = {};
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      if (latest.price) resolve(latest);
      else reject(new Error('TradingView quote timeout'));
    }, 8000);

    ws.on('open', () => {
      ws.send(packTVMessage('quote_create_session', [session]));
      ws.send(packTVMessage('quote_set_fields', [
        session,
        'lp', 'ch', 'chp', 'bid', 'ask', 'open_price', 'high_price', 'low_price',
        'prev_close_price', 'volume', 'lp_time', 'current_session', 'update_mode',
        'currency_code', 'exchange', 'description', 'short_name', 'pro_name'
      ]));
      ws.send(packTVMessage('quote_add_symbols', [session, symbol]));
      ws.send(packTVMessage('quote_fast_symbols', [session, symbol]));
    });

    ws.on('message', (data) => {
      const text = data.toString();
      if (text.startsWith('~h~')) { ws.send(text); return; }
      for (const msg of parseTVMessages(text)) {
        if (msg.m === 'qsd' && msg.p?.[1]?.s === 'ok') {
          const v = msg.p[1].v || {};
          latest = {
            ...latest,
            symbol,
            price: v.lp !== undefined ? parseFloat(v.lp) : latest.price,
            bid: v.bid !== undefined ? parseFloat(v.bid) : latest.bid,
            ask: v.ask !== undefined ? parseFloat(v.ask) : latest.ask,
            change: v.ch !== undefined ? parseFloat(v.ch) : latest.change,
            changePct: v.chp !== undefined ? parseFloat(v.chp) : latest.changePct,
            dayHigh: v.high_price !== undefined ? parseFloat(v.high_price) : latest.dayHigh,
            dayLow: v.low_price !== undefined ? parseFloat(v.low_price) : latest.dayLow,
            open: v.open_price !== undefined ? parseFloat(v.open_price) : latest.open,
            prevClose: v.prev_close_price !== undefined ? parseFloat(v.prev_close_price) : latest.prevClose,
            volume: v.volume,
            lpTime: v.lp_time,
            session: v.current_session,
            updateMode: v.update_mode,
            exchange: v.exchange,
            description: v.description,
            source: v.exchange ? `TradingView ${symbol} (${v.exchange})` : (latest.source || `TradingView ${symbol}`)
          };
          if (latest.price && latest.bid !== undefined && latest.ask !== undefined) {
            clearTimeout(timer);
            try { ws.close(); } catch {}
            tvQuoteCache = latest;
            tvQuoteCacheAt = Date.now();
            resolve(latest);
          }
        } else if (msg.m === 'critical_error' || msg.m === 'protocol_error') {
          // Ignore until timeout so fallback can still work
        }
      }
    });

    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function fetchBinancePAXG() {
  const binanceResp = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT', { timeout: 5000 });
  const binanceData = await binanceResp.json();
  return {
    price: parseFloat(binanceData.lastPrice),
    change: parseFloat(binanceData.priceChange),
    changePct: parseFloat(binanceData.priceChangePercent),
    dayHigh: parseFloat(binanceData.highPrice),
    dayLow: parseFloat(binanceData.lowPrice),
    bid: parseFloat(binanceData.lastPrice) - 0.15,
    ask: parseFloat(binanceData.lastPrice) + 0.15,
    source: 'Binance PAXG (fallback real-time)'
  };
}

// ═══════════════════════════════════════════════════════════════
// MARKET DATA AGENT
// ═══════════════════════════════════════════════════════════════
async function marketDataAgent() {
  logActivity('analysis', 'market-data', '📡 Fetching real-time XAU/USD data...');

  try {
    // ═══ PRIMARY: TradingView quote feed (same source family as dashboard embed) ═══
    // Symbol matches the TradingView chart: OANDA:XAUUSD
    let realtime = null;
    try {
      realtime = await fetchTradingViewQuote('OANDA:XAUUSD');
      logActivity('analysis', 'market-data', `📡 TradingView OANDA:XAUUSD: $${realtime.price.toFixed(2)} | Bid ${realtime.bid?.toFixed(2)} / Ask ${realtime.ask?.toFixed(2)}`);
    } catch (e) {
      logActivity('analysis', 'market-data', `⚠️ TradingView quote failed: ${e.message}, falling back to Binance PAXG`);
      try {
        realtime = await fetchBinancePAXG();
        logActivity('analysis', 'market-data', `📡 Binance PAXG fallback: $${realtime.price.toFixed(2)} (real-time)`);
      } catch (e2) {
        logActivity('analysis', 'market-data', `⚠️ Binance fallback failed: ${e2.message}, falling back to Yahoo`);
      }
    }

    // ═══ SECONDARY: Yahoo Finance GC=F (OHLC data for technical analysis) ═══
    const resp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    const data = await resp.json();
    const result = data.chart.result[0];
    const meta = result.meta;
    const quotes = result.indicators.quote[0];
    const timestamps = result.timestamp || [];

    const yahooPrice = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose;

    // Use TradingView price if available (matches embed), fallback Binance, otherwise Yahoo (delayed)
    const price = realtime?.price || yahooPrice;
    const change = realtime?.change ?? (price - prevClose);
    const changePct = realtime?.changePct ?? ((change / prevClose) * 100);
    const dayHigh = realtime?.dayHigh || Math.max(...quotes.high.filter(v => v !== null));
    const dayLow = realtime?.dayLow || Math.min(...quotes.low.filter(v => v !== null));

    // Get OHLC candle data from Yahoo for technical analysis
    const closes = quotes.close.filter(v => v !== null);
    const highs = quotes.high.filter(v => v !== null);
    const lows = quotes.low.filter(v => v !== null);
    const opens = quotes.open.filter(v => v !== null);
    const lastClose = closes[closes.length - 1] || price;

    // Use real bid/ask if TradingView provides it; otherwise estimate spread
    const bid = realtime?.bid || (price - 0.15);
    const ask = realtime?.ask || (price + 0.15);
    const spread = +(ask - bid).toFixed(2);

    // Store price
    runSQL('INSERT INTO price_history (price,high,low,open,close,change,change_pct,timeframe) VALUES (?,?,?,?,?,?,?,?)',
      [price, dayHigh, dayLow, prevClose, lastClose, change, changePct.toFixed(2), 'M1']);

    // Build OHLC for multiple timeframes (from Yahoo data)
    const ohlc = buildMultiTimeframeOHLC(timestamps, opens, highs, lows, closes, quotes.volume);

    const source = realtime?.source || 'Yahoo Finance (delayed)';
    const result_data = {
      status: 'OK',
      bid: +bid.toFixed(2),
      ask: +ask.toFixed(2),
      spread,
      price: +price.toFixed(2),
      change: +change.toFixed(2),
      changePct: +changePct.toFixed(2),
      dayHigh: +dayHigh.toFixed(2),
      dayLow: +dayLow.toFixed(2),
      prevClose: +(realtime?.prevClose || prevClose).toFixed(2),
      source,
      realtimeSymbol: realtime?.symbol || null,
      exchange: realtime?.exchange || null,
      updateMode: realtime?.updateMode || null,
      ohlc,
      lastUpdate: new Date().toISOString()
    };

    logActivity('analysis', 'market-data', `📡 Price: $${price.toFixed(2)} (${source}) | Spread: ${spread} | Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct.toFixed(2)}%)`);
    broadcast('price', result_data);
    saveDB();
    return result_data;

  } catch (err) {
    logActivity('error', 'market-data', `❌ Data fetch failed: ${err.message}`);
    return { status: 'FAIL', error: err.message };
  }
}

function buildMultiTimeframeOHLC(timestamps, opens, highs, lows, closes, volumes) {
  const result = { M1: [], M5: [], M15: [], H1: [], H4: [], D1: [] };

  // M1 = raw data (last 300 candles)
  const len = timestamps.length;
  const start = Math.max(0, len - 300);
  for (let i = start; i < len; i++) {
    if (opens[i] && highs[i] && lows[i] && closes[i]) {
      result.M1.push({
        time: timestamps[i] * 1000,
        open: +opens[i].toFixed(2),
        high: +highs[i].toFixed(2),
        low: +lows[i].toFixed(2),
        close: +closes[i].toFixed(2),
        volume: volumes[i] || 0
      });
    }
  }

  // Aggregate M5 (5 candles → 1)
  result.M5 = aggregateCandles(result.M1, 5, 300);
  // Aggregate M15
  result.M15 = aggregateCandles(result.M1, 15, 200);
  // Aggregate H1
  result.H1 = aggregateCandles(result.M1, 60, 100);
  // Aggregate H4
  result.H4 = aggregateCandles(result.M1, 240, 50);
  // Aggregate D1
  result.D1 = aggregateCandles(result.M1, 1440, 30);

  return result;
}

function aggregateCandles(candles, factor, limit) {
  if (!candles.length) return [];
  const result = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (chunk.length === 0) continue;
    result.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + c.volume, 0)
    });
  }
  return result.slice(-limit);
}

// ═══════════════════════════════════════════════════════════════
// TECHNICAL INDICATORS ENGINE (Pure JS — no external TA lib)
// ═══════════════════════════════════════════════════════════════
function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return +ema.toFixed(2);
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(1);
}

function calcMACD(closes) {
  if (closes.length < 26) return null;
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = +(ema12 - ema26).toFixed(2);
  // Signal = 9-period EMA of MACD (simplified)
  const signal = +(macdLine * 0.8).toFixed(2); // simplified
  const histogram = +(macdLine - signal).toFixed(2);
  return { macd: macdLine, signal, histogram, trend: macdLine > 0 ? 'BULLISH' : 'BEARISH' };
}

function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  let atr = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    atr += tr;
  }
  return +(atr / period).toFixed(2);
}

function calcBollinger(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    middle: +sma.toFixed(2),
    upper: +(sma + 2 * std).toFixed(2),
    lower: +(sma - 2 * std).toFixed(2),
    width: +((4 * std / sma) * 100).toFixed(2)
  };
}

function detectCandlePatterns(candles) {
  if (candles.length < 3) return [];
  const patterns = [];
  const c = candles[candles.length - 1]; // current
  const p = candles[candles.length - 2]; // previous
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  // Bullish engulfing
  if (p.close < p.open && c.close > c.open && c.close > p.open && c.open < p.close)
    patterns.push({ name: 'Bullish Engulfing', bias: 'BULLISH', strength: 8 });

  // Bearish engulfing
  if (p.close > p.open && c.close < c.open && c.open > p.close && c.close < p.open)
    patterns.push({ name: 'Bearish Engulfing', bias: 'BEARISH', strength: 8 });

  // Hammer (bullish)
  if (lowerWick > body * 2 && upperWick < body * 0.5 && body > 0)
    patterns.push({ name: 'Hammer', bias: 'BULLISH', strength: 6 });

  // Shooting Star (bearish)
  if (upperWick > body * 2 && lowerWick < body * 0.5 && body > 0)
    patterns.push({ name: 'Shooting Star', bias: 'BEARISH', strength: 6 });

  // Doji
  if (body < range * 0.1 && range > 0)
    patterns.push({ name: 'Doji', bias: 'NEUTRAL', strength: 4 });

  // Pin Bar (bullish)
  if (lowerWick > range * 0.6 && body < range * 0.3)
    patterns.push({ name: 'Pin Bar', bias: 'BULLISH', strength: 7 });

  // Pin Bar (bearish)
  if (upperWick > range * 0.6 && body < range * 0.3)
    patterns.push({ name: 'Pin Bar', bias: 'BEARISH', strength: 7 });

  return patterns;
}

function findSupportResistance(candles, lookback = 50) {
  if (candles.length < lookback) lookback = candles.length;
  const slice = candles.slice(-lookback);
  const highs = slice.map(c => c.high).sort((a, b) => b - a);
  const lows = slice.map(c => c.low).sort((a, b) => a - b);

  // Top 3 resistance levels (highest highs)
  const resistance = [...new Set(highs.slice(0, 5).map(v => +v.toFixed(2)))].slice(0, 3);
  // Top 3 support levels (lowest lows)
  const support = [...new Set(lows.slice(0, 5).map(v => +v.toFixed(2)))].slice(0, 3);

  return { support, resistance };
}

function findSwingPoints(candles, lookback = 20) {
  if (candles.length < lookback) return { swingHigh: null, swingLow: null };
  const slice = candles.slice(-lookback);
  return {
    swingHigh: +Math.max(...slice.map(c => c.high)).toFixed(2),
    swingLow: +Math.min(...slice.map(c => c.low)).toFixed(2)
  };
}

// ═══ FIBONACCI RETRACEMENT ═══
function calcFibonacci(candles, lookback = 100) {
  if (candles.length < lookback) lookback = candles.length;
  const slice = candles.slice(-lookback);
  const high = Math.max(...slice.map(c => c.high));
  const low = Math.min(...slice.map(c => c.low));
  const diff = high - low;

  // Determine trend direction for fib levels
  const firstHalf = slice.slice(0, Math.floor(slice.length / 2));
  const secondHalf = slice.slice(Math.floor(slice.length / 2));
  const firstAvg = firstHalf.reduce((s, c) => s + c.close, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, c) => s + c.close, 0) / secondHalf.length;
  const isUptrend = secondAvg > firstAvg;

  // Fibonacci levels (standard)
  const levels = {
    '0.0': isUptrend ? low : high,
    '0.236': isUptrend ? +(low + diff * 0.236).toFixed(2) : +(high - diff * 0.236).toFixed(2),
    '0.382': isUptrend ? +(low + diff * 0.382).toFixed(2) : +(high - diff * 0.382).toFixed(2),
    '0.5': isUptrend ? +(low + diff * 0.5).toFixed(2) : +(high - diff * 0.5).toFixed(2),
    '0.618': isUptrend ? +(low + diff * 0.618).toFixed(2) : +(high - diff * 0.618).toFixed(2),
    '0.786': isUptrend ? +(low + diff * 0.786).toFixed(2) : +(high - diff * 0.786).toFixed(2),
    '1.0': isUptrend ? high : low,
    '1.272': isUptrend ? +(high + diff * 0.272).toFixed(2) : +(low - diff * 0.272).toFixed(2),
    '1.618': isUptrend ? +(high + diff * 0.618).toFixed(2) : +(low - diff * 0.618).toFixed(2)
  };

  return { levels, trend: isUptrend ? 'UPTREND' : 'DOWNTREND', high, low, diff: +diff.toFixed(2) };
}

// ═══ MARKET STRUCTURE (HH/HL/LH/LL + BOS/CHoCH) ═══
function analyzeMarketStructure(candles, lookback = 50) {
  if (candles.length < 10) return { structure: 'UNKNOWN', swings: [] };
  const slice = candles.slice(-lookback);

  // Find swing highs and swing lows (local extremes)
  const swings = [];
  for (let i = 2; i < slice.length - 2; i++) {
    // Swing high: higher than 2 candles on each side
    if (slice[i].high > slice[i-1].high && slice[i].high > slice[i-2].high &&
        slice[i].high > slice[i+1].high && slice[i].high > slice[i+2].high) {
      swings.push({ type: 'HIGH', price: slice[i].high, index: i });
    }
    // Swing low: lower than 2 candles on each side
    if (slice[i].low < slice[i-1].low && slice[i].low < slice[i-2].low &&
        slice[i].low < slice[i+1].low && slice[i].low < slice[i+2].low) {
      swings.push({ type: 'LOW', price: slice[i].low, index: i });
    }
  }

  if (swings.length < 4) return { structure: 'INSUFFICIENT_DATA', swings };

  // Analyze last 4 swings for structure
  const last4 = swings.slice(-4);
  const highs = last4.filter(s => s.type === 'HIGH');
  const lows = last4.filter(s => s.type === 'LOW');

  let structure = 'RANGING';
  let bias = 'NEUTRAL';

  // Check for Higher Highs and Higher Lows (bullish)
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
    const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
    const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
    const ll = lows[lows.length - 1].price < lows[lows.length - 2].price;

    if (hh && hl) { structure = 'BULLISH_TREND'; bias = 'BULLISH'; }
    else if (lh && ll) { structure = 'BEARISH_TREND'; bias = 'BEARISH'; }
    else if (hh && ll) { structure = 'EXPANSION'; bias = 'VOLATILE'; }
    else if (lh && hl) { structure = 'CONTRACTION'; bias = 'RANGING'; }
  }

  // Break of Structure (BOS) — price broke last swing high/low
  const lastPrice = slice[slice.length - 1].close;
  const lastSwingHigh = highs.length ? highs[highs.length - 1].price : null;
  const lastSwingLow = lows.length ? lows[lows.length - 1].price : null;

  let bos = null;
  if (lastSwingHigh && lastPrice > lastSwingHigh) bos = 'BULLISH_BOS';
  if (lastSwingLow && lastPrice < lastSwingLow) bos = 'BEARISH_BOS';

  return {
    structure,
    bias,
    bos,
    swings: last4.map(s => ({ type: s.type, price: +s.price.toFixed(2) })),
    lastSwingHigh: lastSwingHigh ? +lastSwingHigh.toFixed(2) : null,
    lastSwingLow: lastSwingLow ? +lastSwingLow.toFixed(2) : null
  };
}

// ═══ LIQUIDITY ZONES (Order Blocks + FVG) ═══
function findLiquidityZones(candles, lookback = 30) {
  if (candles.length < 5) return { orderBlocks: [], fvg: [] };
  const slice = candles.slice(-lookback);
  const orderBlocks = [];
  const fvg = [];

  // Order Block: last bearish candle before strong bullish move (or vice versa)
  for (let i = 1; i < slice.length - 1; i++) {
    const prev = slice[i - 1];
    const curr = slice[i];
    const next = slice[i + 1];

    // Bullish Order Block: bearish candle followed by strong bullish move
    if (curr.close < curr.open && next.close > next.open) {
      const bodyNext = Math.abs(next.close - next.open);
      const bodyCurr = Math.abs(curr.close - curr.open);
      if (bodyNext > bodyCurr * 1.5) {
        orderBlocks.push({
          type: 'BULLISH_OB',
          high: +curr.high.toFixed(2),
          low: +curr.low.toFixed(2),
          strength: Math.round(bodyNext / bodyCurr)
        });
      }
    }

    // Bearish Order Block: bullish candle followed by strong bearish move
    if (curr.close > curr.open && next.close < next.open) {
      const bodyNext = Math.abs(next.close - next.open);
      const bodyCurr = Math.abs(curr.close - curr.open);
      if (bodyNext > bodyCurr * 1.5) {
        orderBlocks.push({
          type: 'BEARISH_OB',
          high: +curr.high.toFixed(2),
          low: +curr.low.toFixed(2),
          strength: Math.round(bodyNext / bodyCurr)
        });
      }
    }

    // Fair Value Gap (FVG): gap between candle[i-1].high and candle[i+1].low (bullish)
    if (i >= 2) {
      const c1 = slice[i - 2];
      const c3 = slice[i];
      // Bullish FVG: gap up
      if (c3.low > c1.high) {
        fvg.push({ type: 'BULLISH_FVG', top: +c3.low.toFixed(2), bottom: +c1.high.toFixed(2) });
      }
      // Bearish FVG: gap down
      if (c1.low > c3.high) {
        fvg.push({ type: 'BEARISH_FVG', top: +c1.low.toFixed(2), bottom: +c3.high.toFixed(2) });
      }
    }
  }

  return {
    orderBlocks: orderBlocks.slice(-5), // last 5
    fvg: fvg.slice(-5) // last 5
  };
}

// ═══ STRESS TEST — Test entry against multiple scenarios ═══
function stressTestEntry(entry, sl, tp1, tp2, direction, atr, currentPrice) {
  const scenarios = [];
  const slDist = Math.abs(entry - sl);
  const tp1Dist = Math.abs(tp1 - entry);
  const tp2Dist = Math.abs(tp2 - entry);

  // Scenario 1: Normal move to TP1
  scenarios.push({
    name: 'Normal → TP1',
    probability: 'HIGH',
    result: `Profit $${tp1Dist.toFixed(2)} (${(tp1Dist / slDist).toFixed(1)}R)`,
    verdict: 'PASS'
  });

  // Scenario 2: Spike to SL then reverse to TP (whipsaw)
  scenarios.push({
    name: 'Whipsaw (SL → TP)',
    probability: slDist < atr * 0.5 ? 'LOW' : 'MEDIUM',
    result: `Loss $${slDist.toFixed(2)} then miss profit`,
    verdict: slDist < atr * 0.8 ? 'PASS' : 'WARNING — SL terlalu dekat, rentan whipsaw'
  });

  // Scenario 3: Gap through SL (weekend/news gap)
  const gapRisk = slDist < atr * 0.3 ? 'HIGH' : slDist < atr ? 'MEDIUM' : 'LOW';
  scenarios.push({
    name: 'Gap through SL',
    probability: gapRisk,
    result: `Potential loss > $${slDist.toFixed(2)}`,
    verdict: gapRisk === 'HIGH' ? 'FAIL — SL terlalu ketat untuk gap risk' : 'PASS'
  });

  // Scenario 4: Partial fill then reversal
  scenarios.push({
    name: 'Partial → Reversal',
    probability: 'MEDIUM',
    result: `Hit TP1, miss TP2`,
    verdict: 'PASS — TP1 tercapai'
  });

  // Scenario 5: ATR expansion (volatile move)
  scenarios.push({
    name: 'ATR Expansion (volatile)',
    probability: atr > 15 ? 'HIGH' : 'LOW',
    result: `Price bisa overshoot TP atau SL lebih jauh`,
    verdict: atr > 20 ? 'WARNING — Volatilitas tinggi' : 'PASS'
  });

  // Scenario 6: Trend continuation vs reversal
  const rr1 = tp1Dist / slDist;
  scenarios.push({
    name: 'R:R Validation',
    probability: '-',
    result: `R:R = ${rr1.toFixed(2)} (min 1.5)`,
    verdict: rr1 >= 1.5 ? 'PASS' : 'FAIL — R:R terlalu rendah'
  });

  const passed = scenarios.filter(s => s.verdict === 'PASS').length;
  const total = scenarios.length;
  const stressScore = Math.round((passed / total) * 100);

  return {
    scenarios,
    stressScore,
    passedTests: passed,
    totalTests: total,
    overallVerdict: stressScore >= 70 ? 'PASS' : stressScore >= 50 ? 'WARNING' : 'FAIL'
  };
}

// ═══════════════════════════════════════════════════════════════
// TECHNICAL ANALYST AGENT
// ═══════════════════════════════════════════════════════════════
async function technicalAgent(marketData) {
  logActivity('analysis', 'technical', '📊 Running technical analysis across all timeframes...');

  if (marketData.status !== 'OK' || !marketData.ohlc) {
    return { status: 'FAIL', error: 'No OHLC data' };
  }

  const timeframes = {};
  let totalScore = 0;
  let bullCount = 0;
  let bearCount = 0;

  for (const [tf, candles] of Object.entries(marketData.ohlc)) {
    if (!candles || candles.length < 20) continue;

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const ema200 = calcEMA(closes, Math.min(200, closes.length));
    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);
    const atr = calcATR(highs, lows, closes);
    const bb = calcBollinger(closes);
    const patterns = detectCandlePatterns(candles);
    const levels = findSupportResistance(candles);
    const swings = findSwingPoints(candles);
    const fibonacci = calcFibonacci(candles);
    const marketStructure = analyzeMarketStructure(candles);
    const liquidityZones = findLiquidityZones(candles);
    const lastPrice = closes[closes.length - 1];

    // Determine bias for this timeframe
    let bias = 'NEUTRAL';
    let tfScore = 0;

    // EMA alignment
    if (ema20 && lastPrice > ema20) tfScore += 10;
    if (ema50 && lastPrice > ema50) tfScore += 10;
    if (ema200 && lastPrice > ema200) tfScore += 10;
    if (ema20 && ema50 && ema20 > ema50) tfScore += 5;
    if (ema50 && ema200 && ema50 > ema200) tfScore += 5;

    // RSI
    if (rsi !== null) {
      if (rsi > 50 && rsi < 70) tfScore += 10;
      else if (rsi < 50 && rsi > 30) tfScore -= 10;
      else if (rsi >= 70) tfScore += 5; // overbought but still bullish
      else if (rsi <= 30) tfScore -= 5; // oversold but still bearish
    }

    // MACD
    if (macd) {
      if (macd.trend === 'BULLISH') tfScore += 10;
      else tfScore -= 10;
      if (macd.histogram > 0) tfScore += 5;
      else tfScore -= 5;
    }

    // Candle patterns
    const bullPatterns = patterns.filter(p => p.bias === 'BULLISH');
    const bearPatterns = patterns.filter(p => p.bias === 'BEARISH');
    tfScore += bullPatterns.reduce((s, p) => s + p.strength, 0);
    tfScore -= bearPatterns.reduce((s, p) => s + p.strength, 0);

    // Fibonacci — price near key retracement levels
    if (fibonacci && fibonacci.levels) {
      const fib05 = fibonacci.levels['0.5'];
      const fib0618 = fibonacci.levels['0.618'];
      const fib0382 = fibonacci.levels['0.382'];
      if (fib05 && Math.abs(lastPrice - fib05) < atr * 0.3) tfScore += 5; // near 50% fib
      if (fib0618 && Math.abs(lastPrice - fib0618) < atr * 0.3) tfScore += 8; // near golden ratio
      if (fib0382 && Math.abs(lastPrice - fib0382) < atr * 0.3) tfScore += 5; // near 38.2%
    }

    // Market Structure — HH/HL/LH/LL and BOS
    if (marketStructure) {
      if (marketStructure.structure === 'BULLISH_TREND') tfScore += 12;
      else if (marketStructure.structure === 'BEARISH_TREND') tfScore -= 12;
      if (marketStructure.bos === 'BULLISH_BOS') tfScore += 8;
      else if (marketStructure.bos === 'BEARISH_BOS') tfScore -= 8;
    }

    // Liquidity Zones — Order Blocks and FVG
    if (liquidityZones) {
      const bullOB = liquidityZones.orderBlocks.filter(ob => ob.type === 'BULLISH_OB');
      const bearOB = liquidityZones.orderBlocks.filter(ob => ob.type === 'BEARISH_OB');
      // Price near bullish OB = support = bullish
      for (const ob of bullOB) {
        if (lastPrice >= ob.low && lastPrice <= ob.high) tfScore += 5;
      }
      for (const ob of bearOB) {
        if (lastPrice >= ob.low && lastPrice <= ob.high) tfScore -= 5;
      }
    }

    // Determine bias
    if (tfScore > 15) { bias = 'BULLISH'; bullCount++; }
    else if (tfScore < -15) { bias = 'BEARISH'; bearCount++; }
    else bias = 'NEUTRAL';

    timeframes[tf] = {
      bias,
      score: tfScore,
      lastPrice,
      ema20, ema50, ema200,
      rsi,
      macd,
      atr,
      bollinger: bb,
      patterns,
      support: levels.support,
      resistance: levels.resistance,
      swingHigh: swings.swingHigh,
      swingLow: swings.swingLow,
      fibonacci: fibonacci ? fibonacci.levels : null,
      fibTrend: fibonacci ? fibonacci.trend : null,
      marketStructure: marketStructure ? marketStructure.structure : null,
      structureBias: marketStructure ? marketStructure.bias : null,
      bos: marketStructure ? marketStructure.bos : null,
      orderBlocks: liquidityZones ? liquidityZones.orderBlocks : [],
      fvg: liquidityZones ? liquidityZones.fvg : []
    };

    totalScore += tfScore;
  }

  // Overall technical score (0-100)
  const rawScore = totalScore / Object.keys(timeframes).length;
  const techScore = Math.max(0, Math.min(100, 50 + rawScore));

  let overallBias = 'NEUTRAL';
  if (bullCount > bearCount + 1) overallBias = 'BULLISH';
  else if (bearCount > bullCount + 1) overallBias = 'BEARISH';

  const result = {
    status: 'OK',
    bias: overallBias,
    score: Math.round(techScore),
    timeframes,
    bullTimeframes: bullCount,
    bearTimeframes: bearCount,
    neutralTimeframes: Object.keys(timeframes).length - bullCount - bearCount
  };

  logActivity('analysis', 'technical', `📊 Tech Bias: ${overallBias} | Score: ${Math.round(techScore)}/100 | Bull TFs: ${bullCount} | Bear TFs: ${bearCount}`);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// FUNDAMENTAL MACRO AGENT
// ═══════════════════════════════════════════════════════════════
async function fundamentalAgent() {
  logActivity('analysis', 'fundamental', '🏛️ Analyzing macro fundamentals...');

  try {
    // Fetch DXY (US Dollar Index)
    let dxyData = null;
    try {
      const dxyResp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
      });
      const dxyJson = await dxyResp.json();
      const dxyMeta = dxyJson.chart.result[0].meta;
      dxyData = {
        price: dxyMeta.regularMarketPrice,
        prevClose: dxyMeta.chartPreviousClose,
        change: dxyMeta.regularMarketPrice - dxyMeta.chartPreviousClose
      };
    } catch (e) { /* DXY unavailable */ }

    // Fetch US 10Y Yield
    let yield10y = null;
    try {
      const yResp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
      });
      const yJson = await yResp.json();
      const yMeta = yJson.chart.result[0].meta;
      yield10y = {
        price: yMeta.regularMarketPrice,
        prevClose: yMeta.chartPreviousClose,
        change: yMeta.regularMarketPrice - yMeta.chartPreviousClose
      };
    } catch (e) { /* yield unavailable */ }

    // Analyze USD bias
    let usdBias = 'NEUTRAL';
    let yieldBias = 'NEUTRAL';
    let fedBias = 'NEUTRAL'; // placeholder — would need FOMC data
    let inflationBias = 'NEUTRAL'; // placeholder — would need CPI data
    let safeHaven = 'MODERATE';
    let fundScore = 50; // start neutral

    // DXY analysis
    if (dxyData) {
      if (dxyData.change < -0.3) {
        usdBias = 'BEARISH';
        fundScore += 15; // weak USD = good for gold
      } else if (dxyData.change > 0.3) {
        usdBias = 'BULLISH';
        fundScore -= 15; // strong USD = bad for gold
      }
    }

    // Yield analysis
    if (yield10y) {
      if (yield10y.change < -0.02) {
        yieldBias = 'FALLING';
        fundScore += 10; // falling yields = good for gold
      } else if (yield10y.change > 0.02) {
        yieldBias = 'RISING';
        fundScore -= 10; // rising yields = bad for gold
      }
    }

    // Gold as safe haven (hardcoded sentiment based on recent geopolitical climate)
    // In production, this would come from news sentiment analysis
    safeHaven = 'MODERATE';
    fundScore += 5; // slight positive for gold as safe haven

    const result = {
      status: 'OK',
      bias: fundScore > 55 ? 'BULLISH' : fundScore < 45 ? 'BEARISH' : 'NEUTRAL',
      score: Math.max(0, Math.min(100, fundScore)),
      dxy: dxyData,
      yield10y,
      usdBias,
      yieldBias,
      fedBias,
      inflationBias,
      safeHaven,
      eventRisk: 'LOW' // would check calendar in production
    };

    logActivity('analysis', 'fundamental', `🏛️ Fund Bias: ${result.bias} | Score: ${result.score}/100 | USD: ${usdBias} | Yields: ${yieldBias}`);
    return result;

  } catch (err) {
    logActivity('error', 'fundamental', `❌ Fundamental analysis failed: ${err.message}`);
    return { status: 'WARNING', bias: 'NEUTRAL', score: 50, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// NEWS & EVENT RISK AGENT
// ═══════════════════════════════════════════════════════════════
async function newsAgent() {
  logActivity('analysis', 'news', '📰 Scraping news from multiple sources...');

  try {
    const now = new Date();
    const hour = now.getUTCHours();
    const dayOfWeek = now.getUTCDay();

    let eventRisk = 'LOW';
    let newsPermission = 'ALLOW';
    let highImpactEvents = [];
    let newsHeadlines = [];
    let sentiment = 'NEUTRAL';

    // ═══ TIME-BASED EVENT BLOCKING ═══
    if (dayOfWeek === 5 && hour >= 13 && hour <= 14) {
      eventRisk = 'HIGH';
      newsPermission = 'BLOCK';
      highImpactEvents.push({ event: 'Potential NFP Window', time: '13:30 UTC', impact: 'HIGH' });
    }
    if (hour >= 13 && hour <= 14) {
      eventRisk = 'MEDIUM';
    }
    if (dayOfWeek === 3 && hour >= 18 && hour <= 19) {
      eventRisk = 'EXTREME';
      newsPermission = 'BLOCK';
      highImpactEvents.push({ event: 'Potential FOMC Window', time: '18:00 UTC', impact: 'EXTREME' });
    }

    // ═══ SCRAPE ACTUAL NEWS FROM MULTIPLE SOURCES ═══
    const searchQueries = [
      'gold+price+today+XAU',
      'Trump+tariff+trade+war+2026',
      'Strait+of+Hormuz+conflict',
      'Federal+Reserve+interest+rate',
      'US+inflation+CPI+NFP',
      'geopolitical+risk+gold'
    ];

    let allHeadlines = [];

    for (const query of searchQueries) {
      try {
        const resp = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 8000
        });
        const html = await resp.text();
        // Extract titles from DuckDuckGo HTML results
        const titleRegex = /class="result__a"[^>]*>([^<]+)/g;
        let match;
        let count = 0;
        while ((match = titleRegex.exec(html)) !== null && count < 3) {
          const title = match[1].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
          if (title.length > 10) {
            allHeadlines.push({ title, source: query.split('+')[0], query });
            count++;
          }
        }
      } catch (e) {
        // Skip failed queries silently
      }
    }

    // ═══ ANALYZE NEWS SENTIMENT ═══
    let bullishCount = 0;
    let bearishCount = 0;

    const bullishKeywords = ['gold rally', 'gold surge', 'safe haven', 'geopolitical risk', 'inflation rise',
      'fed cut', 'rate cut', 'dovish', 'gold demand', 'central bank buy', 'war', 'conflict', 'crisis',
      'uncertainty', 'tariff', 'trade war', 'hormuz', 'iran', 'sanctions'];
    const bearishKeywords = ['gold fall', 'gold drop', 'gold decline', 'strong dollar', 'rate hike',
      'hawkish', 'risk on', 'peace deal', 'ceasefire', 'negotiation', 'trade deal', 'gold sell',
      'dollar strength', 'yields rise'];

    for (const headline of allHeadlines) {
      const lower = headline.title.toLowerCase();
      for (const kw of bullishKeywords) {
        if (lower.includes(kw)) { bullishCount++; break; }
      }
      for (const kw of bearishKeywords) {
        if (lower.includes(kw)) { bearishCount++; break; }
      }

      // Check for Trump-related headlines (high impact)
      if (lower.includes('trump') || lower.includes('tariff') || lower.includes('trade war')) {
        highImpactEvents.push({ event: headline.title.substring(0, 80), source: headline.source, impact: 'HIGH' });
      }

      // Check for Hormuz/Iran (high impact)
      if (lower.includes('hormuz') || lower.includes('iran') || lower.includes('strait')) {
        highImpactEvents.push({ event: headline.title.substring(0, 80), source: headline.source, impact: 'HIGH' });
      }
    }

    // Determine sentiment
    if (bullishCount > bearishCount + 2) sentiment = 'BULLISH';
    else if (bearishCount > bullishCount + 2) sentiment = 'BEARISH';
    else sentiment = 'NEUTRAL';

    // If extreme geopolitical news, increase event risk
    if (highImpactEvents.length > 3) {
      eventRisk = 'HIGH';
    }

    newsHeadlines = allHeadlines.slice(0, 10).map(h => h.title);

    const result = {
      status: 'OK',
      permission: newsPermission,
      eventRisk,
      highImpactEvents: highImpactEvents.slice(0, 5),
      blockedWindows: highImpactEvents.length,
      headlines: newsHeadlines,
      sentiment,
      bullishSignals: bullishCount,
      bearishSignals: bearishCount,
      totalNewsScraped: allHeadlines.length,
      message: newsPermission === 'BLOCK'
        ? `🚫 News BLOCK — ${highImpactEvents.map(e => e.event).join(', ')}`
        : `✅ ${allHeadlines.length} news scraped | Sentiment: ${sentiment} (Bull: ${bullishCount} / Bear: ${bearishCount})`
    };

    logActivity('analysis', 'news', `📰 ${allHeadlines.length} news scraped | Sentiment: ${sentiment} | Bull: ${bullishCount} | Bear: ${bearishCount} | Risk: ${eventRisk}`);
    return result;

  } catch (err) {
    logActivity('error', 'news', `❌ News check failed: ${err.message}`);
    return { status: 'WARNING', permission: 'BLOCK', eventRisk: 'HIGH', error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// QUANT SCORING AGENT
// ═══════════════════════════════════════════════════════════════
function quantAgent(techResult, fundResult, newsResult, riskCondition) {
  logActivity('analysis', 'quant', '🧮 Calculating quantitative confidence score...');

  const techScore = techResult.score || 0;
  const fundScore = fundResult.score || 0;
  const priceActionScore = calcPriceActionScore(techResult);
  const riskConditionScore = riskCondition || 70;

  // Weighted scoring
  const finalScore = Math.round(
    techScore * 0.45 +
    fundScore * 0.30 +
    priceActionScore * 0.15 +
    riskConditionScore * 0.10
  );

  // Conflict penalty
  let adjustedScore = finalScore;
  const techBias = techResult.bias || 'NEUTRAL';
  const fundBias = fundResult.bias || 'NEUTRAL';

  if ((techBias === 'BULLISH' && fundBias === 'BEARISH') ||
      (techBias === 'BEARISH' && fundBias === 'BULLISH')) {
    adjustedScore -= 20;
    logActivity('analysis', 'quant', `⚠️ Tech/Fund conflict detected — confidence reduced by 20`);
  }

  // News penalty
  if (newsResult.permission === 'BLOCK') {
    adjustedScore = 0;
  }

  adjustedScore = Math.max(0, Math.min(100, adjustedScore));

  let decision = 'NO TRADE';
  if (adjustedScore >= 75) {
    if (techBias === 'BULLISH' && (fundBias === 'BULLISH' || fundBias === 'NEUTRAL'))
      decision = 'BUY';
    else if (techBias === 'BEARISH' && (fundBias === 'BEARISH' || fundBias === 'NEUTRAL'))
      decision = 'SELL';
    else
      decision = 'WAIT';
  } else if (adjustedScore >= 60) {
    decision = 'WAIT';
  }

  const result = {
    finalScore: adjustedScore,
    components: {
      techScore: Math.round(techScore),
      fundScore: Math.round(fundScore),
      priceActionScore: Math.round(priceActionScore),
      riskConditionScore: Math.round(riskConditionScore)
    },
    weights: { tech: '45%', fund: '30%', priceAction: '15%', riskCondition: '10%' },
    decision,
    conflictPenalty: (techBias === 'BULLISH' && fundBias === 'BEARISH') || (techBias === 'BEARISH' && fundBias === 'BULLISH'),
    newsBlocked: newsResult.permission === 'BLOCK'
  };

  logActivity('analysis', 'quant', `🧮 Final Score: ${adjustedScore}/100 | Decision: ${decision}`);
  return result;
}

function calcPriceActionScore(techResult) {
  let score = 50;
  const h1 = techResult.timeframes?.H1;
  const m15 = techResult.timeframes?.M15;

  if (h1?.patterns?.length > 0) {
    const bullP = h1.patterns.filter(p => p.bias === 'BULLISH').length;
    const bearP = h1.patterns.filter(p => p.bias === 'BEARISH').length;
    score += (bullP - bearP) * 10;
  }
  if (m15?.patterns?.length > 0) {
    const bullP = m15.patterns.filter(p => p.bias === 'BULLISH').length;
    const bearP = m15.patterns.filter(p => p.bias === 'BEARISH').length;
    score += (bullP - bearP) * 8;
  }

  return Math.max(0, Math.min(100, score));
}

// ═══════════════════════════════════════════════════════════════
// RISK MANAGER AGENT
// ═══════════════════════════════════════════════════════════════
function riskManager(quantResult, marketData, techResult, config) {
  logActivity('analysis', 'risk', '🛡️ Calculating risk parameters...');

  const equity = config.equity || 1000;
  const riskPct = config.riskPercent || 0.5;
  const maxDailyLoss = config.maxDailyLoss || 2;
  const minRR = config.minRR || 1.5;

  const price = marketData.price;
  const spread = marketData.spread || 0.30;
  const decision = quantResult.decision;

  if (decision === 'NO TRADE' || decision === 'WAIT') {
    return {
      decision: 'NO TRADE',
      reason: decision === 'NO TRADE' ? 'Score below threshold' : 'Waiting for better setup',
      lotSize: 0, entry: 0, sl: 0, tp1: 0, tp2: 0, rr: 0, riskAmount: 0
    };
  }

  // Get ATR from H1 for SL calculation
  const h1 = techResult.timeframes?.H1;
  const atr = h1?.atr || 10; // default 10 points if unavailable

  let entry, sl, tp1, tp2;
  const atrBuffer = atr * 0.3;

  if (decision === 'BUY') {
    entry = price;
    // SL below recent swing low or ATR-based
    const swingLow = h1?.swingLow || (price - atr * 1.5);
    sl = Math.min(swingLow - atrBuffer, price - atr * 1.2);
    // TP1 = nearest resistance or 1.5R
    const resistance = h1?.resistance?.[0] || (price + atr * 2);
    tp1 = Math.max(resistance, price + (price - sl) * 1.5);
    // TP2 = 2R or next resistance
    const resistance2 = h1?.resistance?.[1] || (price + atr * 3);
    tp2 = Math.max(resistance2, price + (price - sl) * 2);
  } else {
    entry = price;
    // SL above recent swing high or ATR-based
    const swingHigh = h1?.swingHigh || (price + atr * 1.5);
    sl = Math.max(swingHigh + atrBuffer, price + atr * 1.2);
    // TP1 = nearest support or 1.5R
    const support = h1?.support?.[0] || (price - atr * 2);
    tp1 = Math.min(support, price - (sl - price) * 1.5);
    // TP2 = 2R or next support
    const support2 = h1?.support?.[1] || (price - atr * 3);
    tp2 = Math.min(support2, price - (sl - price) * 2);
  }

  const slDistance = Math.abs(entry - sl);
  const tp1Distance = Math.abs(tp1 - entry);
  const rr = +(tp1Distance / slDistance).toFixed(2);

  // Check R:R
  if (rr < minRR) {
    return {
      decision: 'NO TRADE',
      reason: `R:R ${rr} below minimum ${minRR}`,
      lotSize: 0, entry: +entry.toFixed(2), sl: +sl.toFixed(2),
      tp1: +tp1.toFixed(2), tp2: +tp2.toFixed(2), rr, riskAmount: 0
    };
  }

  // Check spread
  if (spread > 1.0) {
    return {
      decision: 'NO TRADE',
      reason: `Spread ${spread} too high`,
      lotSize: 0, entry: 0, sl: 0, tp1: 0, tp2: 0, rr: 0, riskAmount: 0
    };
  }

  // Calculate lot size
  // For XAU/USD: 1 lot = 100 oz, pip value = $1 per 0.01 move per 0.01 lot
  const riskAmount = equity * (riskPct / 100);
  const slPips = slDistance; // in price points
  // Lot size = risk amount / (SL distance * pip value per lot)
  // For gold: 1 standard lot = $1 per 0.01 move = $100 per 1.0 move
  const lotSize = Math.max(0.01, +(riskAmount / (slDistance * 100)).toFixed(2));

  // ═══ STRESS TEST THE ENTRY ═══
  const stressTest = stressTestEntry(entry, sl, tp1, tp2, decision, atr, price);

  // If stress test fails, block the trade
  if (stressTest.overallVerdict === 'FAIL') {
    return {
      decision: 'NO TRADE',
      reason: `Stress test FAILED: ${stressTest.passedTests}/${stressTest.totalTests} passed`,
      lotSize: 0, entry: +entry.toFixed(2), sl: +sl.toFixed(2),
      tp1: +tp1.toFixed(2), tp2: +tp2.toFixed(2), rr, riskAmount: 0,
      stressTest
    };
  }

  const result = {
    decision,
    entry: +entry.toFixed(2),
    sl: +sl.toFixed(2),
    tp1: +tp1.toFixed(2),
    tp2: +tp2.toFixed(2),
    rr,
    lotSize,
    riskAmount: +riskAmount.toFixed(2),
    riskPct,
    slDistance: +slDistance.toFixed(2),
    spread,
    equity,
    maxDailyLoss,
    atrBuffer: +atrBuffer.toFixed(2),
    stressTest
  };

  logActivity('analysis', 'risk', `🛡️ ${decision} | Entry: ${entry.toFixed(2)} | SL: ${sl.toFixed(2)} | TP1: ${tp1.toFixed(2)} | R:R: ${rr} | Lot: ${lotSize} | Stress: ${stressTest.overallVerdict} (${stressTest.passedTests}/${stressTest.totalTests})`);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// EXECUTION AGENT
// ═══════════════════════════════════════════════════════════════
function executionAgent(quantResult, riskResult, newsResult, marketData) {
  logActivity('analysis', 'execution', '⚡ Evaluating execution permission...');

  const reasons = [];
  let permission = 'ALLOW';

  // Check all blocking conditions
  if (quantResult.finalScore < 75) {
    permission = 'BLOCK';
    reasons.push(`Score ${quantResult.finalScore} < 75`);
  }
  if (newsResult.permission === 'BLOCK') {
    permission = 'BLOCK';
    reasons.push('High-impact news event');
  }
  if (marketData.status !== 'OK') {
    permission = 'BLOCK';
    reasons.push('Market data unavailable');
  }
  if (riskResult.decision === 'NO TRADE') {
    permission = 'BLOCK';
    reasons.push(riskResult.reason || 'Risk limits exceeded');
  }
  if (marketData.spread > 1.0) {
    permission = 'BLOCK';
    reasons.push(`Spread ${marketData.spread} too high`);
  }
  if (riskResult.rr < 1.5) {
    permission = 'BLOCK';
    reasons.push(`R:R ${riskResult.rr} < 1.5`);
  }

  const result = {
    permission,
    action: permission === 'ALLOW' ? riskResult.decision : 'NO TRADE',
    reasons: reasons.length ? reasons : ['All checks passed'],
    timestamp: new Date().toISOString()
  };

  logActivity('analysis', 'execution', `⚡ Execution: ${result.permission} | Action: ${result.action}`);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// TRADE JOURNAL AGENT
// ═══════════════════════════════════════════════════════════════
function journalAgent(cycleData) {
  const cycleId = `CYC-${Date.now()}`;

  // Support both raw pipeline data and buildFinalResult output
  const md = cycleData.marketData || cycleData.market_price || {};
  const tech = cycleData.technical || cycleData.technical_analysis || {};
  const fund = cycleData.fundamental || cycleData.fundamental_analysis || {};
  const news = cycleData.news || {};
  const quant = cycleData.quant || cycleData.decision || {};
  const risk = cycleData.risk || cycleData.risk_management || {};
  const exec = cycleData.execution || cycleData.decision || {};

  runSQL(`INSERT INTO analysis_cycles (
    cycle_id, data_status, bid, ask, spread,
    tech_bias, tech_score, fund_bias, fund_score,
    news_permission, final_score, decision, confidence,
    entry, sl, tp1, tp2, rr, lot_size, risk_pct,
    reasoning, timeframe_json, technical_json, fundamental_json, risk_json, journal
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    cycleId,
    md.status || cycleData.data_status || 'OK',
    md.bid || 0,
    md.ask || 0,
    md.spread || 0,
    tech.bias || tech.trend || 'NEUTRAL',
    tech.score || 0,
    fund.bias || fund.usd_bias || 'NEUTRAL',
    fund.score || 0,
    news.permission || cycleData.execution_permission || 'BLOCK',
    quant.finalScore || quant.confidence_score || 0,
    exec.action || quant.decision || 'NO TRADE',
    quant.finalScore || quant.confidence_score || 0,
    risk.entry || risk.entry || 0,
    risk.sl || risk.stop_loss || 0,
    risk.tp1 || risk.take_profit_1 || 0,
    risk.tp2 || risk.take_profit_2 || 0,
    risk.rr || risk.risk_reward_ratio || 0,
    risk.lotSize || risk.lot_size || 0,
    risk.riskPct || risk.risk_percent || 0,
    exec.reasons ? exec.reasons.join('; ') : (cycleData.human_summary || ''),
    JSON.stringify(tech.timeframes || cycleData.timeframe_bias || {}),
    JSON.stringify(tech),
    JSON.stringify(fund),
    JSON.stringify(risk),
    cycleData.humanSummary || cycleData.human_summary || ''
  ]);

  // Also log to trade journal if actionable signal
  const action = exec.action || quant.decision || 'NO TRADE';
  if (['BUY', 'SELL'].includes(action)) {
    runSQL(`INSERT INTO trade_journal (
      cycle_id, action, entry, sl, tp1, tp2, lot_size, risk_pct, rr,
      confidence, tech_score, fund_score, reasoning
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      cycleId,
      action,
      risk.entry || 0,
      risk.sl || risk.stop_loss || 0,
      risk.tp1 || risk.take_profit_1 || 0,
      risk.tp2 || risk.take_profit_2 || 0,
      risk.lotSize || risk.lot_size || 0,
      risk.riskPct || risk.risk_percent || 0,
      risk.rr || risk.risk_reward_ratio || 0,
      quant.finalScore || quant.confidence_score || 0,
      tech.score || 0,
      fund.score || 0,
      exec.reasons ? exec.reasons.join('; ') : (cycleData.human_summary || '')
    ]);
  }

  saveDB();
  logActivity('analysis', 'journal', `📝 Cycle ${cycleId} logged | Action: ${action}`);
  return cycleId;
}

// ═══════════════════════════════════════════════════════════════
// KILL SWITCH AGENT
// ═══════════════════════════════════════════════════════════════
function killSwitchAgent(marketData, newsResult, config) {
  const alerts = [];
  let status = 'SAFE';

  // Data quality check
  if (marketData.status !== 'OK') {
    alerts.push('🚨 Market data feed DOWN — all trading blocked');
    status = 'KILLED';
  }

  // Spread check
  if (marketData.spread > (config.maxSpread || 1.0)) {
    alerts.push(`🚨 Spread ${marketData.spread} exceeds max ${config.maxSpread || 1.0}`);
    status = 'KILLED';
  }

  // News risk
  if (newsResult.eventRisk === 'EXTREME') {
    alerts.push('🚨 EXTREME event risk — all trading blocked');
    status = 'KILLED';
  }

  // Daily loss check (would check actual PnL in production)
  // Placeholder: check if too many signals today
  const todaySignals = queryAll(
    "SELECT COUNT(*) as cnt FROM analysis_cycles WHERE date(created_at) = date('now') AND decision IN ('BUY','SELL')"
  );
  if (todaySignals[0]?.cnt > 50) {
    alerts.push('🚨 Too many signals today — possible overtrading');
    status = 'WARNING';
  }

  const result = {
    status,
    alerts,
    tradingAllowed: status === 'SAFE',
    timestamp: new Date().toISOString()
  };

  if (alerts.length) {
    logActivity('analysis', 'killswitch', alerts.join(' | '));
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// CIO ORCHESTRATOR — Full Pipeline
// ═══════════════════════════════════════════════════════════════
async function runFullPipeline(config = {}) {
  const startTime = Date.now();
  logActivity('pipeline', 'cio', '🏦 ═══ STARTING FULL ANALYSIS PIPELINE ═══');

  const mergedConfig = {
    equity: 1000,
    riskPercent: 0.5,
    maxDailyLoss: 2,
    maxSpread: 1.0,
    minRR: 1.5,
    mode: 'conservative',
    ...config
  };

  // Step 1: Market Data
  broadcast('agent-status', { agent: 'market-data', status: 'running' });
  const marketData = await marketDataAgent();
  broadcast('agent-status', { agent: 'market-data', status: marketData.status === 'OK' ? 'done' : 'error' });

  if (marketData.status !== 'OK') {
    const result = buildFinalResult('FAIL', null, null, null, null, null, null, 'Data feed failure — NO TRADE', mergedConfig);
    broadcast('pipeline-result', result);
    return result;
  }

  // Step 2: Technical Analysis
  broadcast('agent-status', { agent: 'technical', status: 'running' });
  const techResult = await technicalAgent(marketData);
  broadcast('agent-status', { agent: 'technical', status: techResult.status === 'OK' ? 'done' : 'error' });

  // Step 3: Fundamental Analysis
  broadcast('agent-status', { agent: 'fundamental', status: 'running' });
  const fundResult = await fundamentalAgent();
  broadcast('agent-status', { agent: 'fundamental', status: fundResult.status === 'OK' ? 'done' : 'error' });

  // Step 4: News & Event Risk
  broadcast('agent-status', { agent: 'news', status: 'running' });
  const newsResult = await newsAgent();
  broadcast('agent-status', { agent: 'news', status: 'done' });

  // Step 5: Kill Switch Check
  broadcast('agent-status', { agent: 'killswitch', status: 'running' });
  const killResult = killSwitchAgent(marketData, newsResult, mergedConfig);
  broadcast('agent-status', { agent: 'killswitch', status: killResult.tradingAllowed ? 'done' : 'error' });

  if (!killResult.tradingAllowed) {
    const result = buildFinalResult('OK', marketData, techResult, fundResult, newsResult,
      { finalScore: 0, decision: 'NO TRADE', components: {} },
      { decision: 'NO TRADE', entry: 0, sl: 0, tp1: 0, tp2: 0, rr: 0, lotSize: 0, riskAmount: 0 },
      `KILL SWITCH: ${killResult.alerts.join('; ')}`, mergedConfig);
    broadcast('pipeline-result', result);
    journalAgent(result);
    return result;
  }

  // Step 6: Quant Scoring
  broadcast('agent-status', { agent: 'quant', status: 'running' });
  const quantResult = quantAgent(techResult, fundResult, newsResult, killResult.status === 'SAFE' ? 80 : 50);
  broadcast('agent-status', { agent: 'quant', status: 'done' });

  // Step 7: Risk Management
  broadcast('agent-status', { agent: 'risk', status: 'running' });
  const riskResult = riskManager(quantResult, marketData, techResult, mergedConfig);
  broadcast('agent-status', { agent: 'risk', status: 'done' });

  // Step 8: Execution Decision
  broadcast('agent-status', { agent: 'execution', status: 'running' });
  const execResult = executionAgent(quantResult, riskResult, newsResult, marketData);
  broadcast('agent-status', { agent: 'execution', status: 'done' });

  // Step 9: Build final result
  const humanSummary = buildHumanSummary(marketData, techResult, fundResult, newsResult, quantResult, riskResult, execResult);
  const result = buildFinalResult('OK', marketData, techResult, fundResult, newsResult, quantResult, riskResult, humanSummary, mergedConfig);
  result.execution = execResult;
  result.killSwitch = killResult;

  // Step 10: Journal
  const cycleId = journalAgent(result);
  result.cycleId = cycleId;

  const elapsed = Date.now() - startTime;
  result.elapsed_ms = elapsed;

  logActivity('pipeline', 'cio', `🏦 ═══ PIPELINE COMPLETE — ${execResult.action} in ${elapsed}ms ═══`);
  broadcast('pipeline-result', result);
  return result;
}

function buildFinalResult(dataStatus, marketData, techResult, fundResult, newsResult, quantResult, riskResult, humanSummary, config) {
  return {
    timestamp: new Date().toISOString(),
    symbol: 'XAU/USD',
    data_status: dataStatus,
    market_price: marketData ? {
      bid: marketData.bid,
      ask: marketData.ask,
      spread: marketData.spread,
      price: marketData.price,
      change: marketData.change,
      changePct: marketData.changePct,
      dayHigh: marketData.dayHigh,
      dayLow: marketData.dayLow,
      source: marketData.source,
      realtimeSymbol: marketData.realtimeSymbol,
      exchange: marketData.exchange,
      updateMode: marketData.updateMode
    } : null,
    timeframe_bias: techResult?.timeframes ? Object.fromEntries(
      Object.entries(techResult.timeframes).map(([k, v]) => [k, v.bias])
    ) : {},
    technical_analysis: techResult ? {
      trend: techResult.bias,
      score: techResult.score,
      bullTimeframes: techResult.bullTimeframes,
      bearTimeframes: techResult.bearTimeframes,
      details: techResult.timeframes
    } : null,
    fundamental_analysis: fundResult ? {
      usd_bias: fundResult.usdBias,
      yield_bias: fundResult.yieldBias,
      fed_bias: fundResult.fedBias,
      safe_haven: fundResult.safeHaven,
      event_risk: fundResult.eventRisk,
      score: fundResult.score
    } : null,
    news_analysis: newsResult ? {
      sentiment: newsResult.sentiment,
      event_risk: newsResult.eventRisk,
      permission: newsResult.permission,
      bullish_signals: newsResult.bullishSignals,
      bearish_signals: newsResult.bearishSignals,
      total_scraped: newsResult.totalNewsScraped,
      headlines: newsResult.headlines,
      high_impact_events: newsResult.highImpactEvents,
      message: newsResult.message
    } : null,
    risk_management: riskResult ? {
      account_equity: config.equity,
      risk_percent: riskResult.riskPct,
      lot_size: riskResult.lotSize,
      entry: riskResult.entry,
      stop_loss: riskResult.sl,
      take_profit_1: riskResult.tp1,
      take_profit_2: riskResult.tp2,
      risk_reward_ratio: riskResult.rr,
      sl_distance: riskResult.slDistance,
      risk_amount: riskResult.riskAmount
    } : null,
    decision: {
      action: quantResult?.decision || 'NO TRADE',
      confidence_score: quantResult?.finalScore || 0,
      reason: humanSummary,
      invalid_if: riskResult?.decision === 'NO TRADE' ? riskResult.reason : ''
    },
    execution_permission: (newsResult?.permission === 'ALLOW' && ['BUY','SELL'].includes(riskResult?.decision)) ? 'ALLOW' : 'BLOCK',
    human_summary: humanSummary,
    config
  };
}

function buildHumanSummary(marketData, techResult, fundResult, newsResult, quantResult, riskResult, execResult) {
  const parts = [];
  parts.push(`💰 XAU/USD: $${marketData.price.toFixed(2)} (${marketData.change >= 0 ? '+' : ''}${marketData.change.toFixed(2)})`);
  parts.push(`📊 Tech: ${techResult.bias} (${techResult.score}/100) | Fund: ${fundResult.bias} (${fundResult.score}/100)`);
  parts.push(`🎯 Score: ${quantResult.finalScore}/100 | Decision: ${execResult.action}`);

  if (['BUY', 'SELL'].includes(execResult.action)) {
    parts.push(`📍 Entry: ${riskResult.entry} | SL: ${riskResult.sl} | TP1: ${riskResult.tp1} | TP2: ${riskResult.tp2}`);
    parts.push(`⚖️ R:R: ${riskResult.rr} | Lot: ${riskResult.lotSize} | Risk: ${riskResult.riskPct}%`);
  }

  if (newsResult.permission === 'BLOCK') {
    parts.push(`🚫 News block: ${newsResult.highImpactEvents.map(e => e.event).join(', ')}`);
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// SSE stream
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Run full analysis pipeline
app.post('/api/analyze', async (req, res) => {
  const config = req.body || {};
  const result = await runFullPipeline(config);
  res.json(result);
});

// Quick price check
app.get('/api/price', async (req, res) => {
  const data = await marketDataAgent();
  res.json(data);
});

// Get latest analysis (reconstruct full format for dashboard)
app.get('/api/latest', (req, res) => {
  const rows = queryAll('SELECT * FROM analysis_cycles ORDER BY id DESC LIMIT 1');
  if (!rows.length) return res.json({ message: 'No analysis yet' });
  const r = rows[0];
  // Reconstruct the format dashboard expects
  let tfBias = {};
  try { tfBias = JSON.parse(r.timeframe_json || '{}'); } catch(e) {}
  let techJson = {};
  try { techJson = JSON.parse(r.tech_bias ? '{}' : '{}'); } catch(e) {}
  let fundJson = {};
  try { fundJson = JSON.parse(r.fundamental_json || '{}'); } catch(e) {}
  let riskJson = {};
  try { riskJson = JSON.parse(r.risk_json || '{}'); } catch(e) {}
  // Parse nested JSON strings
  try { tfBias = typeof tfBias === 'string' ? JSON.parse(tfBias) : tfBias; } catch(e) {}
  try {
    const raw = r.technical_json || '{}';
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') techJson = JSON.parse(parsed);
    else techJson = parsed;
  } catch(e) { techJson = {}; }

  res.json({
    timestamp: r.created_at,
    symbol: 'XAU/USD',
    data_status: r.data_status,
    market_price: { bid: r.bid, ask: r.ask, spread: r.spread, price: r.bid },
    timeframe_bias: tfBias,
    technical_analysis: {
      trend: r.tech_bias,
      score: r.tech_score,
      bullTimeframes: techJson.bullTimeframes || 0,
      bearTimeframes: techJson.bearTimeframes || 0
    },
    fundamental_analysis: {
      usd_bias: fundJson.usd_bias || r.fund_bias,
      yield_bias: fundJson.yield_bias || '--',
      fed_bias: fundJson.fed_bias || '--',
      safe_haven: fundJson.safe_haven || '--',
      event_risk: fundJson.event_risk || '--',
      score: r.fund_score
    },
    risk_management: {
      entry: r.entry,
      stop_loss: r.sl,
      take_profit_1: r.tp1,
      take_profit_2: r.tp2,
      risk_reward_ratio: r.rr,
      lot_size: r.lot_size,
      risk_amount: riskJson.risk_amount || 0,
      risk_percent: r.risk_pct
    },
    decision: {
      action: r.decision,
      confidence_score: r.confidence || r.final_score
    },
    execution_permission: r.news_permission,
    human_summary: r.journal
  });
});

// Get analysis history
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = queryAll('SELECT * FROM analysis_cycles ORDER BY id DESC LIMIT ?', [limit]);
  res.json(rows);
});

// Get trade journal
app.get('/api/journal', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = queryAll('SELECT * FROM trade_journal ORDER BY id DESC LIMIT ?', [limit]);
  res.json(rows);
});

// Get activities
app.get('/api/activities', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const rows = queryAll('SELECT * FROM activities ORDER BY id DESC LIMIT ?', [limit]);
  res.json(rows);
});

// Get price history
app.get('/api/prices', (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const rows = queryAll('SELECT * FROM price_history ORDER BY id DESC LIMIT ?', [limit]);
  res.json(rows);
});

// Get daily stats
app.get('/api/stats', (req, res) => {
  const total = queryAll('SELECT COUNT(*) as cnt FROM analysis_cycles');
  const buys = queryAll("SELECT COUNT(*) as cnt FROM analysis_cycles WHERE decision='BUY'");
  const sells = queryAll("SELECT COUNT(*) as cnt FROM analysis_cycles WHERE decision='SELL'");
  const waits = queryAll("SELECT COUNT(*) as cnt FROM analysis_cycles WHERE decision='WAIT'");
  const noTrades = queryAll("SELECT COUNT(*) as cnt FROM analysis_cycles WHERE decision='NO TRADE'");
  const journal = queryAll('SELECT COUNT(*) as cnt FROM trade_journal');
  res.json({
    totalAnalyses: total[0]?.cnt || 0,
    buySignals: buys[0]?.cnt || 0,
    sellSignals: sells[0]?.cnt || 0,
    waitSignals: waits[0]?.cnt || 0,
    noTradeSignals: noTrades[0]?.cnt || 0,
    tradesJournal: journal[0]?.cnt || 0
  });
});

// OHLC endpoint for candlestick chart
app.get('/api/ohlc', async (req, res) => {
  const tf = req.query.tf || 'M5';
  try {
    const resp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    const data = await resp.json();
    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const quotes = result.indicators.quote[0];
    const opens = quotes.open;
    const highs = quotes.high;
    const lows = quotes.low;
    const closes = quotes.close;

    // Build raw M1 candles
    const m1 = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (opens[i] && highs[i] && lows[i] && closes[i]) {
        m1.push({
          time: timestamps[i],
          open: +opens[i].toFixed(2),
          high: +highs[i].toFixed(2),
          low: +lows[i].toFixed(2),
          close: +closes[i].toFixed(2)
        });
      }
    }

    // Aggregate based on timeframe
    const factors = { M1: 1, M5: 5, M15: 15, H1: 60, H4: 240 };
    const factor = factors[tf] || 5;
    const candles = [];
    for (let i = 0; i < m1.length; i += factor) {
      const chunk = m1.slice(i, i + factor);
      if (!chunk.length) continue;
      candles.push({
        time: chunk[0].time,
        open: chunk[0].open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[chunk.length - 1].close
      });
    }

    res.json({ timeframe: tf, candles });
  } catch (err) {
    res.json({ error: err.message, candles: [] });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════
async function start() {
  await initDB();
  server.listen(PORT, () => {
    console.log(`\n🏦 ═══════════════════════════════════════════════`);
    console.log(`🏦 XAU/USD INSTITUTIONAL TRADING COMPANY`);
    console.log(`🏦 Dashboard: http://localhost:${PORT}`);
    console.log(`🏦 API: http://localhost:${PORT}/api/analyze`);
    console.log(`🏦 SSE: http://localhost:${PORT}/api/stream`);
    console.log(`🏦 ═══════════════════════════════════════════════\n`);
  });
}

start().catch(console.error);
