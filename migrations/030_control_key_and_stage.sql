-- 030_control_key_and_stage.sql
-- Two additions supporting staged rounds + external (Stream Deck) control.
--
-- users.control_key — a long-lived per-HOST key for /api/control/*. Per host, not per room,
--   so a Stream Deck is configured once and never again: the endpoints resolve the key to
--   whichever room that host currently has live (the same live-then-upcoming resolution the
--   host-keyed overlay already uses). Scope is round control ONLY — it can never read A&R
--   contact details, change settings, or delete anything. Nullable: a host has no key until
--   they generate one, and regenerating simply overwrites.
--
-- sessions.advance_armed_at / advance_armed_round — the double-press guard on Ratify.
--   Ratify is the one irreversible step in the loop (it computes points and flips every
--   player to results), and a Stream Deck is a physical key that can be leaned on. The first
--   press ARMS, the second within the window commits.
--
--   This state lives in the DB rather than in memory ON PURPOSE: on Vercel each request may
--   hit a different instance, so an in-memory arm would be invisible to the confirming press
--   and the guard would either never arm or never fire. The round id is stored alongside the
--   timestamp so an arm can't leak across rounds — a stale arm from the previous song must
--   never let a single press tally the next one.
--
-- The 'listening' round status this release introduces needs NO migration: rounds.status is
-- a free TEXT column with no constraint, and listening rounds simply carry closes_at = NULL.
--
-- Additive; safe on boot. Statements separated by a line of exactly --->.

ALTER TABLE users ADD COLUMN IF NOT EXISTS control_key TEXT
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_control_key ON users (control_key)
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS advance_armed_at BIGINT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS advance_armed_round TEXT
