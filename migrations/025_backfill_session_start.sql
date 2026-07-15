-- 025_backfill_session_start.sql
-- Every STARTED room (live/completed/archived) gets a real start time. scheduled_at
-- was only ever set when a host scheduled an 'upcoming' room, so rooms created
-- directly as 'live' (the common case) have NULL — their cards show a date-only
-- created_at fallback and can't be ordered by when they actually ran.
--
-- Best available approximation, in order: when the session's first round opened
-- (MIN over rounds of opens_at — the show demonstrably running), else the first
-- round's creation time, else the session's creation time.
--
-- 'upcoming' rooms are deliberately left NULL — they haven't started, and a NULL
-- there means "not scheduled yet" (it drives the homepage "next room" ordering).
--
-- Going forward the server stamps scheduled_at itself (at creation for born-live
-- rooms; on the go-live transition otherwise), so this is a one-shot backfill of
-- pre-existing rows. Set-based UPDATE bounded by the small sessions table — safe
-- on the boot/light path (CLAUDE.md #1 rule). Idempotent: touched rows get a
-- non-NULL scheduled_at and stop matching the WHERE.

UPDATE sessions SET scheduled_at = COALESCE(
  (SELECT MIN(COALESCE(r.opens_at, r.created_at)) FROM rounds r WHERE r.session_id = sessions.id),
  created_at)
WHERE scheduled_at IS NULL AND status <> 'upcoming'
