-- 041_daily_stream_schedule.sql
-- The 69-hour schedule (operator, 2026-09-27): more production time and a notification
-- between every event. Hours after the open:
--   -1  track list locked (review site)
--    0  drop opens; A&Rs are emailed that voting is open (topic daily_open)
--   24  voting closes and tallies; each rated artist gets a heads-up (email + SMS) that the
--       record appears on TOMORROW's Livestream Countdown (artist_headsups)
--   48  Livestream Countdown (sessions.stream_at); the ranked graphics render so clips can
--       be posted after the stream (recap_jobs.rendered_at)
--   69  results publish: the seal lifts on /daily, the A&R results email and the artist
--       Track Report go out, and makinitmag gets the results callback (results_at, as before)
--
-- stream_at is nullable with zero backfill: a day without one resolves it from its drop_day
-- through dropWindowFor(), and publish renders the graphics itself when the stream step never
-- ran, so a day in flight at deploy still publishes complete.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS stream_at BIGINT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS rendered_at BIGINT
--->
-- The heads-up is its own queue, not a second kind on artist_notices: that table's
-- uniq_artist_notice (round_id, channel) is what makes the report idempotent AND what the
-- per-round resend UPSERTs against, so a second row per round would break both.
-- Same shape and the same pending -> sending -> sent|failed claim as artist_notices.
CREATE TABLE IF NOT EXISTS artist_headsups (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  dest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  sent_at BIGINT,
  error TEXT
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_artist_headsup ON artist_headsups (round_id, channel)
--->
CREATE INDEX IF NOT EXISTS idx_artist_headsup_session ON artist_headsups (session_id, status)
--->
-- The stored 6 PM results time and the one-hour artist hold were the old schedule's. Results
-- now land two days after the close, and the report goes out 45 hours after the tally, which
-- is the comment-rejection window the hold existed to provide. Clearing the two rows puts the
-- new defaults (12:00 PM, 0 minutes) in force; open and close (3 PM) are unchanged. Two rows.
DELETE FROM settings WHERE k IN ('daily_results_min', 'daily_artist_delay_min')
