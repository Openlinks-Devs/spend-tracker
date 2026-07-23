# Per-User Integrations (Connections) — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorming), revised after gap review, pending implementation plan
**Milestone:** Appendix B, sub-project 1 of 2 (connections). Sub-project 2 (Mercado Pago billing) is a separate spec.

## Context & goal

Today SpendTracker imports transactions from a **single** owner Gmail account (one `GOOGLE_REFRESH_TOKEN` in env) and edits/notifies through a **single** Telegram chat (`TELEGRAM_CHAT_ID`). To support real users, each user must link **their own** Gmail account(s) and their own Telegram chat, and imports/edits must be attributed to that user.

Goal: let each signed-in user connect their own Gmail (one on the free tier, several on premium) and their own Telegram, with imports and edit/notify scoped to that user.

## Dependencies & scope

- **Prerequisite & ordering:** the multi-tenancy milestone (`docs/superpowers/plans/2026-07-15-multi-tenancy-prod.md`) must be implemented first. Connections attribute imports to a `user_id`, which only exists once ledger data is user-scoped. **This spec supersedes plan Task 12 (owner-only import attribution): Task 12 is SKIPPED, not built-then-deleted.** To keep the interim deploy (after multi-tenancy, before this milestone) sound, the env-based poller wiring in `index.ts` is **disabled** (not left calling the now-`userId`-requiring `insertTransaction`) the moment multi-tenancy lands; this milestone then replaces it with the per-connection poller. So there is never a window where a poller runs without a `userId` to attribute to.
- **Mock mode:** connection creation and pairing write rows that FK to `"user"(id)`, but `APP_MODE=mock` synthesizes a `demo-user` with no `"user"` row (`resolveSession.ts`). Connections are therefore **live-mode only**: in mock mode the connection endpoints return `503 { error: 'connections_require_live_mode' }` and the poller does not run. (Mock mode is dev/LAN-only and blocked in production by the multi-tenancy plan.)
- **In scope:** per-user Gmail linking + import, per-user Telegram pairing + notify/edit, a `connection` model, import deduplication, the premium *gate* that reads an `is_premium` flag, poller and webhook changes, and connection-management UI on **web and Android**.
- **Out of scope (separate spec):** Mercado Pago (Mercado Libre) subscription billing that *sets* `is_premium`. Until that ships, `is_premium` is set manually.
- **Android parity:** per the project `CLAUDE.md`, every user-facing piece here ships on `apps/web` **and** `apps/android`.

## Data model

New table `connection` (one row per linked external account):

```
connection(
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider          text NOT NULL,          -- 'gmail' | 'telegram'
  status            text NOT NULL,          -- 'active' | 'needs_reauth' | 'disabled'
  external_id       text NOT NULL,          -- gmail: email address; telegram: chat_id
  secret_encrypted  bytea,                  -- gmail: encrypted refresh token; telegram: null
  key_version       int,                    -- gmail: encryption key id used (see Security)
  cursor            text,                   -- gmail: last-checked Unix seconds (see Poller); telegram: null
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz
)
-- index on (user_id).
-- UNIQUE (user_id, provider, external_id): a user cannot link the same account twice.
-- UNIQUE (provider, external_id) WHERE provider = 'telegram': a Telegram chat pairs
--   to at most ONE user globally, so webhook chat_id -> user resolution is deterministic.
-- Gmail is intentionally NOT globally unique (see Edge cases: shared inbox).
```

New table `import_source` (dedupe guard so a re-poll never double-imports):

```
import_source(
  connection_id  uuid NOT NULL REFERENCES connection(id) ON DELETE CASCADE,
  message_id     text NOT NULL,             -- Gmail message id
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, message_id)
)
```

New table `pairing_code` (server-side single-use for OAuth state and Telegram codes):

```
pairing_code(
  code        text PRIMARY KEY,             -- >=128-bit, base64url
  user_id     text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  purpose     text NOT NULL,                -- 'gmail_oauth' | 'telegram_pair'
  expires_at  timestamptz NOT NULL,         -- ~10 minutes
  consumed_at timestamptz                   -- set once; a second use is rejected
)
```

