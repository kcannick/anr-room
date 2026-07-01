'use strict';
// Realtime (Ably) — a progressive enhancement over polling.
//
// When ABLY_API_KEY is set, the server publishes a tiny "change" signal to a per-session
// channel whenever something material happens (round opens/closes/ratifies/extends, a
// broadcast, go-live), and mints short-lived SUBSCRIBE-ONLY tokens for browsers. Clients
// refresh the instant they get a signal instead of polling every couple seconds.
//
// When the key is absent, or Ably errors, every function here is a safe no-op and clients
// keep polling exactly as before — so there is no regression and no hard dependency.
//
// REST (not Realtime) client: stateless, serverless-friendly — publishing is a single HTTP
// call with nothing to keep alive between invocations. Publishes are awaited by callers but
// wrapped non-fatal: a realtime hiccup must never break the underlying action.

const KEY = process.env.ABLY_API_KEY || '';
const ENABLED = !!KEY;
let rest = null;

function client() {
  if (!ENABLED) return null;
  if (rest) return rest;
  try {
    const Ably = require('ably');
    rest = new Ably.Rest({ key: KEY });
  } catch (e) {
    console.error('[realtime] init failed:', e.message);
    rest = null;
  }
  return rest;
}

const channelName = (sessionId) => `anr:session:${sessionId}`;

function isEnabled() { return ENABLED; }

// Publish a change signal for a session. `kind` is a hint ('round'|'vote'|'leaderboard'|
// 'broadcast'|'status') the client can use; the client mostly just refreshes on any signal.
// Awaitable + non-fatal. No debounce here: on serverless a deferred timer would be frozen
// after the response, so we publish inline; the client coalesces bursts into one refresh.
async function publish(sessionId, kind, data) {
  const c = client();
  if (!c || !sessionId) return;
  const msg = { kind: kind || 'state', at: Date.now() };
  if (data) msg.payload = data;   // optional payload (e.g. the recomputed leaderboard) clients apply directly
  try {
    await c.channels.get(channelName(sessionId)).publish('change', msg);
  } catch (e) {
    console.error('[realtime] publish failed:', e.message);
  }
}

// Mint a subscribe-only TokenRequest scoped to this session's channel. Returned to the
// browser, which hands it to Ably; the API key itself never leaves the server.
async function tokenRequest(sessionId, clientId) {
  const c = client();
  if (!c || !sessionId) return null;
  const capability = {};
  capability[channelName(sessionId)] = ['subscribe'];
  return c.auth.createTokenRequest({ capability: JSON.stringify(capability), clientId: clientId || undefined });
}

module.exports = { isEnabled, publish, tokenRequest, channelName };
