-- 033_sidebet.sql
-- A&R Wars side contest ("the sidebet"): a free-entry prediction game at /sidebet.
--
-- An entrant predicts WHICH songs from the monthly A&R Service Pack will actually be
-- PLAYED at A&R Wars, and puts them in order. This is set membership, not ratings —
-- nothing here reads votes, room averages, or the series board, and no points are
-- awarded. The A&R Wars bracket is 8 competitors / 9 binary polls / 2 songs each = 18,
-- but that number is packs.picks_required, never hardcoded: it is derived from the
-- bracket shape (competitor count + final length), so either changing moves it.
--
-- The second job this does is seed the user base. An entrant becomes a `users` row with
-- NO `participants` row — a durable verified account that has never played a session.
--
-- WINNER: most correct. Ties broken by order distance (Spearman footrule) against the
-- CONSENSUS RANKING — the played songs ordered by how many entrants picked them. That
-- ranking is built from the entries themselves, which is why pick counts are sealed
-- until settle: a visible "340 people picked this" would make copying the crowd the
-- dominant strategy, every entry would converge, and the winner would be whoever
-- submitted first. Remaining ties go to the earliest updated_at.
--
-- pack_songs.row_no is LOAD-BEARING: when two played songs were picked by the same
-- number of entrants, CSV row order breaks the tie. It is fixed before any entry exists,
-- which is what makes the metric reproducible after the fact.
--
-- Additive; safe on boot. No backfill, no per-row work. Statements separated by --->.

CREATE TABLE IF NOT EXISTS packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                      -- "September 2026 A&R Service Pack"
  slug TEXT,                               -- optional permalink for a settled archive
  picks_required INTEGER NOT NULL DEFAULT 18,
  download_url TEXT,                       -- where the pack itself lives (not a gate)
  prize_text TEXT,                         -- "$150" — printed on the page
  sponsor_text TEXT,                       -- "courtesy of our sponsor"
  banner_id TEXT,                          -- banners.id; null = no sponsor slot at all
  wars_at BIGINT NOT NULL,                 -- tournament date/time (ms) — shown to entrants
  closes_at BIGINT NOT NULL,               -- entries freeze; MUST be < wars_at
  session_id TEXT,                         -- the A&R Wars room; linked at/near settle
  opens_at BIGINT,
  status TEXT NOT NULL DEFAULT 'draft',    -- draft | open | closed | settled
  settled_at BIGINT,
  created_at BIGINT NOT NULL
)
--->
-- /sidebet resolves to a single pack with no disambiguation, so only ONE may be open at
-- a time. Enforced in the endpoint (a partial unique index isn't portable across both
-- engines), but the lookup it guards runs on every page load.
CREATE INDEX IF NOT EXISTS idx_packs_status ON packs (status)
--->
CREATE TABLE IF NOT EXISTS pack_songs (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  row_no INTEGER NOT NULL,                 -- CSV order; breaks consensus-ranking ties
  title TEXT NOT NULL,
  artist TEXT,
  played INTEGER NOT NULL DEFAULT 0,       -- set at settle; the truth set
  created_at BIGINT NOT NULL
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pack_song_row ON pack_songs (pack_id, row_no)
--->
CREATE INDEX IF NOT EXISTS idx_pack_songs_pack ON pack_songs (pack_id)
--->
CREATE TABLE IF NOT EXISTS sidebet_entries (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  user_id TEXT NOT NULL,                   -- users.uid (verified — see the unique index)
  entry_no INTEGER,                        -- display number, 1-based per pack
  first_submitted_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,              -- the FINAL tiebreak; see below
  correct INTEGER,                         -- null until settle
  distance INTEGER,                        -- null until settle
  rank INTEGER,                            -- null until settle
  created_at BIGINT NOT NULL
)
--->
-- One entry per person per pack. This index is what makes "one entry per person" real
-- rather than a promise in the rules, and it is why identity has to be VERIFIED (email
-- OTP) before an entry row is ever written.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sidebet_entry ON sidebet_entries (pack_id, user_id)
--->
CREATE INDEX IF NOT EXISTS idx_sidebet_entries_pack ON sidebet_entries (pack_id)
--->
CREATE TABLE IF NOT EXISTS sidebet_picks (
  entry_id TEXT NOT NULL,
  pack_song_id TEXT NOT NULL,
  position INTEGER NOT NULL,               -- 1..picks_required
  PRIMARY KEY (entry_id, pack_song_id)
)
--->
-- The consensus ranking counts picks per song across every entry in a pack; settle reads
-- one entry's picks at a time. Both directions get an index.
CREATE INDEX IF NOT EXISTS idx_sidebet_picks_song ON sidebet_picks (pack_song_id)
--->
-- Which pack song each side of an A&R Wars matchup was. Populated when the host queues a
-- Versus round FROM the pack, which is how the played 18 derive with no extra work on
-- show night. Nullable: every existing round, and any hand-typed matchup, has none — and
-- settle is a host-confirmed checklist precisely so a hand-typed round is still fixable.
-- A title string compare would be the alternative, and it must never decide a cash prize.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS pack_song_a TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS pack_song_b TEXT
