-- 055_pick_the_hits.sql
-- Pick the Hits (operator, 2026-11-11): the side bet without the tournament. Every ballot ranks
-- N songs from the Service Pack (#1 = N points … #N = 1), songs rank by total, the ballot closest
-- to that order wins $150. The Service Pack is not always open, so the page collects a NOTIFY
-- LIST (name, email, phone — all required, operator 2026-11-13) and texts + emails it when the
-- next pack opens. The results go out as a public email.
--
-- A handful of rows per signup or per press, written by a request — never per user by a job.
-- Times are BIGINT: epoch milliseconds overflow a Postgres int4.

-- The notify list. One row per email (lower-cased). A signup is not an account: no code, no
-- users row. unsub_token is the one-click unsubscribe in every message.
CREATE TABLE IF NOT EXISTS hits_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  unsub_token TEXT NOT NULL,
  source TEXT,
  created_at BIGINT NOT NULL,
  unsubscribed_at BIGINT
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hits_subscriber_email ON hits_subscribers (email)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hits_subscriber_unsub ON hits_subscribers (unsub_token)
--->
-- One row per message: kind 'open' (the pack is open) or 'results' (the public results email),
-- per pack, per channel, per address. The unique index makes a second press send only to who
-- has not had it; rows are claimed pending → sending before the send.
CREATE TABLE IF NOT EXISTS hits_sends (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  dest TEXT NOT NULL,
  name TEXT,
  unsub_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hits_send ON hits_sends (pack_id, kind, channel, dest)
--->
-- The tally, stored at settle so the results read the same every time.
ALTER TABLE pack_songs ADD COLUMN IF NOT EXISTS points INTEGER
--->
ALTER TABLE pack_songs ADD COLUMN IF NOT EXISTS pickers INTEGER
--->
ALTER TABLE pack_songs ADD COLUMN IF NOT EXISTS final_rank INTEGER
--->
-- How many of the final top N a ballot had in exactly the right spot (correct = how many it had).
ALTER TABLE sidebet_entries ADD COLUMN IF NOT EXISTS exact INTEGER
--->
-- 'weighted' (Pick the Hits) or 'played' (the A&R Wars rule, kept for history). Set at settle.
ALTER TABLE packs ADD COLUMN IF NOT EXISTS scoring TEXT
