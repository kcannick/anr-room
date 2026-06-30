-- 014_session_submit.sql
-- Per-session artist submission link. Each session can carry its own "submit your music"
-- URL (different events/operators route submissions differently), surfaced on the public
-- homepage for the live/next session. Additive, nullable. Safe on boot.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS submit_url TEXT
