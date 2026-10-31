-- 053_replay_votes.sql
-- Replay the Day (operator, 2026-10-31): any A&R replays a PUBLISHED drop's unrated records for
-- practice — rate, predict, lock, and the real average comes straight back with what the guess
-- would have paid. NOTHING here is a vote: no board, tally, report, email, bonus or chart reads
-- this table. It replaces the admin-only demo mode's settings row (k = daily_demo:<uid>:<sid>).
--
-- One row per (A&R, record), written by the A&R's own lock-in — never per user by a job.
-- Times are BIGINT: epoch milliseconds overflow a Postgres int4.
CREATE TABLE IF NOT EXISTS replay_votes (
  uid TEXT NOT NULL,
  round_id TEXT NOT NULL,
  taste INTEGER NOT NULL,
  predict REAL NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (uid, round_id)
)
--->
-- The demo-mode rows from before this table (an admin's ratings on a handful of drops).
DELETE FROM settings WHERE k LIKE 'daily_demo:%'
