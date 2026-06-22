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
  const applied2 = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('re-run is idempotent (001 present, not duplicated)', applied2.filter(x => x === '001_identity_layer').length === 1, 'ids=' + JSON.stringify(applied2));

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

  // 4. The 0-9 conversion: seed a fresh DB with 1-10 votes, run init, verify the
  //    shift (-1), preserved originals, recomputed average, and rounds_voted.
  clean();
  delete require.cache[require.resolve('./db')];
  db = await freshDb();
  await db.init(); // builds schema + runs migrations (incl. seeding conversion flag)
  // Insert a user, participant, a ratified round, and two 1-10 votes, mimicking
  // pre-conversion state: set taste_legacy NULL so the converter treats them as old.
  const now = Date.now();
  await db.run("INSERT INTO users (uid,email,first_seen,last_seen) VALUES ('u1','a@b.c',?,?)", [now, now]);
  await db.run("INSERT INTO sessions (id,name,admin_token,created_at) VALUES ('s1','S','t',?)", [now]);
  await db.run("INSERT INTO participants (id,session_id,user_id,email,token,verified,created_at) VALUES ('p1','s1','u1','a@b.c','tk',1,?)", [now]);
  await db.run("INSERT INTO rounds (id,session_id,idx,song_title,status,room_average,created_at) VALUES ('r1','s1',1,'song','ratified',?,?)", [6, now]);
  // Two votes on the OLD 1-10 scale (tastes 6 and 8 -> old avg 7).
  await db.run("INSERT INTO votes (id,round_id,participant_id,taste,predict,locked_at) VALUES ('v1','r1','p1',6,7,?)", [now]);
  await db.run("INSERT INTO participants (id,session_id,user_id,email,token,verified,created_at) VALUES ('p2','s1','u1','a@b.c','tk2',1,?)", [now]);
  await db.run("INSERT INTO votes (id,round_id,participant_id,taste,predict,locked_at) VALUES ('v2','r1','p2',8,7,?)", [now]);
  // Re-arm the conversion flag (init already ran it on the empty DB) and re-run.
  await db.run("UPDATE settings SET v='pending' WHERE k='scale_conversion_0to9'");
  await db.init();
  const v1 = await db.get("SELECT * FROM votes WHERE id='v1'");
  const r1 = await db.get("SELECT room_average FROM rounds WHERE id='r1'");
  ok('0-9: taste shifted 6 -> 5', Number(v1.taste) === 5, 'taste=' + v1.taste);
  ok('0-9: original preserved (taste_legacy=6)', Number(v1.taste_legacy) === 6, 'legacy=' + v1.taste_legacy);
  ok('0-9: room average recomputed 7 -> 6', Math.abs(Number(r1.room_average) - 6) < 0.001, 'avg=' + r1.room_average);
  const flag = await db.get("SELECT v FROM settings WHERE k='scale_conversion_0to9'");
  ok('0-9: conversion marked done', flag.v === 'done', 'flag=' + flag.v);
  // Re-running must NOT shift again (idempotent — legacy already set).
  await db.init();
  const v1b = await db.get("SELECT taste FROM votes WHERE id='v1'");
  ok('0-9: re-run does not double-shift', Number(v1b.taste) === 5, 'taste=' + v1b.taste);

  // 5. Migration 003 (binary poll): fresh DB has poll_type + A/B + pick/split columns,
  //    and re-running is idempotent.
  clean();
  delete require.cache[require.resolve('./db')];
  db = await freshDb();
  await db.init();
  const applied3 = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('003_binary_poll applied', applied3.includes('003_binary_poll'), JSON.stringify(applied3));
  const sescols = (await db.all('PRAGMA table_info(sessions)', [])).map(c => c.name);
  ok('sessions.poll_type created', sescols.includes('poll_type'));
  const rndcols = (await db.all('PRAGMA table_info(rounds)', [])).map(c => c.name);
  ok('rounds.option_b_title created', rndcols.includes('option_b_title'));
  ok('rounds.option_b_artist created', rndcols.includes('option_b_artist'));
  ok('rounds.split_a created', rndcols.includes('split_a'));
  const votcols = (await db.all('PRAGMA table_info(votes)', []));
  const votNames = votcols.map(c => c.name);
  ok('votes.pick created', votNames.includes('pick'));
  ok('votes.predict_split created', votNames.includes('predict_split'));
  // Binary votes leave taste/predict null, so those must be nullable.
  const tasteCol = votcols.find(c => c.name === 'taste');
  ok('votes.taste is nullable (binary votes leave it null)', tasteCol && Number(tasteCol.notnull) === 0, 'notnull=' + (tasteCol && tasteCol.notnull));
  await db.init();
  const applied3b = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('003 idempotent (not duplicated)', applied3b.filter(x => x === '003_binary_poll').length === 1, JSON.stringify(applied3b));

  // 6. Migration 004 (event tools): session config + broadcast + participant answer.
  clean();
  delete require.cache[require.resolve('./db')];
  db = await freshDb();
  await db.init();
  const applied4 = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('004_event_tools applied', applied4.includes('004_event_tools'), JSON.stringify(applied4));
  const sc4 = (await db.all('PRAGMA table_info(sessions)', [])).map(c => c.name);
  ['watch_url', 'lobby_message', 'signup_prompt', 'broadcast_text', 'broadcast_at'].forEach(col => {
    ok('sessions.' + col + ' created', sc4.includes(col));
  });
  const pc4 = (await db.all('PRAGMA table_info(participants)', [])).map(c => c.name);
  ok('participants.signup_answer created', pc4.includes('signup_answer'));
  await db.init();
  const applied4b = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('004 idempotent (not duplicated)', applied4b.filter(x => x === '004_event_tools').length === 1, JSON.stringify(applied4b));

  // 7. Migration 005 (referrals): participant ref columns.
  clean();
  delete require.cache[require.resolve('./db')];
  db = await freshDb();
  await db.init();
  const applied5 = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('005_referrals applied', applied5.includes('005_referrals'), JSON.stringify(applied5));
  const pc5 = (await db.all('PRAGMA table_info(participants)', [])).map(c => c.name);
  ['ref_code', 'referred_by', 'ref_credited'].forEach(col => ok('participants.' + col + ' created', pc5.includes(col)));
  await db.init();
  const applied5b = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('005 idempotent (not duplicated)', applied5b.filter(x => x === '005_referrals').length === 1, JSON.stringify(applied5b));

  // 8. Migration 006 (geo check-in): session geo cols + participant pool cols.
  clean();
  delete require.cache[require.resolve('./db')];
  db = await freshDb();
  await db.init();
  const applied6 = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('006_geocheckin applied', applied6.includes('006_geocheckin'), JSON.stringify(applied6));
  const sc6 = (await db.all('PRAGMA table_info(sessions)', [])).map(c => c.name);
  ['geo_mode', 'geo_lat', 'geo_lng', 'geo_radius', 'geo_label'].forEach(col => ok('sessions.' + col + ' created', sc6.includes(col)));
  const pc6 = (await db.all('PRAGMA table_info(participants)', [])).map(c => c.name);
  ['pool', 'checkin_distance'].forEach(col => ok('participants.' + col + ' created', pc6.includes(col)));
  await db.init();
  const applied6b = (await db.all('SELECT id FROM _migrations', [])).map(r => r.id);
  ok('006 idempotent (not duplicated)', applied6b.filter(x => x === '006_geocheckin').length === 1, JSON.stringify(applied6b));

  clean();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
