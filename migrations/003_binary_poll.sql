-- 003_binary_poll.sql
-- Adds the "binary poll" (Verzuz mode) as a SECOND poll type alongside the existing
-- 0-9 rating game. A session is either a 'rating' session or a 'binary' session, set
-- once at creation; rounds inherit it. Pure additive ADD COLUMNs — no data conversion,
-- nothing to recompute — so this runs safely on boot (light/fast).
--
-- Statements separated by a line of exactly --->. Each is idempotent (ADD COLUMN IF
-- NOT EXISTS on Postgres; the runner strips IF NOT EXISTS for SQLite and treats a
-- duplicate-column error as already-applied).

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS poll_type TEXT NOT NULL DEFAULT 'rating'
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS option_b_title TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS option_b_artist TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS split_a REAL
--->
ALTER TABLE votes ADD COLUMN IF NOT EXISTS pick TEXT
--->
ALTER TABLE votes ADD COLUMN IF NOT EXISTS predict_split REAL
