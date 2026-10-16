-- 047_grade_card.sql
-- The daily grade card (operator, 2026-10-15): "Do you have a better ear than <name>?"
--
--   photo_large_url  — a bigger copy of the SAME crop the A&R makes for their avatar (up to
--                      1200px square, uploaded beside the 400px one). The big-photo card needs
--                      it: a 400px avatar blown up to a 1080-wide card is soft. The crop is the
--                      focus point, so the face is already centred; nothing detects faces.
--                      NULL for everyone who uploaded before this, and for a source photo too
--                      small to give a big copy. Those A&Rs get the stats card until they
--                      upload a new photo.
--   grade_card_style — the A&R's pick: 'photo' or 'stats'. NULL = the default (photo when a
--                      big photo exists, else stats).
--
-- Additive only, no backfill. Safe on boot.
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_large_url TEXT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS grade_card_style TEXT
