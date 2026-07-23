-- Runs only after scripts/backfill-owner.ts has populated user_id on every row.
ALTER TABLE accounts     ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE categories   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;
