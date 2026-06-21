-- 002_zero_to_nine.sql
-- Adds: rounds_voted lifetime stat; legacy-backup columns on votes; a one-time
-- conversion flag. The actual 1-10 -> 0-9 data conversion (shift ratings/predictions
-- down by 1, recompute room averages + scores) runs once in postMigrate, guarded by
-- the settings flag this migration seeds, because it's procedural (re-scoring) rather
-- than a single SQL statement.
--
-- Statements separated by a line of exactly --->. Idempotent where possible.

ALTER TABLE users ADD COLUMN IF NOT EXISTS rounds_voted INTEGER NOT NULL DEFAULT 0
--->
ALTER TABLE votes ADD COLUMN IF NOT EXISTS taste_legacy INTEGER
--->
ALTER TABLE votes ADD COLUMN IF NOT EXISTS predict_legacy REAL
--->
-- Seed the conversion flag as 'pending' so postMigrate runs the one-time 0-9 shift.
-- If this row already exists (re-run), the INSERT is ignored and we don't re-convert.
INSERT INTO settings (k, v) VALUES ('scale_conversion_0to9', 'pending') ON CONFLICT (k) DO NOTHING
