// Vercel entry point. Vercel runs this as a Node serverless function and
// forwards all matching requests here.
//
// The server module exports a Node http.Server plus an `ensureInit()` helper
// that creates the database schema (idempotent, memoized). We make sure the
// schema exists before handling the first request on a cold start, then hand
// the request to the server's listener.
//
// REQUIRED env var on Vercel: DATABASE_URL (Postgres). The serverless
// filesystem is read-only/ephemeral, so SQLite won't persist — the app
// auto-switches to Postgres when DATABASE_URL is set.
const server = require('../server');

module.exports = async (req, res) => {
  try {
    await server.ensureInit();
  } catch (e) {
    console.error('DB init failed:', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Database not ready. Is DATABASE_URL set?' }));
    return;
  }
  server.emit('request', req, res);
};
