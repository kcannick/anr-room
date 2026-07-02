-- 017_giveaway_flag.sql
-- Per-host giveaway inclusion. Controls whether a host's sessions count toward the
-- monthly $500 series (Decision 2, docs/multi-tenant-roadmap.md).
--
-- Semantics: NULL or 1 = included (opt-out model — the giveaway is a host's incentive,
-- so newly-upgraded hosts are in by default); 0 = excluded by the operator. Admins are
-- always eligible regardless of this value (their sessions are Makin' It's own). A session
-- only actually surfaces the $500 hook when it is ALSO tagged into a series (series_id) —
-- this flag is the per-host global switch on top of that per-session tag.
--
-- Additive, nullable; safe on boot.

ALTER TABLE users ADD COLUMN giveaway_eligible INTEGER
