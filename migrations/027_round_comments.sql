-- 027_round_comments.sql
-- Optional per-round comment: after an A&R locks in, they may write one short note about
-- the record. Deliberately NOT a column on `votes` — that table is read by every
-- leaderboard sum and every ratify recompute, and hanging a TEXT body plus moderation
-- state off it would widen the hottest row in the app for a field none of those paths use.
--
-- SEALED, like the vote split: a comment is never visible to another player, the overlay,
-- or any public surface. "This one's a 9 for me" leaks vote direction just as surely as
-- showing the average would, so the only readers are the comment's author and the host.
-- Server-enforced; there is no public read path.
--
-- status — pending | shared | hidden. Default 'pending' means nothing reaches the artist
--   until the host explicitly approves it. 'hidden' is an EXPLICIT reject, kept distinct
--   from 'pending' so the host's queue count actually drains to zero each week instead of
--   carrying the same junk forward forever.
--
-- session_id is denormalized off rounds so the host's per-session queue and the purge
-- cascade need no join. A round never changes session, so it can't drift.
--
-- No points are awarded for commenting — deliberate. Points on this board are
-- accuracy-derived (skill-only, cash prize); paying for free text would put non-accuracy
-- points on the prize board and optimize for volume over quality.
--
-- Additive; safe on boot. Statements separated by a line of exactly --->.

CREATE TABLE IF NOT EXISTS round_comments (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  session_id TEXT NOT NULL,               -- denormalized from rounds (immutable)
  participant_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | shared | hidden
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
)
--->
-- One comment per A&R per round — the same shape as uniq_vote, and what makes the
-- player-side save an idempotent upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_round_comment ON round_comments (round_id, participant_id)
--->
-- The host's Rounds-tab queue reads every comment for one session at once.
CREATE INDEX IF NOT EXISTS idx_round_comment_session ON round_comments (session_id, status)
