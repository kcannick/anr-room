-- 021_host_defaults.sql
-- Per-host defaults that prefill every new room the host creates (multi-tenant
-- onboarding: set once, then every show is two clicks).
--   users.host_defaults — JSON {watchUrl, submitUrl, lobbyMessage, bannerId}.
--     Prefill-only data (never queried/filtered), so one JSON column.
--   banners.owner_uid — a host's personal default banner is a room-less banner OWNED
--     by them (session_id NULL + owner_uid set). Distinguishes it from platform-global
--     banners (both NULL) so it never leaks into other hosts' libraries.
-- Both additive + nullable; safe on boot.

ALTER TABLE users ADD COLUMN host_defaults TEXT
--->
ALTER TABLE banners ADD COLUMN owner_uid TEXT
