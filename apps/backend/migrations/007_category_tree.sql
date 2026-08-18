-- Categories nest, and each one carries an emoji the clients render next to the
-- name. Production already has both columns and the data to match (they predate
-- this file, which is why the API never surfaced them), so every statement here
-- is conditional and applies as a no-op there.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS emoji text;

-- ON DELETE SET NULL, not CASCADE: removing a parent must not silently take its
-- children - and the rows they categorise - with it. The children become roots.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS categories_parent_id_idx ON categories(parent_id);
