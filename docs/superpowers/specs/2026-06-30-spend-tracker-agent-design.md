# SpendTracker Autonomous Agent - Design

Date: 2026-06-30

## Goal

Convert the existing `SpendTracker.json` n8n workflow into a standalone,
self-hosted autonomous agent that scans the user's Gmail inbox, detects bank
transaction emails, extracts structured spend data with an LLM, records each
transaction in the existing Postgres database, and notifies the user over
Telegram. It also keeps n8n's Telegram editing parity: replying to a
notification edits a transaction, and `/delete` removes it.

This is a faithful, deterministic port of the n8n flow. LLMs do only the two
language tasks the flow used them for (detect + extract, plus reclassify on
edit). All routing, validation, and persistence is plain code.

## Stack

- **Hono.js** served through the **`@hono/node-server`** Node adapter. Hono
  provides the HTTP surface: health check, Google OAuth callback (one-time
  refresh-token bootstrap), and the Telegram webhook.
- **Vercel AI SDK** (`ai` + `@ai-sdk/openai`), using `generateObject` with Zod
  schemas for structured detect / extract / classify steps. Model `gpt-5-mini`,
  configurable via env.
- **node-postgres (`pg`)** with hand-written SQL against the existing database.
  No ORM, no migrations of existing tables.
- **Gmail API** via `googleapis` with an OAuth2 refresh token, polled on a timer.
- **Telegram Bot API** for notifications and an inbound webhook.
- **TypeScript** (ESM), **Vitest** for tests.
- Multi-stage **Dockerfile** plus `.dockerignore` and `.env.example`.

## Existing database schema (from the n8n flow, not changed)

- `categories(id uuid, name text, type text)`
- `accounts(id uuid, name text, type text, currency text)`
- `transactions(id uuid, description text, amount numeric, currency text,
  account_id uuid, category_id uuid, tags text[], created_at timestamptz,
  updated_at timestamptz)`
- Distinct tags are read with `SELECT DISTINCT unnest(tags) AS tag FROM transactions`.

### One additive object

- `agent_state(key text primary key, value text)` - persists the Gmail history
  cursor and any processed-message bookkeeping across restarts. Created with
  `CREATE TABLE IF NOT EXISTS` on startup. It does not touch existing tables.

## Project layout

```
src/
  index.ts              # bootstrap: build Hono app, start node-server, start Gmail poller
  config/env.ts         # parse + validate env with zod
  db/
    pool.ts             # pg Pool singleton
    queries.ts          # raw SQL: categories, accounts, distinct tags,
                        #          insert/update/delete transaction, agent_state get/set
  ai/
    provider.ts         # build the openai model from env
    detect.ts           # isTransactionEmail(subject, body) -> { is_transaction_email }
    extract.ts          # extractTransaction(body, refs) -> structured transaction
    classify.ts         # reclassify category_id + tags for an edited transaction
  gmail/
    client.ts           # OAuth2 client + gmail api handle
    poller.ts           # poll loop via users.history.list, decode body to plain text
    parse.ts            # message -> { subject, text }
  telegram/
    client.ts           # sendMessage / sendError helpers (HTML parse mode)
    webhook.ts          # Hono handler: reply-edit and /delete
    format.ts           # notification message builders
  pipeline/
    processEmail.ts     # detect -> fetch refs -> extract -> validate -> insert -> notify
  routes/
    health.ts
    oauth.ts            # Google OAuth callback to mint the refresh token
test/
  ...vitest specs...
Dockerfile
.dockerignore
.env.example
```

## Gmail pipeline (deterministic, mirrors n8n)

1. **Poll.** Every `GMAIL_POLL_INTERVAL_MS` (default 60000). On first run, read the
   mailbox's current `historyId`, store it in `agent_state`, and skip the
   backlog. On later runs, call `users.history.list(startHistoryId=...)` and
   collect newly added message IDs. Persist the new `historyId` after a
   successful pass. Processed message IDs are tracked so a transaction is never
   inserted twice (idempotency), even if a poll overlaps a restart.
