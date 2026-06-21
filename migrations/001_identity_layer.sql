-- 001_identity_layer.sql
-- The identity layer: roles, durable auth tokens, session ownership + lifecycle,
-- and compliant SMS-consent capture. Idempotent (IF NOT EXISTS everywhere) so it's
-- safe even on databases that already had these columns hand-applied.
--
-- Statements are separated by a line containing only `--->` (the runner splits on it).
-- Keep each statement runnable on its own; both Postgres and SQLite must accept it.

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player'
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_marketing_consent INTEGER NOT NULL DEFAULT 0
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_consent_at BIGINT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_uid TEXT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS scheduled_at BIGINT
--->
ALTER TABLE participants ADD COLUMN IF NOT EXISTS user_id TEXT
--->
ALTER TABLE participants ADD COLUMN IF NOT EXISTS phone TEXT
--->
ALTER TABLE participants ADD COLUMN IF NOT EXISTS sms_marketing_consent INTEGER NOT NULL DEFAULT 0
--->
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_used BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
)
--->
UPDATE sessions SET status = 'live' WHERE status = 'open'
--->
UPDATE sessions SET status = 'completed' WHERE status = 'ended'
