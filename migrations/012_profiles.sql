-- 012_profiles.sql
-- User profiles (Tier 3.5a). Profile fields live on `users` — the durable identity
-- spine — because identity is cross-session (series leaderboards, prizes, A&R Wars).
--
-- A complete profile is the qualification gate (3.5c): leaderboard visibility, prize
-- eligibility, and A&R Wars all require it, and it doubles as payout KYC. "Complete"
-- (decided with the operator) = display name + at least one category + a primary
-- category + location. Socials and photo are optional. `profile_complete` is a stored
-- flag, recomputed by the server whenever the profile is saved, so the gate filter is
-- a cheap indexed read instead of a per-row derivation.
--
-- Photo is deferred (fast-follow with managed object storage): the column exists now,
-- gets populated later — leaderboard/feed use initials avatars until then.
--
-- `categories` holds a JSON array of category keys (e.g. ["DJ","Producer"]).
--
-- Additive only (nullable columns + one flag with a default + one index). Safe on boot.
-- Statements separated by a line of exactly --->.

ALTER TABLE users ADD COLUMN IF NOT EXISTS categories TEXT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_category TEXT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram TEXT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok TEXT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_complete INTEGER NOT NULL DEFAULT 0
--->
CREATE INDEX IF NOT EXISTS idx_users_profile_complete ON users (profile_complete)
