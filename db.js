'use strict';
// Database layer. Auto-selects Postgres when DATABASE_URL is set, otherwise
// falls back to a local SQLite file (built into Node 22 — no native build step).
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
     admin_token TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open',   -- open | ended
     banner_id TEXT,                         -- optional session-level ad override
     default_minutes INTEGER NOT NULL DEFAULT 5, -- per-session default voting window
     created_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS participants (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     email TEXT NOT NULL,
     name TEXT,
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
    },
  };
}

impl.engine = USE_PG ? 'postgres' : 'sqlite';
module.exports = impl;