New column on the Better Auth user table:

```
ALTER TABLE "user" ADD COLUMN is_premium boolean NOT NULL DEFAULT false;
```

Retired after rollout (see Owner transition): `GOOGLE_REFRESH_TOKEN`, `TELEGRAM_CHAT_ID` (both become optional then are dropped from `env.ts`), the `agent_state` row keyed `gmail_history_id`, and the env-poller wiring in `index.ts`. New env: `CONNECTION_ENCRYPTION_KEYS` (see Security), `TELEGRAM_BOT_USERNAME` (pairing deep link), `APP_BASE_URL` (post-callback redirect target).

## Components & flows

### Gmail linking (per user, incremental consent)
1. A signed-in user opens the Integrations screen and taps **Link Gmail**. The client calls a session-gated endpoint `POST /api/connections/gmail/link-url`.
2. Backend checks the premium gate (below). If allowed, it mints a `pairing_code` (`purpose='gmail_oauth'`, bound to the user id), and returns the Google auth URL requesting `https://www.googleapis.com/auth/gmail.readonly` with `access_type=offline`, `prompt=consent`, and `state=<code>`.
3. The Google **callback is session-free** and mounted **outside the `/api/*` guard** (next to `/telegram/webhook`, which is already unguarded in `app.ts`), so it does not need an allowlist exemption inside the default-deny guard: `GET /connections/gmail/callback`. It is authenticated **only by the random, single-use `state` code** (consumed atomically from `pairing_code`), because on Android the callback returns inside a Custom Tab with no app cookie. It exchanges the code, reads the account email (`gmail.users.getProfile`), and **upserts by `(user_id, 'gmail', email)`**: a new row for a new account, or a token replacement on the existing row (re-auth). On success it redirects to `APP_BASE_URL/integrations?linked=gmail`.
   - **Anti-phishing:** if a session cookie IS present at the callback (web), it MUST match the state's `user_id`, else reject; this stops an attacker from tricking a logged-in victim into consenting a Gmail onto the attacker's account. The web "Link Gmail" UI also shows a confirmation naming the SpendTracker account before starting. (On Android there is no cookie, so the bearer-authenticated link-url mint in step 1 is the binding; the state is single-use and short-lived.)
4. If Google returns **no refresh token** (already-granted account), the flow returns a clear error asking the user to remove access at myaccount.google.com and retry, or we re-request with `prompt=consent` (already set) to force a new one.
5. The extraction pipeline is reused but now runs **as the connection's user** (see Import pipeline changes). A Gmail connection needs no per-account configuration.

