-- 043_email_engagement.sql
-- Email engagement gate (2026-10-06). The audit found the daily "records are open" notice
-- going to every registered address (~766 a day) while ~170 of them had rated or clicked
-- anything in 30 days. Audience queries now gate on activity (see notifyAudience / ENGAGED_DAYS
-- in server.js); this migration adds the two columns of state that gate needs.
--
-- users.email_bounced_at: set when the provider REJECTS a send for a hard bounce, an invalid
-- address, a spam report or a provider-side unsubscribe. Every email audience skips it. Never
-- cleared automatically — a changed address on the profile is the way back.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_bounced_at BIGINT
--->
-- The weekly update's sunset counts an A&R's sent weekly rows since their last activity, so
-- the recipients table needs a path by uid (it only had (broadcast_id, status)).
CREATE INDEX IF NOT EXISTS idx_notify_rcpt_uid ON notify_recipients (uid, channel, status)
