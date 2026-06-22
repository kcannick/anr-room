-- 007_session_softdelete.sql
-- Soft-delete for sessions: hidden from all management/listing views but the row and
-- its data are retained (admin can purge later if ever needed). Additive, boot-safe.
--
-- Statements separated by a line of exactly --->.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at BIGINT
