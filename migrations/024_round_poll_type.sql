-- 024_round_poll_type.sql
-- Makes poll type PER-ROUND. Until now a session was locked to one poll_type at
-- creation and every round inherited it; this lets a single room mix 0-9 rating and
-- binary (Versus) rounds. `rounds.poll_type` becomes the source of truth;
-- `sessions.poll_type` demotes to "the default type for the FIRST round" + a display hint.
--
-- Two statements: an additive ADD COLUMN, then a ONE-SHOT set-based backfill so existing
-- binary sessions' rounds get poll_type='binary' (rating is the default, already correct).
-- The backfill is a single UPDATE bounded by the small `rounds` table — NOT a per-user
-- JS recompute — so it's safe on the boot/light path (see CLAUDE.md #1 rule).
--
-- Statements separated by a line of exactly --->. Idempotent (ADD COLUMN IF NOT EXISTS;
-- the backfill is naturally re-runnable — it just re-sets the same rows).

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS poll_type TEXT NOT NULL DEFAULT 'rating'
--->
UPDATE rounds SET poll_type = 'binary'
 WHERE session_id IN (SELECT id FROM sessions WHERE poll_type = 'binary')
