-- 009_broadcast_overlay.sql
-- Broadcasts default to player screens only. This flag lets the host opt a given
-- broadcast in to the OBS overlay too, where it rides in the lower-third slot
-- (mutually exclusive with the round/song card). Additive ADD COLUMN — safe on boot.
--
-- Statements separated by a line of exactly --->.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS broadcast_overlay BOOLEAN DEFAULT FALSE
