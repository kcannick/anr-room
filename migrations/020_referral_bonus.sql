-- 020_referral_bonus.sql
-- Referral bonus milestones (operator decision, 2026-07-04):
--   invitee reaches 10 cumulative scored rounds → referrer +10 pts
--   invitee reaches 50 cumulative scored rounds → referrer +75 pts
-- Points land on the ratified session's series board (that month's $500 race) AND the
-- referrer's lifetime total. Each invitee fires each milestone once, ever.
--
--   users.referrer_uid — durable FIRST-TOUCH attribution: the user whose share link
--     brought this account in. Set once at the invitee's first referred join; never
--     reassigned. (participants.referred_by stays the per-session record.)
--   point_events — append-only bonus ledger, summed into the live-computed boards
--     alongside votes.points (never denormalized into a stored rollup).
--     The unique index is the idempotency guarantee: one row per
--     (reason, source_uid, milestone) no matter how many ratifies race.
-- Additive; safe on boot.

ALTER TABLE users ADD COLUMN referrer_uid TEXT
--->
CREATE TABLE IF NOT EXISTS point_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,        -- recipient (the referrer)
  points INTEGER NOT NULL,
  series_id TEXT,               -- board the bonus counts toward; NULL = lifetime only
  reason TEXT NOT NULL,         -- 'referral'
  source_uid TEXT,              -- the invitee whose activity fired the milestone
  milestone INTEGER,            -- 10 | 50 (cumulative scored rounds)
  created_at BIGINT NOT NULL
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_point_event_once ON point_events (reason, source_uid, milestone)
--->
CREATE INDEX IF NOT EXISTS idx_point_events_series ON point_events (series_id)
--->
CREATE INDEX IF NOT EXISTS idx_point_events_user ON point_events (user_id)
