'use strict';
// Database layer. Auto-selects Postgres when DATABASE_URL is set, otherwise
// falls back to a local SQLite file (built into Node 22 — no native build step).

const crypto = require('node:crypto');
// Compact url-safe id generator (used by the user-backfill migration).
function genId(n = 12) {
  return crypto.randomBytes(Math.ceil(n * 0.75)).toString('base64url').slice(0, n);
}

//
// Exposes one async interface used by the rest of the app:
//   db.run(sql, params)   -> { changes }            (INSERT/UPDATE/DELETE)
//   db.get(sql, params)   -> single row | undefined (SELECT ... LIMIT 1)
//   db.all(sql, params)   -> array of rows          (SELECT)
//   db.tx(fn)             -> run fn inside a transaction
//
// SQL is written with `?` placeholders and translated to `$1,$2,...` for PG.

const USE_PG = !!process.env.DATABASE_URL;

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ----- schema (portable across both engines) -----
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     admin_token TEXT NOT NULL,             -- legacy per-session admin secret (fallback)
     owner_uid TEXT,                         -- the host (user) who owns this session
     status TEXT NOT NULL DEFAULT 'live',   -- upcoming | live | completed | archived
     scheduled_at BIGINT,                    -- when an 'upcoming' session is set to start
     banner_id TEXT,                         -- optional session-level ad override
     default_minutes INTEGER NOT NULL DEFAULT 5, -- per-session default voting window
     created_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     uid TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,           -- durable identity across all sessions
     name TEXT,
     role TEXT NOT NULL DEFAULT 'player',  -- player | host | admin
     phone TEXT,                            -- optional; captured at registration
     sms_marketing_consent INTEGER NOT NULL DEFAULT 0,  -- explicit, separate opt-in (TCPA)
     sms_consent_at BIGINT,                 -- timestamp proof of consent
     first_seen BIGINT NOT NULL,
     last_seen BIGINT NOT NULL,
     sessions_played INTEGER NOT NULL DEFAULT 0,
     rounds_voted INTEGER NOT NULL DEFAULT 0,  -- lifetime count of rounds voted in (all sessions)
     lifetime_points INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (
     token TEXT PRIMARY KEY,
     uid TEXT NOT NULL,                     -- which user this login belongs to
     created_at BIGINT NOT NULL,
     last_used BIGINT NOT NULL,
     expires_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS participants (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     user_id TEXT,                          -- links to users.uid (durable identity)
     email TEXT NOT NULL,
     name TEXT,
     phone TEXT,                            -- optional; captured at registration
     sms_marketing_consent INTEGER NOT NULL DEFAULT 0,  -- explicit opt-in for this signup
     token TEXT NOT NULL,                    -- player auth token (cookie)
     verified INTEGER NOT NULL DEFAULT 0,
     total_points INTEGER NOT NULL DEFAULT 0,
     created_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS otps (
     email TEXT NOT NULL,
     session_id TEXT NOT NULL,
     code TEXT NOT NULL,
     expires_at BIGINT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS rounds (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     idx INTEGER NOT NULL,                   -- 1-based round number
     queue_pos INTEGER NOT NULL DEFAULT 0,   -- ordering within the pending queue
     song_title TEXT NOT NULL,
     song_artist TEXT,
     song_note TEXT,                         -- freeform info from admin
     giveaway TEXT,                          -- optional prize description
     banner_id TEXT,                         -- optional per-song ad override
     status TEXT NOT NULL DEFAULT 'pending', -- pending | voting | closed | ratified
     opens_at BIGINT,
     closes_at BIGINT,
     room_average REAL,
     created_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS votes (
     id TEXT PRIMARY KEY,
     round_id TEXT NOT NULL,
     participant_id TEXT NOT NULL,
     taste INTEGER NOT NULL,                 -- 0..9 (their rating)
     predict REAL NOT NULL,                  -- 0.0..9.0 (room avg guess)
     locked_at BIGINT NOT NULL,
     points INTEGER,                         -- filled at ratify
     err REAL,                               -- |predict - room_average|
     tier TEXT,                              -- bullseye|sharp|close|off|wayoff (results reaction)
     rank INTEGER,
     taste_legacy INTEGER,                   -- preserved pre-0-9 rating (null if born on 0-9)
     predict_legacy REAL                     -- preserved pre-0-9 prediction
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_vote ON votes (round_id, participant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_part_session ON participants (session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_round_session ON rounds (session_id)`,
  `CREATE TABLE IF NOT EXISTS banners (
     id TEXT PRIMARY KEY,
     session_id TEXT,                        -- owning session (null for the global default)
     label TEXT,                             -- admin-facing name, e.g. "House banner"
     image_data TEXT NOT NULL,               -- data URI (base64) of the banner image
     link_url TEXT,                          -- optional click-through; opens in a new tab
     created_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     k TEXT PRIMARY KEY,
     v TEXT
   )`,
];

let impl;

if (USE_PG) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    max: 5,
  });
  impl = {
    async run(sql, params = []) {
      const r = await pool.query(toPg(sql), params);
      return { changes: r.rowCount };
    },
    async get(sql, params = []) {
      const r = await pool.query(toPg(sql), params);
      return r.rows[0];
    },
    async all(sql, params = []) {
      const r = await pool.query(toPg(sql), params);
      return r.rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txDb = {
          async run(sql, p = []) { const r = await client.query(toPg(sql), p); return { changes: r.rowCount }; },
          async get(sql, p = []) { const r = await client.query(toPg(sql), p); return r.rows[0]; },
          async all(sql, p = []) { const r = await client.query(toPg(sql), p); return r.rows; },
        };
        const out = await fn(txDb);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async init(opts = {}) {
      // PG needs BIGINT/REAL which our portable schema already uses; INTEGER bools are fine.
      for (const s of SCHEMA) await pool.query(s);
      // Versioned migrations: ordered, run-once, loud on failure. Replaces the old
      // boot-time ALTER blocks (which failed silently and raced on cold starts).
      await runMigrations(impl);
      // allowHeavy=true ONLY when run from the standalone migrate script (no time limit).
      // On the serverless boot path it's false, so heavy data conversions are skipped
      // (and logged) rather than risking a mid-conversion timeout.
      await postMigrate(impl, { allowHeavy: opts.allowHeavy === true });
    },
  };
} else {
  const { DatabaseSync } = require('node:sqlite');
  const path = process.env.SQLITE_PATH || './roomtone.db';
  const sdb = new DatabaseSync(path);
  sdb.exec('PRAGMA journal_mode = WAL;');
  // node:sqlite is synchronous; we wrap in async to match the PG interface.
  impl = {
    async run(sql, params = []) {
      const info = sdb.prepare(sql).run(...params);
      return { changes: Number(info.changes) };
    },
    async get(sql, params = []) {
      return sdb.prepare(sql).get(...params);
    },
    async all(sql, params = []) {
      return sdb.prepare(sql).all(...params);
    },
    async tx(fn) {
      sdb.exec('BEGIN');
      try {
        const txDb = {
          async run(sql, p = []) { const i = sdb.prepare(sql).run(...p); return { changes: Number(i.changes) }; },
          async get(sql, p = []) { return sdb.prepare(sql).get(...p); },
          async all(sql, p = []) { return sdb.prepare(sql).all(...p); },
        };
        const out = await fn(txDb);
        sdb.exec('COMMIT');
        return out;
      } catch (e) {
        sdb.exec('ROLLBACK');
        throw e;
      }
    },
    async init(opts = {}) {
      for (const s of SCHEMA) sdb.exec(s);
      // Versioned migrations (see runMigrations). SQLite lacks ADD COLUMN IF NOT
      // EXISTS, so the runner treats "duplicate column" as already-applied.
      await runMigrations(impl);
      // Local SQLite has no serverless time limit; default allowHeavy=true unless
      // a caller explicitly passes false. (Tests can pass false to exercise the gate.)
      await postMigrate(impl, { allowHeavy: opts.allowHeavy !== false });
    },
  };
}

// ---- versioned migration runner ----
// Applies numbered .sql files from ./migrations exactly once, in order, recording
// each in a _migrations table. Fails LOUDLY (throws) on any real error — no silent
// catch — so a broken migration surfaces immediately in logs instead of as a
// downstream "column does not exist" crash. Safe under concurrent cold starts: on
// Postgres it takes a transaction-scoped advisory lock so only one instance migrates
// at a time; the others wait, then see the rows already applied and skip.
const fs = require('node:fs');
const pathMod = require('node:path');

function loadMigrationFiles() {
  const dir = pathMod.join(__dirname, 'migrations');
  let files;
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files
    .filter(f => /^\d+.*\.sql$/.test(f))
    .sort() // zero-padded numeric prefixes sort correctly as strings
    .map(f => ({
      id: f.replace(/\.sql$/, ''),
      statements: fs.readFileSync(pathMod.join(dir, f), 'utf8')
        .split(/^--->$/m)               // statements separated by a line of just --->
        .map(s => s.replace(/^\s*--.*$/gm, '').trim()) // strip comment-only lines
        .filter(Boolean),
    }));
}

// Is this error just "the column already exists"? (SQLite has no ADD COLUMN IF NOT
// EXISTS, so re-applying 001 on an already-migrated SQLite DB hits this — benign.)
function isDuplicateColumn(e) {
  const m = (e && e.message || '').toLowerCase();
  return m.includes('duplicate column') || m.includes('already exists');
}

async function runMigrations(db) {
  await db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at BIGINT NOT NULL
  )`);
  const migrations = loadMigrationFiles();
  if (!migrations.length) return;

  // Serialize concurrent migrators (Postgres only; SQLite init is single-process).
  if (USE_PG) { try { await db.run('SELECT pg_advisory_lock(727274)'); } catch {} }
  try {
    const done = await db.all('SELECT id FROM _migrations', []);
    const applied = new Set(done.map(r => r.id));
    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      console.log(`[migrate] applying ${m.id} (${m.statements.length} statements)…`);
      for (let stmt of m.statements) {
        // SQLite doesn't support ADD COLUMN IF NOT EXISTS — strip it and rely on the
        // duplicate-column catch below for idempotency. Postgres keeps IF NOT EXISTS.
        if (!USE_PG) stmt = stmt.replace(/ADD COLUMN IF NOT EXISTS/gi, 'ADD COLUMN');
        try {
          await db.run(stmt);
        } catch (e) {
          if (isDuplicateColumn(e)) continue; // already present — fine
          // Real failure: stop everything and make it visible.
          console.error(`[migrate] FAILED on ${m.id}: ${e.message}\n  statement: ${stmt.slice(0, 120)}`);
          throw new Error(`Migration ${m.id} failed: ${e.message}`);
        }
      }
      await db.run('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)', [m.id, Date.now()]);
      console.log(`[migrate] ${m.id} ✓`);
    }
  } finally {
    if (USE_PG) { try { await db.run('SELECT pg_advisory_unlock(727274)'); } catch {} }
  }
}

// Data backfill that must run AFTER schema migrations (idempotent — safe every boot):
//  1. Fold existing participants into deduped users (by email) + link user_id.
//  2. Recompute per-user sessions_played / lifetime_points.
//  3. Promote the configured ADMIN_EMAIL to role='admin'.
// (Legacy status mapping moved into migration 001.)
//
// opts.allowHeavy gates HEAVY data conversions (row-by-row recomputes that can exceed
// a serverless time limit). On the boot path allowHeavy is false, so heavy work is
// skipped + logged with instructions to run `node migrate.js` instead. This prevents
// the class of mid-conversion timeout that a boot-time data migration can cause.
async function postMigrate(db, opts = {}) {
  const allowHeavy = opts.allowHeavy === true;
  let orphans;
  try {
    orphans = await db.all("SELECT * FROM participants WHERE user_id IS NULL OR user_id = ''", []);
  } catch { return; } // tables may not exist yet on a brand-new DB
  for (const p of (orphans || [])) {
    const em = (p.email || '').toLowerCase();
    if (!em) continue;
    let user = await db.get('SELECT * FROM users WHERE email = ?', [em]);
    if (!user) {
      const uid = genId(12);
      const ts = Number(p.created_at) || Date.now();
      await db.run('INSERT INTO users (uid, email, name, first_seen, last_seen, sessions_played, lifetime_points) VALUES (?,?,?,?,?,0,0)',
        [uid, em, p.name || '', ts, ts]);
      user = { uid };
    }
    await db.run('UPDATE participants SET user_id = ? WHERE id = ?', [user.uid, p.id]);
  }
  // Recompute sessions_played and lifetime_points from the now-linked data.
  const users = await db.all('SELECT uid FROM users', []);
  for (const u of users) {
    const sc = await db.get('SELECT COUNT(DISTINCT session_id) AS c FROM participants WHERE user_id = ?', [u.uid]);
    const pc = await db.get('SELECT COALESCE(SUM(total_points),0) AS s FROM participants WHERE user_id = ?', [u.uid]);
    await db.run('UPDATE users SET sessions_played = ?, lifetime_points = ? WHERE uid = ?',
      [Number(sc.c) || 0, Number(pc.s) || 0, u.uid]);
  }
  // Promote the configured admin (only affects the row once it exists).
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (adminEmail) {
    await db.run("UPDATE users SET role = 'admin' WHERE email = ?", [adminEmail]).catch(() => {});
  }

  // --- HEAVY data conversions: only run from the standalone migrate script ---
  // Each entry is a one-time, flag-guarded conversion. If pending but not allowed
  // (i.e. we're on the serverless boot path), we DON'T run it — we log a clear
  // instruction. This is the guard that prevents boot-time conversion timeouts.
  await runHeavyConversions(db, allowHeavy);
}

// Registry of heavy, one-time data conversions. Add future ones here. Each is
// {flag, label, run}. They only execute when allowHeavy is true (the migrate script);
// on boot they're detected-and-deferred with a loud log line.
async function runHeavyConversions(db, allowHeavy) {
  const heavy = [
    { flag: 'scale_conversion_0to9', label: '1-10 -> 0-9 scale conversion', run: convertScaleTo09 },
  ];
  for (const h of heavy) {
    let row;
    try { row = await db.get('SELECT v FROM settings WHERE k = ?', [h.flag]); }
    catch { continue; } // settings table not present yet
    if (!row || row.v !== 'pending') continue; // not requested, or already done
    if (!allowHeavy) {
      console.warn(`[migrate] DEFERRED heavy conversion "${h.label}" — not run on the ` +
        `serverless boot path (would risk a timeout). Run it deliberately with:\n` +
        `    DATABASE_URL='...' node migrate.js --run-heavy\n` +
        `The app will boot normally; this conversion stays pending until then.`);
      continue;
    }
    console.log(`[migrate] running heavy conversion: ${h.label}…`);
    await h.run(db);
    console.log(`[migrate] heavy conversion done: ${h.label}`);
  }
}

// Shift all stored ratings/predictions down by 1 (1-10 -> 0-9), preserving originals,
// then recompute every ratified round's average and re-score. Runs once.
async function convertScaleTo09(db) {
  let flag;
  try { flag = await db.get("SELECT v FROM settings WHERE k = 'scale_conversion_0to9'", []); }
  catch { return; } // settings table or flag not present yet
  if (!flag || flag.v !== 'pending') return; // already done, or never seeded

  const scoring = require('./scoring');
  // 1. Back up originals (only where not already backed up) and shift live values -1.
  //    Floor at 0 so nothing goes negative; clamp predictions to [0,9].
  const votes = await db.all('SELECT * FROM votes', []);
  for (const v of votes) {
    if (v.taste_legacy == null) {
      const newTaste = Math.max(0, Math.round(Number(v.taste)) - 1);
      const newPredict = Math.min(9, Math.max(0, Number(v.predict) - 1));
      await db.run('UPDATE votes SET taste_legacy = ?, predict_legacy = ?, taste = ?, predict = ? WHERE id = ?',
        [v.taste, v.predict, newTaste, newPredict, v.id]);
    }
  }
  // 2. Recompute each ratified round: new room average + re-score every vote.
  const rounds = await db.all("SELECT * FROM rounds WHERE status = 'ratified'", []);
  for (const r of rounds) {
    const rv = await db.all('SELECT * FROM votes WHERE round_id = ?', [r.id]);
    if (!rv.length) continue;
    const avg = scoring.roomAverage(rv);            // mean of (now 0-9) tastes
    const ranked = scoring.rankVotes(rv, avg);      // recompute err/points/tier/rank
    for (const v of ranked) {
      await db.run('UPDATE votes SET points = ?, err = ?, tier = ?, rank = ? WHERE id = ?',
        [v.points, v.err, v.tier, v.rank, v.id]);
    }
    await db.run('UPDATE rounds SET room_average = ? WHERE id = ?', [avg, r.id]);
  }
  // 3. Recompute per-participant totals (floored at 0) from the reconverted votes.
  const parts = await db.all('SELECT id FROM participants', []);
  for (const p of parts) {
    const row = await db.get(
      "SELECT COALESCE(SUM(points),0) AS s FROM votes WHERE participant_id = ? AND points IS NOT NULL", [p.id]);
    const total = Math.max(0, Number(row.s) || 0);
    await db.run('UPDATE participants SET total_points = ? WHERE id = ?', [total, p.id]);
  }
  // 4. Recompute lifetime_points + rounds_voted per user from the reconverted data.
  const users = await db.all('SELECT uid FROM users', []);
  for (const u of users) {
    const lp = await db.get(
      `SELECT COALESCE(SUM(v.points),0) AS s
         FROM votes v JOIN participants p ON v.participant_id = p.id
        WHERE p.user_id = ? AND v.points IS NOT NULL`, [u.uid]);
    const rc = await db.get(
      `SELECT COUNT(*) AS c
         FROM votes v JOIN participants p ON v.participant_id = p.id
        WHERE p.user_id = ?`, [u.uid]);
    await db.run('UPDATE users SET lifetime_points = ?, rounds_voted = ? WHERE uid = ?',
      [Math.max(0, Number(lp.s) || 0), Number(rc.c) || 0, u.uid]);
  }
  // 5. Mark done so this never runs again.
  await db.run("UPDATE settings SET v = 'done' WHERE k = 'scale_conversion_0to9'", []);
  console.log('[migrate] 0-9 scale conversion complete (originals preserved in *_legacy).');
}

impl.engine = USE_PG ? 'postgres' : 'sqlite';
module.exports = impl;
