-- 040_asana_leads.sql
-- Sales leads into Asana (operator, 2026-09-19): the top-scoring artists whose records the
-- platform has rated become one Asana task each, in a dedicated project with two custom
-- fields (Date played, Average score), so the operator can work the list and sell
-- Mimberships and performances.
--
-- This table is the sync ledger: which artist already has a task, and the record it was
-- last written from. It is what makes the button RE-RUNNABLE — a second press adds the
-- artists who are new to the top set and updates a task whose artist has since scored
-- higher, instead of filling the project with duplicates. An artist who drops out of the
-- top set keeps their task: the operator may be halfway through a conversation.
--
-- artist_key — how "one artist" is decided, in order: e:<email> | i:<instagram> | n:<name>
--   (lower-cased). The email is the strongest identity the submission form gives us.
-- The task gid is Asana's; if the operator deletes the task there, the next sync sees a 404
-- on update and creates a fresh one (the row is rewritten).
CREATE TABLE IF NOT EXISTS asana_leads (
  artist_key TEXT PRIMARY KEY,
  task_gid TEXT NOT NULL,
  round_id TEXT,                           -- the record the task currently describes
  score REAL,                              -- its room average at the last sync
  played_day TEXT,                         -- 'YYYY-MM-DD' (ET) at the last sync
  synced_at BIGINT NOT NULL
)
