-- 056_song_stage_ai_hot100.sql
-- Three answers the artist gives on the site's submit form (approved by the operator
-- 2026-11-26), carried on the daily push with each song and stored on its round:
--
--   rounds.song_stage   'released' | 'done' (done, not released yet) | 'wip' (still working on it)
--                       | '' (submitted before the question existed, or a hand-built record)
--   rounds.uses_ai      'yes' | 'no' | '' (before the question existed)
--   rounds.hot100       1 = the song may appear on HOT 100 lists; 0 = the artist UNTICKED
--                       "Put my song up for the HOT 100". Every row from before the question
--                       defaults to 1, which is what the site sends for an old entry too.
--
-- stage and uses_ai are SONG INFO shown to the A&R next to the artist's note while rating.
-- They say nothing about how the room voted, so they don't touch the sealed-vote rule.
-- hot100 = 0 only takes the record off the HOT 100 lists (the Daily Countdown carousel and the
-- Charts screen's record charts, slides, CSV and caption). Its votes, average, points and
-- Track Report are unchanged.
--
-- Additive with constant defaults; zero backfill; nothing scales with row count; boot-safe.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS song_stage TEXT NOT NULL DEFAULT ''
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS uses_ai TEXT NOT NULL DEFAULT ''
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS hot100 INTEGER NOT NULL DEFAULT 1
