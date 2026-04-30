// ─────────────────────────────────────────────────────────────────
// MatchedEdge CORS Proxy — server.js
// Node.js + Express proxy for Betfair API
// ─────────────────────────────────────────────────────────────────
// BACKEND FLAG: This server MUST run separately from the frontend.
// All Betfair endpoints are CORS-blocked in browsers.
// ─────────────────────────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS: Allow your frontend origin ──
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*', // Restrict in production!
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-BF-Token', 'X-Application'],
}));
app.use(express.json());

// ── Betfair Identity (Login) ──
// BACKEND FLAG: certlogin requires client certificate (.crt + .key)
// For non-interactive login, use the API-NG Bot Login instead.
app.post('/api/betfair/login', async (req, res) => {
  const { username, password, appKey } = req.body;
  if (!username || !password || !appKey) {
    return res.status(400).json({ error: 'username, password, appKey required' });
  }
  try {
    const params = new URLSearchParams({ username, password });
    const resp = await fetch('https://identitysso.betfair.com/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'X-Application': appKey,
      },
      body: params.toString(),
    });
    const data = await resp.json();
    res.json(data); // { token, status, error }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Betfair Betting API (all JSON-RPC calls) ──
// BACKEND FLAG: Requires valid session token from login.
app.post('/api/betfair/betting', async (req, res) => {
  const { sessionToken, appKey, endpoint, body: bfBody } = req.body;
  if (!sessionToken || !appKey) {
    return res.status(401).json({ error: 'sessionToken and appKey required' });
  }
  const BF_API = 'https://api.betfair.com/exchange/betting/json-rpc/v1';
  try {
    const resp = await fetch(BF_API, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'X-Authentication': sessionToken,
        'X-Application':    appKey,
      },
      body: JSON.stringify(bfBody),
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Accounts API ──
app.post('/api/betfair/accounts', async (req, res) => {
  const { sessionToken, appKey, body: bfBody } = req.body;
  const ACCT_API = 'https://api.betfair.com/exchange/account/json-rpc/v1';
  try {
    const resp = await fetch(ACCT_API, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'Accept':           'application/json',
        'X-Authentication': sessionToken,
        'X-Application':    appKey,
      },
      body: JSON.stringify(bfBody),
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

app.listen(PORT, () => {
  console.log(`MatchedEdge proxy running on port ${PORT}`);
});