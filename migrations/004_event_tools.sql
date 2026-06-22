-- 004_event_tools.sql
-- Event-running toolkit: session-level config the host sets (watch link, lobby
-- message, custom sign-up prompt) plus a live broadcast channel, and a participant
-- field to capture the custom sign-up answer. All additive ADD COLUMNs — light/fast,
-- nothing to recompute — safe on boot.
--
-- Statements separated by a line of exactly --->.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS watch_url TEXT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lobby_message TEXT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS signup_prompt TEXT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS broadcast_text TEXT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS broadcast_at BIGINT
--->
ALTER TABLE participants ADD COLUMN IF NOT EXISTS signup_answer TEXT
