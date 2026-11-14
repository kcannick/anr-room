-- 054_chart_notices.sql
-- Notify a chart's list (operator, 2026-11-12): email + SMS to everyone on a chart the Charts
-- screen built — the HOT 100's artists, a Top A&Rs board, any list the console can rank.
-- One send = one chart_notices row (the composed message, the list it went to); one recipient
-- row per (send, channel, address), claimed pending -> sending like every other queue here, so
-- two tabs or a double press can never mail anyone twice. The list is identified by its
-- canonical chart query (`list_key`), so "the same list" is reproducible, not a stored roster.
-- Times are BIGINT: epoch milliseconds overflow a Postgres int4.
CREATE TABLE IF NOT EXISTS chart_notices (
  id TEXT PRIMARY KEY,
  list_key TEXT NOT NULL,
  list_label TEXT NOT NULL,
  mode TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  sms_body TEXT,
  post_url TEXT,
  by_uid TEXT,
  created_at BIGINT NOT NULL
)
--->
CREATE TABLE IF NOT EXISTS chart_notice_rcpts (
  id TEXT PRIMARY KEY,
  send_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  dest TEXT NOT NULL,
  uid TEXT,
  round_id TEXT,
  rank INTEGER,
  name TEXT,
  title TEXT,
  artist TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
)
--->
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chart_notice_rcpt ON chart_notice_rcpts (send_id, channel, dest)
--->
CREATE INDEX IF NOT EXISTS idx_chart_notice_rcpt_status ON chart_notice_rcpts (status, created_at)
--->
CREATE INDEX IF NOT EXISTS idx_chart_notices_list ON chart_notices (list_key, created_at)
