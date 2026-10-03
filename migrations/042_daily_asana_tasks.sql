-- 042_daily_asana_tasks.sql
-- The daily Instagram posts go to Asana on their own (operator, 2026-10-03): once a day's
-- slides are rendered, the cron makes ONE task per post — the Makin' It Daily Countdown and the
-- Top A&Rs — with the slides attached in carousel order and the caption in the notes.
--
-- asana_tasks is JSON: { song: { gid, url, next, total, done, attempts, error }, ar: { ... } }.
-- NULL = this day was never queued (every day rendered before 042 — they are NOT back-filled);
-- '{}' = queued, nothing made yet. The task gid is saved the moment Asana returns it, so a
-- countdown that takes several ticks to attach resumes instead of making a second task.
-- asana_claimed_at is the claim (Vercel can double-invoke the cron); 10 minutes = abandoned.
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS asana_tasks TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS asana_claimed_at BIGINT
