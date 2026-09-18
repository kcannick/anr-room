-- 039_winner_posts.sql
-- The winner posts (operator, 2026-09-18): Top Track of the Day and Top A&R of the Day, one
-- portrait graphic each (1080x1350), posted as Instagram COLLAB posts so they land on the
-- winner's own feed. Rendered at the 3PM publish alongside the results carousels and hosted
-- on the same Blob path (daily/<day>/winner-track.png, winner-ar.png). The weekly pair
-- (Top Track / Top A&R of the Week) renders on demand for a chosen week and stores nothing.
--
-- Same best-effort contract as 036/038: the URL is NULL when the render or upload failed, the
-- day publishes anyway, the console renders live behind the gap, and the caption is built
-- first and kept. Additive, nullable, zero backfill.
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS winner_track_url TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS winner_ar_url TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS winner_track_caption TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS winner_ar_caption TEXT
