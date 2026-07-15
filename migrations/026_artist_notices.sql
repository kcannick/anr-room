-- 026_artist_notices.sql
-- Post-show artist workflow: every artist whose record was rated gets their full Song
-- Report by email (+ a heads-up SMS), so the host stops hand-delivering them.
--
-- rounds.artist_email / artist_phone — per-song contact, captured three ways: the Drupal
--   /review ingest payload, the host's queue form, or retroactively via round edit after
--   the show. PRIVATE: never emitted by any public/overlay/leaderboard surface (PII rule).
--
-- artist_notices — the per-round-per-channel send queue. Same chunked-queue pattern as
--   recap_emails (018): admin-triggered, processed in small batches OFF the request/boot
--   path, so it never scales work onto cold start (the #1 rule). SMS rows additionally
--   wait for the 10AM-8PM ET send window (TCPA) — a show ends at 11PM, so texts sit
--   pending overnight and a cron drains them the next morning. idx_artist_notice_pending
--   is what that cron rides: it must find pending SMS across ALL sessions without a scan.
--
-- Additive; safe on boot. Statements separated by a line of exactly --->.

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS artist_email TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS artist_phone TEXT
--->
CREATE TABLE IF NOT EXISTS artist_notices (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  channel TEXT NOT NULL,                    -- email | sms
  dest TEXT NOT NULL,                       -- address / number, snapshotted at enqueue
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | sending | sent | failed
                                            -- 'sending' is a transient CLAIM: cron delivery can
                                            -- double-invoke, so a drain flips pending->sending
                                            -- conditionally and only the winner sends.
  report_urls TEXT,                         -- JSON [p1,p2,p3] hosted report pages (email)
  error TEXT,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_artist_notice ON artist_notices (round_id, channel)
--->
CREATE INDEX IF NOT EXISTS idx_artist_notice_session ON artist_notices (session_id, status)
--->
CREATE INDEX IF NOT EXISTS idx_artist_notice_pending ON artist_notices (channel, status)
