-- 006_geocheckin.sql
-- Location-gated check-in for on-premise events. The venue pin and the enforcement
-- toggle are SEPARATE: a host can set the venue (by geocoded address) days ahead while
-- check-in stays off, then flip enforcement on at the door. Check-in happens at first
-- vote lock-in (not at entry), tagging each player in_person | online.
--
-- PRIVACY: we deliberately do NOT store precise attendee coordinates. Only the result
-- (pool) and a coarse distance-at-checkin (for abuse auditing) are kept. The venue pin
-- is a place, not a person.
--
-- All additive ADD COLUMNs, boot-safe. Statements separated by a line of exactly --->.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS geo_mode TEXT NOT NULL DEFAULT 'off'
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS geo_lat REAL
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS geo_lng REAL
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS geo_radius INTEGER
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS geo_label TEXT
--->
ALTER TABLE participants ADD COLUMN IF NOT EXISTS pool TEXT
--->
ALTER TABLE participants ADD COLUMN IF NOT EXISTS checkin_distance INTEGER
