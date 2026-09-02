-- 033_async_drop.sql
-- A&R Daily: the async daily drop. Every day a set of records opens SIMULTANEOUSLY over one
-- ~21-hour window (12:00PM ET -> 9:00AM ET next day), and each A&R walks their own queue at
-- their own pace. This becomes the primary points engine; the weekly live show becomes a
-- special event on the same unified board.
--
-- THE DAY IS VARIABLE IN SIZE. Drupal draws 4 at random from the free pool plus UP TO 12 paid
-- submissions, so a day is 4-16 records and only reaches 16 when the paid queue is full or
-- backlogged. Nothing here — or in any consumer — may hardcode 16.
--
-- sessions.mode — NULL/'live' = the weekly show, exactly as today. 'async' = a daily drop.
--   A NEW AXIS, not a new sessions.status: status is validated against a closed list
--   (server.js, /api/admin/session/status) and read by /api/home, the Stream Deck resolver,
--   playerState's recap flip and every session list. Adding a fifth status would mean auditing
--   all of them; a nullable mode column means every existing row keeps today's behavior with no
--   backfill. Same shape as visibility (019) and ingest_auto (031).
--
-- THE WINDOW IS STORED AS ABSOLUTE EPOCHS, NOT A DURATION. clampMinutes pins every live window
--   to 2-60 minutes; 21 hours has no representation there and must not be forced through it.
--   Absolute boundaries also make the lifecycle cron idempotent by comparison rather than by
--   arithmetic, and make DST a non-event: the window crosses the switch twice a year, and
--   deriving the close as "opens_at + 21h" would give an 8AM or 10AM close on those two days.
--     window_opens_at  — 12:00PM ET on drop_day
--     window_closes_at — 9:00AM ET the NEXT day (rating closes, every round ratifies)
--     results_at       — 12:00PM ET the next day (results publish, recap unlocks)
--     published_at     — when the publisher actually finished; NULL until then
--
-- sessions.async_state — the drop's own lifecycle, and it earns its own column because the
--   9AM-to-noon gap (ratified but NOT yet published) is a state `status` cannot express.
--   Flipping status to 'completed' at 9AM would trip playerState's recap branch and reveal
--   results three hours early.
--     NULL/'scheduled' -> 'open' -> 'closing' -> 'ratified' -> 'published'
--   It is ALSO the cron's claim token: every transition is a conditional UPDATE that exactly
--   one invocation can win (the drainArtistSms pattern), which is what makes a double-invoked
--   Vercel cron safe.
--
-- sessions.drop_day — 'YYYY-MM-DD' in ET (chartDay shape). The human key for a day, and what
--   the completion-bonus tiers are computed from. The unique index below is PARTIAL on
--   deleted_at IS NULL on purpose: soft-deleting a botched drop must free the day back up so
--   the operator can re-push it, and that is their only self-service way out.
--
-- sessions.live_bonus — points awarded at session end to an A&R who rated every ratified round
--   of a LIVE show. The unified-board knob: ~480 async rounds/month vs ~48 live ones means the
--   live show is decorative on the leaderboard without it. NULL/0 = no bonus, so every existing
--   session is unaffected. Deliberately NOT a points multiplier — a multiplier would rewrite
--   votes.points, which every board sum, share card, Song Report, chart and recap reads (making
--   "max 125" untrue everywhere), it would multiply NEGATIVE rounds into a penalty rather than a
--   bonus, and it could not be undone without the heavy per-row migration the #1 rule forbids.
--
-- rounds.play_url — the link the A&R plays (MP3 or DSP). This is the product: an async A&R
--   listens here, not on a stream. NOT folded into song_note — that field is already overloaded
--   (stageIngestRound stuffs 'IG: @handle' into it), it is rendered verbatim to the room, and
--   cardSongsData regex-scrapes it for the IG handle.
-- rounds.artist_note — the artist's own note from the submission form. It is CONTEXT, not a
--   question: "this isn't mixed, I recorded it on Bandlab last night", or "I've been working on
--   this for 7 months and mixed it 5 times, I think this is the one". It tells the A&R how to
--   hear the record, which is the differentiator of the whole review — the host reads it on air
--   during the live show, and until now it never reached the room at all. Distinct from the
--   host's own song_note, which is the host talking to the room rather than the artist.
-- rounds.artist_instagram — the artist's IG handle, bare (no @). It has always arrived on the
--   review push, but only as a string stuffed into song_note ('IG: @handle') that cardSongsData
--   regex-scrapes back out. That was fine while it was only ever printed; it is not fine now
--   that the player RENDERS A FOLLOW BUTTON from it. Its own column, written alongside the
--   legacy song_note string so the existing share-card scrape keeps working untouched.
-- rounds.artist_profile_url — the artist's PUBLIC profile on makinitmag.com. Deliberately NOT
--   ingest_url: that is the admin deep link to the submission node and is platform-admin only
--   because it carries the submitter's contact details. Conflating a public link with an
--   internal one is how PII leaks. Absent = the button is not rendered at all.
-- rounds.ingest_ref / ingest_url — the submission's id in Drupal and a deep link back to it.
--   Drupal stays the system of record for submissions; the app holds a working copy. The link
--   is what makes submissions accessible in one click without the app needing to know how to
--   talk to Drupal, and the ref is what lets a re-push UPDATE a round instead of duplicating it.
--   NOT unique: duplicate detection happens in code, all-or-nothing, before any insert.
-- rounds.scout_drupal_uid — the A&R who referred this artist, as their Makin' It (Drupal) uid,
--   captured from a makinitmag.com/review?a=<uid> scouting link. Stored UNCONDITIONALLY, even
--   when no A&R Team account can be matched to it, because Drupal's own ambassador and promo
--   reporting reads this and must not depend on the app having resolved the person.
-- rounds.tally_claimed_at — when the lifecycle cron claimed this round for tallying. Lets a
--   claim left behind by a dead invocation be reaped safely; nothing else can distinguish a
--   claim in flight from one abandoned mid-tally, and re-running ratifyRound would double-bump
--   participants.total_points.
--
-- users.drupal_uid — the link between an A&R Team account and a Makin' It account. Populated
--   lazily: the scouting push carries the referrer's Drupal uid AND their email, and the first
--   successful email match writes the uid here permanently. No handshake and no connect UI —
--   the mapping accumulates as a side effect of normal use. Partial-unique so two A&R Team
--   accounts can never claim the same Makin' It identity.
--
-- recap_jobs (018) is already "the shared card URLs for one session's fan-out". The daily
--   publisher is the same thing on a cron instead of a host's click, so it reuses the row rather
--   than cloning the table. stage is its state machine, claimed_at is the anti-double-invoke
--   claim, caption is the paste-ready Instagram caption.
--
-- notify_broadcasts (022) is already "one fan-out event" and notify_recipients' PK
--   (broadcast_id, uid, channel) already gives exactly-once. A daily digest IS a fan-out event.
--   kind + ref_id tag it so the drain renders the digest template rather than the announcement
--   one, and so a re-run of the publisher finds the existing row instead of making a second.
--
-- round_reports — an A&R telling us a record cannot be evaluated. On a live show a dead link
--   is visible to the host within seconds; across a 21-hour window with nobody watching, the
--   only signal is the A&Rs themselves. Two reasons, deliberately: 'not_playable' is the one
--   that needs fixing and 'other' is the catch-all — a free-text support queue with no owner
--   is worse than no button at all, so the body is optional and advisory.
--   UNIQUE (round_id, participant_id): one report each, so the count is people not clicks.
--
-- All additive and nullable; nothing scales with row count; safe on the boot path.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode TEXT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS drop_day TEXT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS window_opens_at BIGINT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS window_closes_at BIGINT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS results_at BIGINT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS published_at BIGINT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS async_state TEXT
--->
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS live_bonus INTEGER
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS play_url TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS artist_note TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS artist_instagram TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS artist_profile_url TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ingest_ref TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ingest_url TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS scout_drupal_uid TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS tally_claimed_at BIGINT
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS drupal_uid TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS stage TEXT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS claimed_at BIGINT
--->
ALTER TABLE recap_jobs ADD COLUMN IF NOT EXISTS caption TEXT
--->
ALTER TABLE notify_broadcasts ADD COLUMN IF NOT EXISTS kind TEXT
--->
ALTER TABLE notify_broadcasts ADD COLUMN IF NOT EXISTS ref_id TEXT
--->
-- One live drop per ET day. Partial on deleted_at so soft-deleting a botched drop frees the
-- day for a re-push. This index — not the SELECT in the builder — is what makes two
-- simultaneous pushes safe: they race on the constraint and the loser becomes a clean 409.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_drop_day
  ON sessions (drop_day) WHERE drop_day IS NOT NULL AND deleted_at IS NULL
--->
-- The lifecycle cron's "what is due" probe. A day leaves the working set permanently once it
-- reaches 'published', so this stays selective forever and the cron never scans sessions.
CREATE INDEX IF NOT EXISTS idx_sessions_async_state ON sessions (async_state)
--->
CREATE INDEX IF NOT EXISTS idx_rounds_ingest_ref ON rounds (ingest_ref)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_drupal_uid
  ON users (drupal_uid) WHERE drupal_uid IS NOT NULL
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_broadcast_kind_ref
  ON notify_broadcasts (kind, ref_id) WHERE kind IS NOT NULL AND ref_id IS NOT NULL
--->
CREATE TABLE IF NOT EXISTS round_reports (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  reason TEXT NOT NULL,              -- 'not_playable' | 'other'
  body TEXT,                         -- optional, advisory only
  created_at BIGINT NOT NULL
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_round_report ON round_reports (round_id, participant_id)
--->
CREATE INDEX IF NOT EXISTS idx_round_report_session ON round_reports (session_id, reason)
