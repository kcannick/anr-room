-- 044_brevo_sync.sql
-- Contacts into Brevo (operator, 2026-10-05): every artist whose record the platform has
-- played goes onto an Artists list (email + phone ONLY — names on rounds are whatever the
-- submitter typed), and every registered A&R onto an A&Rs list with their full profile.
--
-- This table is the sync ledger: what was last sent for each contact on each list, as a
-- hash of the payload. It is what lets the daily run send only the contacts that are new or
-- changed instead of the whole base every day. Nothing is ever removed from a Brevo list.
--
-- list        — 'artists' | 'ars'
-- contact_key — e:<email> or s:<E.164 phone> (an artist with a phone and no email)
-- hash        — sha256 of the payload last accepted by Brevo for this contact
CREATE TABLE IF NOT EXISTS brevo_sync (
  list TEXT NOT NULL,
  contact_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  synced_at BIGINT NOT NULL,
  PRIMARY KEY (list, contact_key)
)
