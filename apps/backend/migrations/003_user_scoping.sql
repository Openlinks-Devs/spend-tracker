-- Add per-user ownership to ledger tables. Nullable for now so existing rows
-- survive; a backfill (scripts/backfill-owner.ts) then 004 makes it NOT NULL.
ALTER TABLE accounts     ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"("id") ON DELETE CASCADE;
ALTER TABLE categories   ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"("id") ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS accounts_user_id_idx     ON accounts(user_id);
CREATE INDEX IF NOT EXISTS categories_user_id_idx   ON categories(user_id);
CREATE INDEX IF NOT EXISTS transactions_user_id_idx ON transactions(user_id);
