-- 005_referrals.sql
-- Referral tracking (low-risk, attribution-only — no rewards). Each participant gets a
-- short shareable ref_code; when someone joins via a link carrying a code we record
-- referred_by (the referrer's participant id). A referral is only *credited* once the
-- referee actually verifies AND plays a round (ref_credited flips to 1 at that point) —
-- this mirrors the "value attaches to active participation, not lineage" principle and
-- blunts self-referral / fake-account farming. All additive ADD COLUMNs, boot-safe.
--
-- Statements separated by a line of exactly --->.

ALTER TABLE participants ADD COLUMN IF NOT EXISTS ref_code TEXT
--->
ALTER TABLE participants ADD COLUMN IF NOT EXISTS referred_by TEXT
--->
ALTER TABLE participants ADD COLUMN IF NOT EXISTS ref_credited INTEGER NOT NULL DEFAULT 0
