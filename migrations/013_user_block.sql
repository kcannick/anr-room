-- 013_user_block.sql
-- Admin user management: a reversible block flag on users. A blocked user can't log in,
-- join, or vote, and is excluded from every public surface (leaderboards, the New A&Rs
-- ticker, the liveness join feed) — but their data is kept, so unblock fully restores
-- them. Hard delete (a separate, name-confirmed cascade) is the irreversible path.
--
-- Additive only (one flag with a default + index). Safe on boot.
-- Statements separated by a line of exactly --->.

ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked INTEGER NOT NULL DEFAULT 0
--->
CREATE INDEX IF NOT EXISTS idx_users_blocked ON users (blocked)
