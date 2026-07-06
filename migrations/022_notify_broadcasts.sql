-- 022_notify_broadcasts.sql
-- Platform-wide announcements (email and/or SMS to ALL users), sent through the same
-- chunked-queue pattern as recap emails: an admin request creates the queue, then the
-- client drives small processing batches — no single request ever scales with the
-- user count (the #1 rule). SMS rows are created ONLY for marketing-consented users
-- (TCPA); Twilio's A2P STOP handling covers opt-outs.

CREATE TABLE IF NOT EXISTS notify_broadcasts (
  id TEXT PRIMARY KEY,
  subject TEXT,                              -- email subject (email channel only)
  message TEXT NOT NULL,
  channels TEXT NOT NULL,                    -- 'email' | 'sms' | 'email+sms'
  created_by TEXT,                           -- admin uid
  status TEXT NOT NULL DEFAULT 'sending',    -- sending | done
  created_at BIGINT NOT NULL
)
--->
CREATE TABLE IF NOT EXISTS notify_recipients (
  broadcast_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  channel TEXT NOT NULL,                     -- 'email' | 'sms'
  dest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | sent | failed
  error TEXT,
  sent_at BIGINT,
  PRIMARY KEY (broadcast_id, uid, channel)
)
--->
CREATE INDEX IF NOT EXISTS idx_notify_rcpt_status ON notify_recipients (broadcast_id, status)
