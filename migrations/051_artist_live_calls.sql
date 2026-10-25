-- 051_artist_live_calls.sql
-- "We're live" to the artists (operator, 2026-10-25: "I've decided to start doing the daily
-- drops on live... I want ability to send SMS and Email to all Artists in a session to let them
-- know that I'm live reviewing music"). One button on the daily console; one row per message.
--
-- Its own table, not artist_headsups: that queue is UNIQUE (round_id, channel), one heads-up per
-- record ever, and this one is per ADDRESS per press — an artist with two records in the drop
-- gets one message, and the host may go live on the same drop twice (call_no 1, 2, …).
-- A handful of rows per press, written by an admin request — never per user or per vote.
-- Times are BIGINT: epoch milliseconds overflow a Postgres int4.
CREATE TABLE IF NOT EXISTS artist_live_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  call_no INTEGER NOT NULL,
  round_id TEXT,
  channel TEXT NOT NULL,
  dest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  by_uid TEXT,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_artist_live_call ON artist_live_calls (session_id, call_no, channel, dest)