### Telegram pairing (per user)
1. User taps **Connect Telegram** → `POST /api/connections/telegram/pair-code` mints a `pairing_code` (`purpose='telegram_pair'`) and the UI shows a deep link `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>` (code fits Telegram's 64-char `A-Za-z0-9_-` `/start` payload).
2. User opens it and presses Start; Telegram sends `/start <code>` to the existing webhook (which already validates the secret token — that check stays).
3. The webhook consumes the code (valid, unexpired, unused). Because a user has **exactly one** telegram connection, pairing **replaces** any existing telegram row for that user (a new phone/chat overwrites the old chat_id) rather than adding a second. If the incoming chat_id is already paired to a **different** user (global unique on `(provider, external_id)`), it rejects with an in-chat "this chat is already linked to another account" message and changes nothing. On success it confirms in-chat, and the app/web surface shows a "Telegram connected as @handle" notice with a one-tap unlink so the linking user can spot an unexpected pairing.

### Import pipeline changes
The pipeline (`processEmail`) is refactored to take an explicit `userId` and a per-user `notify` target:
- **Dedupe before any work:** for each `message_id`, check `import_source(connection_id, message_id)` **first**. If present, skip entirely — before the OpenAI `detect`/`extract` calls — so a crash-replay costs no tokens and sends no duplicate notification.
- Account/category/tag lookups run **scoped to the connection's user** (consistent with multi-tenancy Tasks 5/6/8).
- Each processed message writes an `import_source` row so it is never reprocessed: on a successful import, insert the transaction attributed to that `user_id` **and** the `import_source(connection_id, message_id, transaction_id)` row in the **same DB transaction**; on a non-transaction email or an extract that cannot attribute an account, write `import_source` with `transaction_id = null`. (So "skipped" and "imported-then-deleted" are distinguished by never having had a transaction vs `ON DELETE SET NULL`; if that distinction matters later, add a `status` column — out of scope now.)
- **Notify routing:** on a successful import, notify the user's **Telegram connection** if one exists; if the user has no Telegram connection, skip notification silently (no error). This requires a signature change: `sendMessage(chatId, text, opts)` (today it is hard-wired to `env.TELEGRAM_CHAT_ID` in `telegram/client.ts`), threaded through `processEmail` and the webhook's edit/delete confirmations. Notify failures never block or roll back the import insert.
- **Onboarding guard:** if the user has zero accounts or zero categories, extraction cannot attribute a transaction; the message is skipped (not errored) and recorded in `import_source` with `transaction_id = null` so it is not retried. (A future enhancement may surface a "set up accounts to enable import" nudge.)

### Poller (per-connection)
Replaces the single-token `startPolling`. Each tick:
- Acquire the cycle lock with **`pg_try_advisory_lock`** on a dedicated pinned pool client (the blocking `pg_advisory_lock` would queue ticks, not skip them). If not acquired, skip this tick; release in `finally`. This stops overlapping instances (Coolify rolling deploy) from double-running.
- **Downgrade enforcement (the actor):** for each user whose `active` gmail connections exceed their tier cap (1 free / 5 premium), keep the **oldest** N by `created_at` and flip the rest to `disabled`. This is the only place the cap is enforced, since billing (which flips `is_premium`) is out of scope; a manual downgrade takes effect on the next tick.
- Load all `active` gmail connections.
- For each: decrypt its refresh token (using its `key_version`), build a Gmail client, and list new messages using a **timestamp cursor + `messages.list` query** (the approach n8n's Gmail Trigger uses; the Gmail history API is intentionally avoided because its `historyId` expires after ~a week, which a connection returning from `needs_reauth` would trip):
  - Query `users.messages.list` with `q = "after:<cursor seconds> -in:scheduled"`, paginating to collect the new message ids. The query is filter-ready: an **optional** per-connection sender/label filter (e.g. `from:(banco OR notificaciones@...)`) can be appended to cut OpenAI cost and limit what email text is read (see Cost & privacy). The filter UI/column is a follow-up refinement, not required for v1.
  - **First run** (`cursor` null): set `cursor = now` and process nothing (import starts from the next email; no historical backfill — the UI states this). This matches n8n's first-run behavior.
  - Run the import pipeline over each message, then **advance `cursor` once per batch** to the **max `internalDate` (seconds)** among the fetched messages (unchanged if the batch was empty). Because Gmail's `after:` is inclusive at the boundary second, a message at exactly `cursor` seconds may reappear next poll; that is harmless — the `import_source(connection_id, message_id)` dedupe (below) skips it before any work. A crash before the advance simply re-lists from the old timestamp and dedupe absorbs it. This removes the history-API 404/re-bootstrap complexity entirely.
- **Error isolation:** a refresh-token failure flips only that connection to `status='needs_reauth'` and continues; other connections are unaffected. The trigger is HTTP **401 or an `invalid_grant` error** (googleapis throws `invalid_grant` as HTTP 400 for a revoked/expired refresh token); any other error is treated as transient and retried next tick, leaving the connection `active`.

### Telegram webhook (per-connection)
Incoming updates first validate the secret token (existing check, retained). `/start <code>` runs pairing. Other updates resolve `chat_id` → `connection` (global-unique telegram row) → `user_id`, and edit/delete-by-reply are scoped to that user's transactions (today they run globally). Updates from unpaired chats are ignored. A **403** from Telegram (user blocked the bot) on any send flips that telegram connection to `needs_reauth` immediately (a block is deterministic, so no failure counter is needed); recovery is re-pairing via the deep link. This requires `sendMessage` to expose the HTTP status to its callers (today it throws a generic error). Send failures never block an import insert.

### Premium gate
Connection creation reads `user.is_premium`:
- **Counting rule:** all non-removed gmail connections count toward the limit regardless of status (`needs_reauth`/`disabled` still count), so a user must explicitly remove a dead one to free a slot.
- Free tier: at most **1** `gmail` connection. Attempting a 2nd returns HTTP **402** with a machine-readable body `{ error: 'premium_required', limit: 1 }` the UI shows as an upsell.
- Premium: up to **5** `gmail` connections.
- **Re-auth is exempt** from the gate (it replaces a token on an existing row, never adds one).
- Telegram: exactly **1** per user, free, both tiers.
- **Downgrade** (premium → free with >1 gmail): enforced by the poller (see Poller §Downgrade enforcement), which keeps the **oldest** connections within the cap and flips the extras to `disabled` on the next tick. No data is deleted; the UI messages the user to remove or re-subscribe.

### Owner transition
On rollout the owner re-links Gmail and Telegram through the new UI once. Removed in this milestone: the env-based single-user poller and `ensureStateTable`/owner-id wiring in `index.ts`, the `gmail_history_id` `agent_state` row, and plan Task 12's owner-attribution path. Rollout steps:
1. Update the Google Cloud OAuth client's authorized redirect URIs to add `<APP_BASE_URL host>/connections/gmail/callback`, and set `GOOGLE_REDIRECT_URI` to it.
2. Set `CONNECTION_ENCRYPTION_KEYS`, `TELEGRAM_BOT_USERNAME`, `APP_BASE_URL`.
3. Deploy; `GOOGLE_REFRESH_TOKEN` / `TELEGRAM_CHAT_ID` become optional in `env.ts` for this release, then are dropped in a follow-up. No token-blob migration.

## Security
- **Token encryption:** AES-256-GCM. Each `secret_encrypted` blob is `iv(12) || ciphertext || tag(16)`; the `key_version` column records which key encrypted it. `CONNECTION_ENCRYPTION_KEYS` holds one or more versioned 32-byte keys (e.g. `1:<base64>,2:<base64>`); new writes use the highest version, reads use the row's version, so key rotation never forces re-auth. AAD binds the ciphertext to `connection.id` to prevent blob swapping.
- **State & pairing codes:** ≥128-bit random, base64url, **DB-backed in `pairing_code` (not signed tokens)**, ~10 min TTL, bound to the minting user. Single-use is enforced by **atomic consumption**: `UPDATE pairing_code SET consumed_at = now() WHERE code = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING user_id` — a second redeem returns no row (closes the double-redeem race). Expired/consumed rows are cleaned up on read (delete-on-consume) plus a periodic purge.
- **Rate limiting:** link-url minting and `/start` redemption are capped per user via a small DB counter (per-instance memory counters die on redeploy). If a counter is deemed too heavy for v1, the ≥128-bit + TTL + single-use properties are the floor; the cap is defense-in-depth.
- **Token revocation:** removing a gmail connection calls Google's token-revoke endpoint (best-effort) before deleting the row, so the grant does not outlive the connection.
- **OAuth callback** trusts only the random single-use `state` (see Gmail linking §3 for the session-match anti-phishing rule); the legacy `/oauth/start` and `/oauth/callback` routes (which today print the refresh token as plaintext, unguarded) are **deleted**, and `GOOGLE_REDIRECT_URI` plus the Google Cloud OAuth client's authorized redirect URIs are updated to the new `/connections/gmail/callback` path (a rollout step, see Owner transition).
- **Known gap (out of scope):** Better Auth's login Google provider already sets `accessType: 'offline'` and stores the login refresh token as plaintext in the `account` table. This spec encrypts only `connection` tokens; encrypting or dropping offline access on the login provider is a separate hardening item.
- Connection management endpoints are session-gated and user-scoped like all other data.

## UI (web + Android)
An **Integrations** screen listing each connection with provider, `external_id` (email / "Telegram"), and status. Actions: **Link Gmail**, **Connect Telegram**, **Remove**, and **Re-authenticate** for `needs_reauth`. A note sets the "imports start from now, no history backfill" expectation. Free users hitting the Gmail limit see a premium upsell (which will deep-link to the future Mercado Pago flow).

**Android link mechanics:** the app requests the start URL from a bearer-authenticated endpoint (Better Auth `bearer()` plugin is already enabled), opens it in a **Chrome Custom Tab** (Google blocks OAuth in WebViews), and the backend callback redirects to `APP_BASE_URL/integrations?linked=gmail`. That path is registered as an Android **App Link** so the app resumes. Because Chrome does not reliably fire App Links on a server 302 inside a Custom Tab, the callback returns a small **"Return to app" interstitial** page whose button uses an `intent://`/custom-scheme link as the fallback (and the web app just reads the query param). Verify resumption on a real device early. The Telegram deep link opens the Telegram app directly.

## Error handling & states
- `active`: polling/notifying normally.
- `needs_reauth`: gmail token invalid/revoked, or telegram bot blocked; excluded from polling/notify; UI prompts re-auth (re-runs the link flow, replacing the token on the existing row).
- `disabled`: connection turned off (by user or by downgrade); excluded from polling, retained for history. UI offers enable (subject to the premium gate) / remove.
- Unpaired Telegram chats, unknown/expired pairing codes: ignored/rejected with no state change.

## Testing
- Connection CRUD scoped by `user_id` (a user cannot see or remove another user's connection).
- Telegram global uniqueness: a chat already paired to user A cannot be paired to user B; webhook resolves `chat_id` → the correct single user. Re-pairing user A with a **new** chat replaces the old telegram row (still exactly one).
- Gmail callback anti-phishing: with a web session present, a `state` whose `user_id` differs from the session is rejected; with no session (Android path) the single-use state is accepted.
- Premium-limit enforcement: free user blocked at the 2nd Gmail (402 + code); premium allowed up to 5; re-auth (same email) exempt; the **poller** disables extras beyond the cap deterministically by `created_at` after a downgrade.
- Token encrypt/decrypt round-trip; ciphertext ≠ plaintext; a blob written with key v1 still decrypts after v2 is added; wrong-connection AAD fails.
- Pairing/state codes: atomic single-use (concurrent double-redeem yields exactly one success), expiry rejected, unknown code rejected; webhook secret-token check still enforced.
- Poller: error isolation (one connection failing flips only it, others continue); `needs_reauth` triggered by both 401 and `invalid_grant` (400), transient errors leave it `active`; first run sets `cursor = now` and imports nothing; `messages.list` uses `after:<cursor>` and advances `cursor` to the batch's max `internalDate`; a boundary-second message reappearing is deduped by `import_source`; `pg_try_advisory_lock` skips (not queues) an overlapping tick.
- Import dedupe: a `message_id` already in `import_source` is skipped **before** the OpenAI call (no duplicate transaction, no extra token spend, no duplicate notification); onboarding guard skips (no crash) when the user has no accounts/categories and records the message so it is not retried.
- Notify routing: import with no Telegram connection skips notify without error; a notify 403 does not roll back the insert and flips the telegram connection to `needs_reauth`.
- Mock mode: connection endpoints return `503 connections_require_live_mode` and the poller does not run.

## Cost & privacy
Each new message runs an OpenAI `detect`/`extract` call with the email text, so cost and data exposure scale linearly with linked inboxes and volume. Mitigations: dedupe **before** the AI call (already specified) so replays cost nothing; the `after:` query already narrows to new mail; and the optional per-connection sender/label filter (above) can restrict processing to bank senders. The Gmail consent screen and Integrations UI should state that email content is read to extract transactions.

## Open items (resolve during planning)
- Exact Mercado Pago touchpoint for the upsell CTA (finalized in the billing spec).
- Whether the poller needs a concurrency cap across connections at high N (start sequential under the advisory lock; revisit with data).
