-- apps/backend/migrations/006_email_log.sql
-- Email inbox: turn import_source into a per-email audit log with a verdict.
-- No new table: a second row per email would only have to agree with this one.

ALTER TABLE import_source
  ADD COLUMN IF NOT EXISTS sender     text,
  ADD COLUMN IF NOT EXISTS subject    text,
  ADD COLUMN IF NOT EXISTS email_date timestamptz,
  ADD COLUMN IF NOT EXISTS verdict    text,
  ADD COLUMN IF NOT EXISTS attempts   integer NOT NULL DEFAULT 0;

-- ADD CONSTRAINT has no IF NOT EXISTS form, so drop first to keep the file
-- replayable against a database that was baselined by hand (see OPS.md).
ALTER TABLE import_source DROP CONSTRAINT IF EXISTS import_source_verdict_check;
ALTER TABLE import_source
  ADD CONSTRAINT import_source_verdict_check
  CHECK (verdict IS NULL OR verdict IN
    ('imported','not_transaction','not_configured','extract_failed','failed','unknown'));

-- Listing filters by user through the connection join, so the index leads with
-- connection_id. A user has at most five connections.
CREATE INDEX IF NOT EXISTS import_source_connection_created_idx
  ON import_source (connection_id, created_at DESC);

-- Existing rows predate the verdict. A transaction proves an import; the rest
-- cannot be reconstructed without re-fetching from Gmail.
UPDATE import_source
   SET verdict = CASE WHEN transaction_id IS NOT NULL THEN 'imported' ELSE 'unknown' END
 WHERE verdict IS NULL;
