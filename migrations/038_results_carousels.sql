-- 038_results_carousels.sql
-- The A&R Meeting results carousels — two Instagram carousels posted after the 2PM reveal
-- stream (operator, 2026-09-13): the day's top record (trophy, title, artist, handle; then the
-- other records ranked without scores, six to a slide; then "Submit your music") and the day's
-- top A&R (trophy, name, city, handle, profile photo where there is one; then the other top
-- A&Rs with points; then "Join the A&R Team"). Rendered at the 3PM publish alongside the
-- recap cover and hosted on the same Blob path (daily/<day>/results-song-N.png, results-ar-N.png).
--
-- Four more columns on recap_jobs (018/034/036), same best-effort contract as the recap
-- graphics: the URL lists are JSON arrays, NULL when the render or upload failed, the day
-- publishes anyway, and the console shows the gap with a live render behind it. The captions
-- are built first and kept even when hosting does not happen.
--
-- Additive, nullable, zero backfill.
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS results_song_urls TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS results_ar_urls TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS results_song_caption TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS results_ar_caption TEXT
