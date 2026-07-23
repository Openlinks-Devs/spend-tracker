-- apps/backend/migrations/005_connections.sql
-- Per-user integrations: linked external accounts, import dedupe, single-use codes.

CREATE TABLE IF NOT EXISTS connection (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  provider          text NOT NULL,
  status            text NOT NULL DEFAULT 'active',
  external_id       text NOT NULL,
  secret_encrypted  bytea,
  key_version       int,
  cursor            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz
);
CREATE INDEX IF NOT EXISTS connection_user_id_idx ON connection(user_id);
-- A user cannot link the same external account twice.
CREATE UNIQUE INDEX IF NOT EXISTS connection_user_provider_external_idx
  ON connection(user_id, provider, external_id);
-- A Telegram chat pairs to at most one user globally (deterministic webhook resolution).
CREATE UNIQUE INDEX IF NOT EXISTS connection_telegram_chat_idx
  ON connection(provider, external_id) WHERE provider = 'telegram';

CREATE TABLE IF NOT EXISTS import_source (
  connection_id  uuid NOT NULL REFERENCES connection(id) ON DELETE CASCADE,
  message_id     text NOT NULL,
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, message_id)
);

CREATE TABLE IF NOT EXISTS pairing_code (
  code        text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  purpose     text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false;
