-- 036_recap_graphics.sql
-- The A&R Meeting Recap graphics — the daily noon live stream's Instagram Live cover (9:16)
-- and YouTube thumbnail (16:9), plus the stream's caption, rendered at publish alongside the
-- Top 8 cards and hosted on the same Blob path (daily/<day>/recap-cover.png, recap-thumb.png).
--
-- Three more columns on recap_jobs (018), which is already "the hosted graphics for one
-- session's fan-out" — the daily publisher owns the row (034). Same best-effort contract as
-- ars_url/songs_url: NULL when the render or upload failed, the day publishes anyway, and the
-- console shows the gap. recap_caption is the paste-ready stream caption (the day's artists
-- and A&Rs by handle) and survives even when hosting does not.
--
-- Additive, nullable, zero backfill: a day published before this migration simply has no
-- recap graphics until the operator presses Publish the day again.
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS recap_cover_url TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS recap_thumb_url TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS recap_caption TEXT
