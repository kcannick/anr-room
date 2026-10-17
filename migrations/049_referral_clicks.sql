-- 049_referral_clicks.sql
-- Clicks on an A&R's submit link (2026-09-23). The submit link used to go straight to
-- makinitmag.com, so this app never saw it opened; it now goes through /r/<uid>, which counts
-- the click and 302s on to the review form with ?ref=<uid> intact.
--
-- DIAGNOSIS ONLY. Nothing here awards points, ranks anyone or feeds standing — anyone can
-- generate clicks. Credit still comes only from a submission makinitmag.com attributes.
--
-- One row per (ET day, A&R, visitor): the same person opening the link five times in a day is
-- one row. visitor = sha256(ip|user_agent|day), first 32 hex chars — the raw IP and user agent
-- are never stored. kind = 'human' | 'bot' (link previewers, crawlers); bot rows are kept so
-- the filter can be checked, and every number an A&R sees counts human rows only.
-- created_at is BIGINT, not INTEGER: it holds epoch MILLISECONDS, which overflow a Postgres int4.
CREATE TABLE IF NOT EXISTS referral_clicks (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  visitor TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (day, user_id, visitor)
)
--->
CREATE INDEX IF NOT EXISTS idx_referral_clicks_user ON referral_clicks (user_id, kind, day)
