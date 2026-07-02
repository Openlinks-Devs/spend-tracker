-- Idempotent schema + seed for SpendTracker CRUD entities.
-- Safe to run repeatedly against the same database.

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

-- Seed a single default account (guarded so re-running is safe).
INSERT INTO accounts (name, type, currency)
SELECT 'Cash', 'cash', 'PEN'
WHERE NOT EXISTS (
  SELECT 1 FROM accounts existing WHERE existing.name = 'Cash'
);

-- Seed a few default categories (guarded so re-running is safe).
INSERT INTO categories (name, type)
SELECT seed.name, seed.type
FROM (
  VALUES
    ('Food', 'expense'),
    ('Transport', 'expense'),
    ('Utilities', 'expense'),
    ('Salary', 'income')
) AS seed(name, type)
WHERE NOT EXISTS (
  SELECT 1 FROM categories existing WHERE existing.name = seed.name
);
