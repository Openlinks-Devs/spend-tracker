-- Idempotent schema for SpendTracker CRUD entities.
-- Schema only: creates tables, inserts no data. Safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL,
  account_id uuid REFERENCES accounts(id),
  category_id uuid REFERENCES categories(id),
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- category_id is required at the application level. Enforcing NOT NULL is a
-- schema constraint (no data backfill here; on a fresh database there are no rows).
ALTER TABLE transactions ALTER COLUMN category_id SET NOT NULL;
