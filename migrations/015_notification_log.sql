-- 015_notification_log.sql
-- Idempotency + audit log for go-live notifications (the SMS/email fan-out when a
-- session flips to live). One row per (session, participant, channel) attempted, so
-- re-flipping a session to live never re-notifies anyone. Additive; safe on boot.

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant_id TEXT,
  user_id TEXT,
  channel TEXT NOT NULL,          -- 'sms' | 'email'
  destination TEXT,               -- number/email actually targeted (audit)
  status TEXT NOT NULL,           -- 'sent' | 'failed'
  error TEXT,
  created_at BIGINT NOT NULL
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS ux_notiflog_session_participant_channel
  ON notification_log (session_id, participant_id, channel)
