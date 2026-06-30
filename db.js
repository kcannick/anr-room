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
     poll_type TEXT NOT NULL DEFAULT 'rating', -- 'rating' (0-9 game) | 'binary' (Verzuz A/B)
     watch_url TEXT,                         -- optional stream/watch link shown to players
     lobby_message TEXT,                     -- optional admin text shown in the lobby/waiting screen
     signup_prompt TEXT,                     -- optional custom question asked at join (e.g. "IG + city")
     broadcast_text TEXT,                    -- current live broadcast message (null = none)
     broadcast_at BIGINT,                    -- when the current broadcast was set (drives client dedupe)
     geo_mode TEXT NOT NULL DEFAULT 'off',   -- 'off' | 'optional' (dual pool) | 'required' (in-room only)
     geo_lat REAL,                           -- venue pin latitude (set via geocoded address / map / device)
     geo_lng REAL,                           -- venue pin longitude
     geo_radius INTEGER,                     -- check-in radius in yards (generous default applied in code)
     geo_label TEXT,                         -- human-readable venue address/name for display
     deleted_at BIGINT,                      -- soft-delete timestamp (null = active; hidden from lists if set)
     series_id TEXT,                          -- optional: the Series this session is tagged into (display-grouped competition)
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
     signup_answer TEXT,                    -- answer to the session's custom sign-up prompt
     ref_code TEXT,                          -- this participant's shareable referral code
     referred_by TEXT,                       -- participant.id of whoever referred them (null = organic)
     ref_credited INTEGER NOT NULL DEFAULT 0, -- 1 once they verified AND played a round (real referral)
     pool TEXT,                              -- 'in_person' | 'online' | null (set at check-in)
     checkin_distance INTEGER,               -- coarse yards from venue at check-in (auditing; no raw coords stored)
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
     option_b_title TEXT,                    -- binary: Song B title (Song A reuses song_title)
     option_b_artist TEXT,                   -- binary: Song B artist (Song A reuses song_artist)
     split_a REAL,                           -- binary: resolved % that picked A (null until ratified)
     created_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS votes (
     id TEXT PRIMARY KEY,
     round_id TEXT NOT NULL,
     participant_id TEXT NOT NULL,
     taste INTEGER,                          -- rating: 0..9 (their rating); null for binary votes
     predict REAL,                           -- rating: 0.0..9.0 (room avg guess); null for binary votes
     locked_at BIGINT NOT NULL,
     points INTEGER,                         -- filled at ratify
     err REAL,                               -- |predict - room_average|
     tier TEXT,                              -- bullseye|sharp|close|off|wayoff (results reaction)
     rank INTEGER,
     taste_legacy INTEGER,                   -- preserved pre-0-9 rating (null if born on 0-9)
     predict_legacy REAL,                    -- preserved pre-0-9 prediction
     pick TEXT,                              -- binary: 'A' | 'B' (chosen side); null for rating votes
     predict_split REAL                      -- binary: predicted % for A, 0..100; null for rating votes
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_vote ON votes (round_id, participant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_part_session ON participants (session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_round_session ON rounds (session_id)`,
  `CREATE TABLE IF NOT EXISTS series (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     description TEXT,
     status TEXT NOT NULL DEFAULT 'upcoming', -- upcoming | active | closed
     target_sessions INTEGER,                 -- optional, DISPLAY ONLY (never a membership filter)
     qualify_count INTEGER NOT NULL DEFAULT 8, -- top-N who qualify for A&R Wars (drives the cut)
     start_date BIGINT,                       -- optional, DISPLAY ONLY
     end_date BIGINT,                         -- optional, DISPLAY ONLY
     created_at BIGINT NOT NULL
   )`,
  // NOTE: indexes on sessions(series_id) and votes(round_id) live in migration
  // 011_series, NOT here. They depend on the series_id column the migration adds,
  // and the migration runner runs AFTER this SCHEMA — so placing them here would
  // fail with "no such column" when upgrading a pre-existing sessions table.
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
  `CREATE TABLE IF NOT EXISTS feedback (
     id TEXT PRIMARY KEY,
     session_id TEXT,                        -- session the feedback came from (if known)
     participant_id TEXT,                    -- player who submitted (if logged in)
     message TEXT NOT NULL,                  -- the feedback text (screenshot is emailed, not stored)
     had_screenshot INTEGER NOT NULL DEFAULT 0, -- 1 if a screenshot was attached to the email
     contact_email TEXT,                     -- optional email they want a reply at
     user_agent TEXT,                        -- browser/device string for debugging context
     emailed INTEGER NOT NULL DEFAULT 0,     -- 1 if the admin notification email succeeded
     created_at BIGINT NOT NULL
   )`,
];

let impl;

if (USE_PG) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    max: 5,
    // Fail loud and fast instead of hanging to the Vercel 10s kill. A stuck
    // connect or a wedged query now errors in a few seconds with a clear cause,
    // rather than silently 504-ing every route. (Boot path must never block.)
    connectionTimeoutMillis: 5000,   // give up acquiring a connection after 5s
    statement_timeout: 8000,         // abort any single query after 8s (server-side)
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
    // Acquire the migration advisory lock on a DEDICATED client and run `fn`
    // while holding it, then release on the SAME client. Pinning to one client
    // is essential: pg_advisory_lock is session-scoped, so lock and unlock must
    // happen on the same connection — the old code ran them through the shared
    // pool, so unlock could land on a connection that never held the lock (which
    // Postgres ignores, leaving the lock stuck). Uses pg_try_advisory_lock
    // (non-blocking) with a bounded retry so an instance NEVER waits forever on
    // the boot path — the failure mode that 504'd every route under load.
    // Returns true if we ran fn (got the lock), false if we gave up (someone
    // else is migrating — caller re-checks and finds nothing pending).
    async withMigrationLock(fn, { key = 727274, tries = 50, gapMs = 100 } = {}) {
      const client = await pool.connect();
      try {
        let got = false;
        for (let i = 0; i < tries; i++) {
          const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key]);
          if (r.rows[0] && r.rows[0].ok) { got = true; break; }
          await new Promise(res => setTimeout(res, gapMs));
        }
        if (!got) return false; // another instance holds it; proceed without migrating
        try {
          await fn();
          return true;
        } finally {
          await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {});
        }
      } finally {
        client.release();
      }
    },
    async init(opts = {}) {
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
  const path = process.env.SQLITE_PATH || './anr-room.db';
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

  // ---- VERSION GATE (the important fix) ----
  // Cheap pre-check that runs on EVERY boot: read what's applied, compare to the
  // shipped files. If nothing is pending (the steady-state case — your prod DB
  // already has all migrations), return IMMEDIATELY, before touching any lock.
  // This is what keeps the serverless boot path lock-free: a thousand cold starts
  // each do one tiny SELECT and serve traffic, instead of piling onto a blocking
  // advisory lock and 504-ing. The lock below is only ever reached in the brief
  // window right after a deploy that ships a genuinely new migration.
  async function pending() {
    const done = await db.all('SELECT id FROM _migrations', []);
    const applied = new Set(done.map(r => r.id));
    return migrations.filter(m => !applied.has(m.id));
  }
  if ((await pending()).length === 0) return; // nothing to do — no lock, no work

  // Something IS pending. Do the actual apply work, serialized.
  const apply = async () => {
    // Re-read inside the lock: another instance may have applied them while we
    // waited for the lock. (Idempotent either way, but this avoids redundant DDL.)
    for (const m of await pending()) {
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
  };

  if (USE_PG && typeof db.withMigrationLock === 'function') {
    // Pinned, non-blocking, bounded try-lock. If we don't get the lock, another
    // instance is migrating — we give up gracefully. Then re-check: by now it has
    // (almost certainly) finished, so pending() is empty and we proceed clean. In
    // the rare case it's still going, the next request's cold start will self-heal.
    const ran = await db.withMigrationLock(apply);
    if (!ran) {
      const still = await pending();
      if (still.length) {
        console.log(`[migrate] another instance is migrating; ${still.length} pending, proceeding (will self-heal next boot)`);
      }
    }
  } else {
    // SQLite (single-process) — no lock needed.
    await apply();
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

  // ─────────────────────────────────────────────────────────────────────────
  // BOOT-PATH GUARD (the fix for the 504 outage).
  //
  // Everything below the admin-promote is MAINTENANCE, not init: an orphan
  // backfill (one-time) and a per-user stats recompute that re-derives
  // sessions_played / lifetime_points for EVERY user. That recompute is 2
  // aggregate queries per user, run sequentially — ~12s at 60 users — and it
  // was running on EVERY serverless cold start, before any route could serve.
  // Once the user count grew past the point where it exceeded Vercel's 10s
  // function limit, every cold start timed out and every function-backed route
  // 504'd. It is idempotent and produces the same numbers every boot, so there
  // is no reason to pay it per-request.
  //
  // It now runs ONLY when allowHeavy is true — i.e. from `node migrate.js
  // --run-heavy`, the same deploy-time path the heavy scale-conversion already
  // uses. On the serverless boot path (allowHeavy=false) we do the cheap
  // admin-promote and return. Stats are maintained at write-time by the app and
  // re-derived deliberately at deploy, never on the request hot path.
  // ─────────────────────────────────────────────────────────────────────────

  // Cheap + safe on every boot: promote the configured admin once the row exists.
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (adminEmail) {
    await db.run("UPDATE users SET role = 'admin' WHERE email = ?", [adminEmail]).catch(() => {});
  }

  if (!allowHeavy) {
    // Serverless boot path: skip all maintenance. Detect whether a backfill is
    // pending purely so we can log a loud, actionable line (no work, no scans
    // that could stall the boot).
    return;
  }

  // ── Below here only runs from the standalone migrate script (allowHeavy) ──

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

  // Binary poll: existing Postgres production DBs created votes.taste/predict as
  // NOT NULL. Binary votes leave those null (they fill pick/predict_split instead),
  // so relax the constraint. Postgres-only + idempotent (DROP NOT NULL on an already-
  // nullable column is a no-op). SQLite never had a way to add the constraint via
  // migration and fresh SQLite uses the relaxed SCHEMA, so it needs nothing here.
  if (USE_PG) {
    await db.run('ALTER TABLE votes ALTER COLUMN taste DROP NOT NULL').catch(() => {});
    await db.run('ALTER TABLE votes ALTER COLUMN predict DROP NOT NULL').catch(() => {});
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