2. **Parse.** For each new message, fetch it and decode to plain text plus the
   subject line.
3. **Detect.** `detect(subject, text)` returns `{ is_transaction_email: boolean }`.
   Promotional / marketing / non-transaction mail returns false and is skipped
   (and marked processed).
4. **Fetch references.** On a true detection, load `categories`, `accounts`, and
   the distinct `tags` list from Postgres.
5. **Extract.** `extract(text, { categories, accounts, tags })` returns:
   - `description: string`
   - `amount: number` - signed; negative for expenses
   - `currency: string` - ISO 4217 (e.g. PEN, USD)
   - `account_id: string` - a uuid that must exist in `accounts`
   - `category_id: string` - a uuid that must exist in `categories`
   - `tags: string[]` - at least 3, lowercase, single word each
   - `created_at: string` - ISO 8601; current time injected, timezone
     America/Lima, relative dates resolved
6. **Validate + persist.** If `account_id` and `category_id` resolve to existing
   rows, `INSERT` the transaction and send the Telegram "nueva transacción"
   notification (id, account name, category name, tags, amount + currency,
   datetime). If the account is missing or invalid, send the Telegram error
   notification instead (the n8n "Error Telegram" path). The whole step is
   wrapped in try/catch; LLM calls use the AI SDK `maxRetries` for the
   `retryOnFail` behaviour the n8n agent had.

## Telegram pipeline (full parity)

Transport: a Hono webhook at `POST /telegram/webhook`, guarded by a secret token
(`X-Telegram-Bot-Api-Secret-Token`). A one-time `setWebhook` helper registers
the public URL with Telegram. The deployment must expose a public HTTPS URL
(`TELEGRAM_WEBHOOK_URL`) for the container; incoming Telegram updates are
delivered to this endpoint.

- **Delete.** Message text is exactly `/delete` and is a reply to a prior
  notification: parse the transaction id from the replied message's `ID:` line,
  `DELETE` the row, reply with a delete confirmation (quoting the original).
- **Edit.** Any other reply to a notification: take the first line as the new
  description and an optional `[tag, tag, ...]` bracket as tags. Run `classify`
  to choose the best `category_id` and tag list from the user's categories and
  existing tags, `UPDATE` the transaction's description / category / tags /
  `updated_at`, and reply with an update confirmation.

## Configuration (`.env.example`)

- `DATABASE_URL`
- `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5-mini`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
  `GOOGLE_REFRESH_TOKEN`
- `GMAIL_POLL_INTERVAL_MS` (default 60000)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_WEBHOOK_URL`
- `PORT` (default 3000), `TZ=America/Lima`

`config/env.ts` validates these at startup and fails fast with a clear message
if any required value is missing.

## Error handling

- Each email is processed in isolation; a failure on one does not stop the poll
  loop or block later emails.
- LLM steps use `maxRetries`. A failure after retries routes to the Telegram
  error notification, matching n8n.
- The poll cursor only advances after a successful pass, so a crash mid-poll
  reprocesses safely (guarded by the processed-id idempotency check).
- Env validation fails fast at boot.

## Testing (Vitest, no network)

- `detect` / `extract` / `classify` with the AI SDK mocked - assert prompt
  inputs and that outputs map to the right fields.
- Telegram parsing: the `ID:` regex, first-line description, `[..]` tag parsing.
- Pipeline routing: valid transaction inserts + notifies; missing/invalid
  account routes to the error notification; non-transaction email is skipped.
- SQL builders: correct statement + parameter shape for insert / update /
  delete and the distinct-tags query.
- Gmail parse: HTML/text message decodes to the expected subject + text.

## Out of scope (for now)

- Backfilling historical emails (first run starts from "now").
- A web UI. The only HTTP endpoints are health, the OAuth callback, and the
  Telegram webhook.
- Multi-user support. Single mailbox, single Telegram chat, as in the n8n flow.
