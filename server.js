'use strict';
const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS ──
const ALLOWED = (process.env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED.includes('*') || !origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ── Safe fetch with timeout ──
async function bfFetch(url, options, ms = 12000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let r;
  try {
    r = await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`Request timed out after ${ms}ms`);
    throw err;
  }
  clearTimeout(timer);
  return r;
}

// ── safeJson: reads .text() first, then JSON.parse ──
// Prevents crashes when Betfair returns HTML error pages.
async function safeJson(r, fallbackKey = 'error') {
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    data = { [fallbackKey]: `Betfair returned a non-JSON response (HTML/plain text). Snippet: ${snippet || '(empty)'}` };
  }
  return { data, ok: r.ok, status: r.status };
}

// ── POST /api/betfair/login ──
app.post('/api/betfair/login', async (req, res) => {
  const { username, password, appKey } = req.body || {};
  if (!username || !password || !appKey)
    return res.status(400).json({ status: 'FAIL', error: 'username, password and appKey are all required' });
  try {
    const r = await bfFetch('https://identitysso.betfair.com/api/login', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Accept':        'application/json',
        'X-Application': appKey,
      },
      body: new URLSearchParams({ username, password }).toString(),
    });
    const { data, status } = await safeJson(r, 'error');
    // Normalise: Betfair may return { status, token } or { loginStatus, sessionToken }
    const normalised = {
      status: data.status || data.loginStatus || (data.token || data.sessionToken ? 'SUCCESS' : 'FAIL'),
      token:  data.token  || data.sessionToken || '',
      error:  data.error  || data.loginStatus  || '',
    };
    res.status(status).json(normalised);
  } catch (err) {
    res.status(502).json({ status: 'FAIL', error: err.message });
  }
});

// ── POST /api/betfair/betting ──
app.post('/api/betfair/betting', async (req, res) => {
  const { sessionToken, appKey, body: bfBody } = req.body || {};
  if (!sessionToken) return res.status(401).json({ error: 'sessionToken required' });
  if (!appKey)       return res.status(401).json({ error: 'appKey required' });
  if (!bfBody)       return res.status(400).json({ error: 'body (JSON-RPC payload) required' });
  try {
    const r = await bfFetch('https://api.betfair.com/exchange/betting/json-rpc/v1', {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'Accept':           'application/json',
        'X-Authentication': sessionToken,
        'X-Application':    appKey,
      },
      body: JSON.stringify(bfBody),
    });
    const { data, status } = await safeJson(r, 'error');
    res.status(status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/betfair/accounts ──
app.post('/api/betfair/accounts', async (req, res) => {
  const { sessionToken, appKey, body: bfBody } = req.body || {};
  if (!sessionToken) return res.status(401).json({ error: 'sessionToken required' });
  if (!appKey)       return res.status(401).json({ error: 'appKey required' });
  try {
    const r = await bfFetch('https://api.betfair.com/exchange/account/json-rpc/v1', {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'Accept':           'application/json',
        'X-Authentication': sessionToken,
        'X-Application':    appKey,
      },
      body: JSON.stringify(bfBody || []),
    });
    const { data, status } = await safeJson(r, 'error');
    res.status(status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /health ──
app.get('/health', (_, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), node: process.version, version: '2' });
});

// ── Global error handler ──
app.use((err, _req, res, _next) => {
  console.error('[proxy]', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`[MatchedEdge proxy v2] port ${PORT} · Node ${process.version}`)
);