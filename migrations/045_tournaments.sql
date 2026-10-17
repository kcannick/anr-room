-- 045_tournaments.sql
-- Tournament tooling (operator, 2026-10-07): A&R Wars and the $1,000 Music Review Tournament
-- share ONE model, keyed on `kind`. Spec: docs/specs/tournament-spec.md.
--
-- tournaments — the event. One linked live Versus session (session_id) carries the polls and
-- is tagged into the Series like any other session so viewer points count. pack_id links the
-- A&R Service Pack the A&R kind plays from (the artist kind plays catalog, pack_id NULL).
-- final_polls is how many polls the final takes (3 — the number Pick the Hits counts on);
-- never hardcoded in code. graphics is a JSON map of hosted PNG urls per stage/kind.
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  number INTEGER,
  slug TEXT NOT NULL UNIQUE,
  prize_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  event_at BIGINT,
  session_id TEXT,
  pack_id TEXT,
  watch_url TEXT,
  final_polls INTEGER NOT NULL DEFAULT 3,
  winner_competitor_id TEXT,
  graphics TEXT,
  caption TEXT,
  remind_min INTEGER NOT NULL DEFAULT 120,
  created_by TEXT,
  created_at BIGINT NOT NULL
)
--->
-- A competitor is a ROW, not a user: an A&R row keeps user_id and is filled from the profile;
-- an artist row is filled from the week's #1 record and the operator uploads a photo. Every
-- field is editable so a missing photo or a wrong handle never blocks a graphic.
-- seat = the order the seats were FILLED (1..8, drives the weekly qualifier flyer: seat N is
-- the big picture on flyer N); seed = tournament seeding (drives the bracket). Different facts.
-- qualified_label prints on the flyer ("Week 3", "Picked").
-- source labels where the seat came from ("Week of Sep 28 · Top A&R", "picked").
CREATE TABLE IF NOT EXISTS tournament_competitors (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  seat INTEGER,
  qualified_label TEXT,
  user_id TEXT,
  name TEXT NOT NULL,
  handle TEXT,
  city TEXT,
  photo_url TEXT,
  source TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (tournament_id, seed)
)
--->
-- The 7 matches of an 8-seed single-elimination bracket: round 1 slots 1..4, round 2 slots
-- 1..2, round 3 slot 1. Polls (binary rounds) point at a match via rounds.tournament_match_id.
-- decided_by: 'polls' (the audience) or 'host' (a tie, or an override).
CREATE TABLE IF NOT EXISTS tournament_matches (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  a_id TEXT,
  b_id TEXT,
  winner_id TEXT,
  decided_by TEXT,
  decided_at BIGINT,
  UNIQUE (tournament_id, round_no, slot)
)
--->
-- The landing page's reminder list: an email, no account. reminded_at marks the send so the
-- cron never sends twice; unsub_token is the one-click opt-out in the reminder.
CREATE TABLE IF NOT EXISTS tournament_subscribers (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  unsub_token TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  reminded_at BIGINT,
  unsubscribed_at BIGINT,
  UNIQUE (tournament_id, email)
)
--->
CREATE INDEX IF NOT EXISTS idx_tournament_subs_send ON tournament_subscribers (tournament_id, reminded_at)
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS tournament_match_id TEXT
--->
CREATE INDEX IF NOT EXISTS idx_rounds_tournament_match ON rounds (tournament_match_id)
