-- 016_host_perms.sql
-- Per-host feature permissions, stored as JSON: { sms, ads, export, broadcast }.
-- Null/absent = NONE granted — a newly-upgraded host gets no advanced features until an
-- admin explicitly grants them. Platform admins are unrestricted regardless of this value.
-- Additive, nullable; safe on boot.

ALTER TABLE users ADD COLUMN host_perms TEXT
