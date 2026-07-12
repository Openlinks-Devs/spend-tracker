-- Idempotent migration: widen the transaction amount columns so 3-decimal
-- currencies (BHD, KWD, OMR, JOD, TND) are stored exactly instead of being
-- silently rounded to 2 decimals by numeric(14, 2). Safe to run repeatedly:
-- ALTER COLUMN ... TYPE is a no-op once the column already has the target
-- type and precision.

ALTER TABLE transactions ALTER COLUMN amount TYPE numeric(18, 4);
ALTER TABLE transactions ALTER COLUMN base_amount TYPE numeric(18, 4);
ALTER TABLE transactions ALTER COLUMN to_amount TYPE numeric(18, 4);
