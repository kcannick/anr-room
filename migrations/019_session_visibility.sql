-- 019_session_visibility.sql
-- Invite-only sessions.
--   visibility: NULL/'public' = listed on the public homepage; 'unlisted' = reachable
--     only by direct link/QR (never surfaced as the featured live/next session).
--   access_code: optional room code — when set, joining the session requires it
--     (checked at /api/join/request; case-insensitive). NULL = open join.
-- Both additive + nullable; safe on boot.

ALTER TABLE sessions ADD COLUMN visibility TEXT
--->
ALTER TABLE sessions ADD COLUMN access_code TEXT
