-- 008_feedback.sql
-- Beta feedback log. Text feedback is stored here for later review; any screenshot is
-- emailed to the admin (not stored in the DB, to keep it lean). Additive, boot-safe.
--
-- Statements separated by a line of exactly --->.

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  participant_id TEXT,
  message TEXT NOT NULL,
  had_screenshot INTEGER NOT NULL DEFAULT 0,
  contact_email TEXT,
  user_agent TEXT,
  emailed INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
)
