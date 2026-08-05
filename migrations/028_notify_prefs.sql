-- 028_notify_prefs.sql
-- Notification contact center: per-topic, per-channel subscriptions for A&Rs.
-- SUBSCRIPTION CAPACITY ONLY — no digest sender ships with this migration.
--
-- WHY A TABLE, NOT COLUMNS ON `users`. Four topics x two channels is eight flags today,
-- and the roadmap already names the next ones (A&R Wars topics; a web-push channel) —
-- flat columns mean a migration per topic per channel, forever. Same call 027 made for
-- round_comments: don't widen a hot, universally-read row for a feature with its own
-- lifecycle. A JSON blob on `users` (the host_perms / host_defaults idiom) is ruled out
-- for a different reason: the audience query MUST be one set-based INSERT..SELECT (the
-- #1 rule — never a per-user loop), and JSON extraction is exactly where SQLite and
-- Postgres diverge. LEFT JOIN + COALESCE is identical on both.
--
-- SPARSE BY DESIGN. A row exists ONLY where a user made an EXPLICIT choice. An absent
-- row resolves to the topic's code-level default (NOTIFY_TOPICS in server.js) via
-- LEFT JOIN + COALESCE. That is what lets this ship with NO backfill: the existing base
-- gets sensible defaults with zero rows written, and changing a default later is a
-- constant edit, not a data migration.
--   COROLLARY, and it is deliberate: changing a default DOES change behaviour for
--   everyone who never chose. Do NOT "fix" that by materializing a row per user per
--   topic — that is precisely the row-count-scaling backfill the #1 rule forbids.
--
-- MASTERS STAY ON `users`. sms_marketing_consent / sms_consent_at remain the single
-- durable TCPA consent record; this table never duplicates them. A per-topic SMS row
-- only ever NARROWS that consent — it can never be the source of it.
--
-- Additive only (one table, one index, four nullable/defaulted columns). Nothing here
-- scales with row count; safe on the boot path.
-- Statements separated by a line of exactly --->.

CREATE TABLE IF NOT EXISTS notify_prefs (
  uid        TEXT NOT NULL,
  topic      TEXT NOT NULL,     -- room_live | vip_rooms | digest_daily | digest_weekly (grows)
  channel    TEXT NOT NULL,     -- 'email' | 'sms' (later 'push')
  enabled    INTEGER NOT NULL,  -- 1 subscribed | 0 unsubscribed. Never NULL: the ROW is the choice.
  source     TEXT,              -- audit: 'register' | 'prefs' | 'link' — where the choice was made
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (uid, topic, channel)
)
--->
-- Audience resolution drives from `users` and probes this table by uid, which the PK's
-- leading column already serves. This index serves the REVERSE direction — the admin
-- "how many opted out of topic X" readout — without re-scanning users, and gives
-- Postgres a small build side for a hash join.
CREATE INDEX IF NOT EXISTS idx_notify_prefs_topic ON notify_prefs (topic, channel, enabled)
--->
-- Global email kill switch (CAN-SPAM one-click unsubscribe). A column, not N rows, so
-- one click suppresses everything and the audience query ANDs it in with no second
-- join. Also gates the existing mass announcement (/api/admin/notify/start), which
-- today honours nothing — without this the unsubscribe link would be a lie.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_out INTEGER NOT NULL DEFAULT 0
--->
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_out_at BIGINT
--->
-- THE FIX for "phone on file, opted OUT of SMS". Today phone presence IS consent:
-- /api/auth/verify, /api/join/verify and /api/join/account each re-derive it, so a
-- deliberate opt-out is silently reversed by the next room the A&R joins.
-- NON-NULL here means "this user made an explicit SMS decision in the contact center",
-- after which the phone-presence derivation is permanently disabled FOR THAT USER, in
-- BOTH directions (an explicit ON is equally protected from being derived back OFF).
-- NULL preserves today's exact behaviour for everyone who never opens the contact
-- center — which is why no backfill is needed and nothing changes for the existing base.
-- NOTE: the registration checkbox writes topic rows only and does NOT stamp this. That
-- flag is about the SMS MASTER, and registration is where the phone-presence consent
-- basis lives, so it must not disable itself.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_pref_set_at BIGINT
--->
-- Proof that a revocation was honoured, and when. sms_consent_at is NEVER cleared — it
-- is the record of the GRANT; this is the record of the WITHDRAWAL. Both are kept so
-- the pair reads as a consent history rather than a mutable flag, which is what a TCPA
-- dispute actually needs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_optout_at BIGINT
