-- 010_users_email_unique.sql
-- Defensive: the users schema already declares `email ... UNIQUE`, so fresh
-- databases enforce this. But an existing production database created before that
-- constraint existed may lack a unique index on users.email. This adds it
-- explicitly and idempotently (CREATE UNIQUE INDEX IF NOT EXISTS works on both
-- Postgres and SQLite).
--
-- If this migration ever FAILS, it means there are genuine duplicate emails in
-- the users table — which is exactly the corruption this guards against. The
-- runner will surface the failure loudly; resolve the duplicates, then re-run.
--
-- Statements separated by a line of exactly --->.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (email)
