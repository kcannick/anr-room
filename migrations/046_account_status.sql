-- 046_account_status.sql
-- A&Rs can close their own account (operator, 2026-10-05). Two states, both timestamps:
--
--   deactivated_at — reversible. Hidden from every public surface, off every board, no
--                    emails or texts, all tokens revoked. Logging back in with the email
--                    code clears it and everything comes back (points included — nothing
--                    was deleted, the boards just filter it out).
--   deleted_at     — permanent ANONYMIZE; accounts are never deleted. Name, email, phone,
--                    photo and handles are scrubbed (role, categories and city KEPT — they
--                    feed report segments) and the email is tombstoned so it
--                    can sign up fresh; votes / point_events / round_reports / round_comments stay, nameless,
--                    so published room averages and other A&Rs' points never move.
--
-- `blocked` stays the admin's suspension and is a separate axis. Every surface filters all
-- three through activeUserSql() in server.js. Additive only, no backfill. Safe on boot.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at BIGINT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at BIGINT
--->
CREATE INDEX IF NOT EXISTS idx_users_deactivated ON users (deactivated_at)
--->
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users (deleted_at)
