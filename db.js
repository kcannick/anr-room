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
     taste INTEGER NOT NULL,                 -- 1..10 (their rating)
     predict REAL NOT NULL,                  -- 0.0..10.0 (room avg guess)
     locked_at BIGINT NOT NULL,
     points INTEGER,                         -- filled at ratify
     err REAL,                               -- |predict - room_average|
     tier TEXT,                              -- bullseye|sharp|close|off|wayoff (results reaction)
     rank INTEGER
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
    async init() {
      // PG needs BIGINT/REAL which our portable schema already uses; INTEGER bools are fine.
      for (const s of SCHEMA) await pool.query(s);
      // Versioned migrations: ordered, run-once, loud on failure. Replaces the old
      // boot-time ALTER blocks (which failed silently and raced on cold starts).
      await runMigrations(impl);
      await postMigrate(impl);
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
    async init() {
      for (const s of SCHEMA) sdb.exec(s);
      // Versioned migrations (see runMigrations). SQLite lacks ADD COLUMN IF NOT
      // EXISTS, so the runner treats "duplicate column" as already-applied.
      await runMigrations(impl);
      await postMigrate(impl);
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
async function postMigrate(db) {
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
}

impl.engine = USE_PG ? 'postgres' : 'sqlite';
module.exports = impl;
