-- 018_recap_emails.sql
-- Post-session recap email carousel. Two tables:
--   recap_jobs   — one row per session send; holds the SHARED card URLs (Top 8 A&Rs, Top 8
--                  Songs, Promo) rendered + uploaded once and reused for every recipient.
--   recap_emails — the per-recipient queue. Processed in small chunks OFF the request/boot
--                  path (admin-triggered), so it never scales work onto cold start (the #1 rule).
-- Additive; safe on boot.

CREATE TABLE IF NOT EXISTS recap_jobs (
  session_id TEXT PRIMARY KEY,
  ars_url TEXT,
  songs_url TEXT,
  promo_url TEXT,
  created_at BIGINT NOT NULL
)
--->
CREATE TABLE IF NOT EXISTS recap_emails (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  score_url TEXT,                            -- the recipient's personal Score Card (Blob)
  error TEXT,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recap_participant ON recap_emails (session_id, participant_id)
--->
CREATE INDEX IF NOT EXISTS idx_recap_status ON recap_emails (session_id, status)
