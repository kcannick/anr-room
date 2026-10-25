-- 052_drop_no.sql
-- Daily drops are numbered (operator, 2026-10-25): "Daily Drop #47 · Oct 27, 2026". The number
-- is permanent where the date is not — a schedule change re-dated the Oct 17 and Oct 18 drops to
-- the same 10.20.26, and date-only names were the confusion. The publish date (drop day + 2)
-- stays on the end.
--
-- A drop gets its number when it OPENS (openAsyncDrop), the next after the highest ever given,
-- so a drop pushed and then moved or deleted before it opens leaves no gap. A number is never
-- reused: a drop that opened and was later deleted keeps its number and the count skips it.
-- Unlisted (private) drops get no number. The count starts at the first daily drop ever.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS drop_no INTEGER
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sessions_drop_no ON sessions (drop_no)
--->
-- Number every public drop that has already opened, in drop-day order (a few dozen rows, once).
UPDATE sessions SET drop_no = (
    SELECT COUNT(*) FROM sessions s2
     WHERE s2.mode = 'async' AND COALESCE(s2.async_state, 'scheduled') <> 'scheduled'
       AND (s2.visibility IS NULL OR s2.visibility <> 'unlisted')
       AND (s2.drop_day < sessions.drop_day OR (s2.drop_day = sessions.drop_day AND s2.id <= sessions.id)))
 WHERE mode = 'async' AND COALESCE(async_state, 'scheduled') <> 'scheduled'
   AND (visibility IS NULL OR visibility <> 'unlisted') AND drop_no IS NULL
--->
-- The default names ("Daily Drop - Oct 27, 2026") take the number; a name the operator typed is left alone.
UPDATE sessions SET name = 'Daily Drop #' || drop_no || ' · ' || substr(name, 14)
 WHERE mode = 'async' AND drop_no IS NOT NULL AND name LIKE 'Daily Drop - %'
