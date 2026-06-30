-- 011_series.sql
-- The Series layer: a display-metadata container that groups tagged weekly sessions
-- into a monthly competition whose leaderboard feeds A&R Wars qualification.
--
-- Design principle (from the product brief §9): the Series is a DISPLAY container,
-- not a controller. title/description/target_sessions/dates are for display only —
-- they describe intent, they do NOT determine membership. Membership is an explicit
-- TAG: sessions.series_id. This preserves flexibility for off-schedule bonus streams
-- (a Friday special counts iff you tag it).
--
-- Series points are LIVE-COMPUTED (sum votes.points across a series' tagged sessions),
-- never stored — so the board stays correct through retroactive tagging, re-ratification,
-- and vote corrections. The indexes below make that live sum fast.
--
-- Additive only (new table + nullable column + indexes). Safe on boot.
-- Statements separated by a line of exactly --->.

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',   -- upcoming | active | closed
  target_sessions INTEGER,                    -- optional, DISPLAY ONLY (not a filter)
  qualify_count INTEGER NOT NULL DEFAULT 8,   -- top-N who qualify for A&R Wars (drives the cut)
  start_date BIGINT,                          -- optional, DISPLAY ONLY
  end_date BIGINT,                            -- optional, DISPLAY ONLY
  created_at BIGINT NOT NULL
)
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS series_id TEXT
--->
CREATE INDEX IF NOT EXISTS idx_sessions_series ON sessions (series_id)
--->
CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds (session_id)
--->
CREATE INDEX IF NOT EXISTS idx_votes_round ON votes (round_id)
