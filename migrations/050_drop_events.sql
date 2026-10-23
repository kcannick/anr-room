-- 050_drop_events.sql
-- The daily drop's log (2026-10-21, operator's ask: "Received, Opened, Closed, Tallied,
-- Revealed, Email sent, IG Posted… date and time").
--
-- ONLY the moments nothing else records. Most of the log is read off columns that already
-- exist (published_at, recap_jobs.rendered_at, notify_broadcasts/notify_recipients, artist_notices,
-- results_pushed_at) — writing those here too would give the log two sources that could disagree.
-- What had no actual time before: the push (a re-push replaces the rounds and their created_at),
-- the open, the close, the tally, and the two Instagram posts being SCHEDULED in SocialBee — done
-- outside this app by the daily browser automation, which reports each one here.
--
-- A handful of rows per day, written inside the claim that makes each step happen once —
-- never per user or per vote (CLAUDE.md #1 rule). Instagram marks are replaced, not stacked.
-- at is when it happened; target_at is the time it is FOR (a scheduled post's go-out time).
-- Both BIGINT: epoch milliseconds overflow a Postgres int4.
CREATE TABLE IF NOT EXISTS drop_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event TEXT NOT NULL,
  at BIGINT NOT NULL,
  target_at BIGINT,
  detail TEXT,
  url TEXT,
  by_uid TEXT
)
--->
CREATE INDEX IF NOT EXISTS idx_drop_events_session ON drop_events (session_id, at)
