#!/usr/bin/env node
// Throwaway TEST-SESSION helper for the load test.
//
// It talks to whatever DB the environment points at:
//   - default: local SQLite (./anr-room.db) — fine for a dry run
//   - with DATABASE_URL set: your prod Neon DB — THIS is what you want for a real
//     load test, so the burst hits the same database the outage did.
//
// Usage:
//   node docs/loadtest/session.js create          -> prints a new throwaway session id
//   node docs/loadtest/session.js delete <sid>     -> removes it + anything the burst created
//
// Against prod:  DATABASE_URL='postgres://...-pooler...' node docs/loadtest/session.js create
//
// The created session is a normal 'live' rating session named "LOAD TEST — delete me".
// It has no rounds/queue, which is all the read-path burst (/api/session/info) needs.

const crypto = require('crypto');
const db = require('../../db');

const cmd = process.argv[2], arg = process.argv[3];
const now = () => Date.now();

(async () => {
  if (cmd === 'create') {
    const sid = 'lt' + crypto.randomBytes(8).toString('hex').slice(0, 6);
    const adminToken = crypto.randomBytes(18).toString('base64url');
    // Only the NOT-NULL-without-default columns are required; the rest default.
    await db.run(
      'INSERT INTO sessions (id, name, admin_token, status, created_at) VALUES (?,?,?,?,?)',
      [sid, 'LOAD TEST — delete me', adminToken, 'live', now()]
    );
    console.log('✓ Created throwaway test session on', db.engine + ':');
    console.log('    SID   = ' + sid);
    console.log('    burst = /api/session/info?s=' + sid);
    console.log('\nRun the test:');
    console.log('    k6 run -e SID=' + sid + ' docs/loadtest/spike.js');
    console.log('    SID=' + sid + ' bash docs/loadtest/autocannon.sh');
    console.log('\nWhen finished, clean up:');
    console.log('    node docs/loadtest/session.js delete ' + sid);
    process.exit(0);
  }
  if (cmd === 'delete') {
    if (!arg) { console.error('Usage: node docs/loadtest/session.js delete <sid>'); process.exit(1); }
    const parts = await db.all('SELECT id FROM participants WHERE session_id = ?', [arg]).catch(() => []);
    for (const p of parts) await db.run('DELETE FROM votes WHERE participant_id = ?', [p.id]).catch(() => {});
    await db.run('DELETE FROM participants WHERE session_id = ?', [arg]).catch(() => {});
    await db.run('DELETE FROM otps WHERE session_id = ?', [arg]).catch(() => {});
    await db.run('DELETE FROM rounds WHERE session_id = ?', [arg]).catch(() => {});
    await db.run('DELETE FROM sessions WHERE id = ?', [arg]);
    console.log('✓ Deleted test session ' + arg + ' (+ its participants / otps / rounds / votes).');
    process.exit(0);
  }
  console.log('Usage:\n  node docs/loadtest/session.js create\n  node docs/loadtest/session.js delete <sid>');
  process.exit(cmd ? 1 : 0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
