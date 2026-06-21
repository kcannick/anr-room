'use strict';
// Migration-runner tests. Verifies the versioned migration system:
//  - a fresh DB applies all migrations and records them
//  - re-running is a clean no-op (idempotent)
//  - a DB that already has the columns (hand-applied) doesn't error
//  - the _migrations table tracks what ran
// Uses an isolated SQLite file so it never touches dev/test data.

const fs = require('node:fs');
const TESTDB = './migtest.db';
function clean() { for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TESTDB + s); } catch {} } }

let pass = 0, fail = 0;
function ok(label, cond, extra = '') { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } }

async function freshDb() {
  clean();
  process.env.SQLITE_PATH = TESTDB;
  delete process.env.DATABASE_URL; // force SQLite
  delete require.cache[require.resolve('./db')];
  return require('./db');
}

(async () => {
  console.log('— migration runner —');

  // 1. Fresh DB applies migration 001.
  let db = await freshDb();
  await db.init();
  let applied = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('fresh DB applies 001', applied.includes('001_identity_layer'), JSON.stringify(applied));
  const ucols = (await db.all('PRAGMA table_info(users)', [])).map(c => c.name);
  ok('users.role created', ucols.includes('role'));
  ok('users.phone created', ucols.includes('phone'));
  ok('users.sms_marketing_consent created', ucols.includes('sms_marketing_consent'));
  const scols = (await db.all('PRAGMA table_info(sessions)', [])).map(c => c.name);
  ok('sessions.owner_uid created', scols.includes('owner_uid'));
  const exists = (await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_tokens'", [])).length;
  ok('auth_tokens table created', exists === 1);

  // 2. Re-running init is a clean no-op.
  await db.init();
  const count = (await db.all('SELECT id FROM _migrations', [])).length;
  ok('re-run is idempotent (001 not double-applied)', count === 1, 'count=' + count);

  // 3. A DB that already has the columns (simulates a hand-patched production DB)
  //    must not error, and must still record the migration.
  clean();
  const { DatabaseSync } = require('node:sqlite');
  const s = new DatabaseSync(TESTDB);
  s.exec("CREATE TABLE users (uid TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, first_seen BIGINT, last_seen BIGINT, sessions_played INTEGER DEFAULT 0, lifetime_points INTEGER DEFAULT 0, role TEXT DEFAULT 'player', phone TEXT, sms_marketing_consent INTEGER DEFAULT 0, sms_consent_at BIGINT)");
  s.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, admin_token TEXT, status TEXT DEFAULT 'live', banner_id TEXT, default_minutes INTEGER DEFAULT 5, created_at BIGINT, owner_uid TEXT, scheduled_at BIGINT)");
  s.exec("CREATE TABLE participants (id TEXT PRIMARY KEY, session_id TEXT, user_id TEXT, email TEXT, name TEXT, token TEXT, verified INTEGER DEFAULT 0, total_points INTEGER DEFAULT 0, created_at BIGINT, phone TEXT, sms_marketing_consent INTEGER DEFAULT 0)");
  s.close();
  delete require.cache[require.resolve('./db')];
  db = require('./db');
  let errored = false;
  try { await db.init(); } catch (e) { errored = true; console.log('    error:', e.message); }
  ok('pre-existing columns do not error', !errored);
  const rec = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('migration recorded even when columns pre-existed', rec.includes('001_identity_layer'));

  clean();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
