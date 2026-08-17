# Email inbox: visibility into what the importer did - design

Date: 2026-08-13
Status: approved, ready for planning
Surfaces: backend, web, Android
Reviewed: Fable 5, 2026-08-13. Two false premises in the first draft were
corrected (see "What actually happens today"), and its findings are folded in.

## Problem

Emails arrive and nothing visible happens. When a bank email fails to become a
transaction there is no way to find out why: every unsuccessful outcome looks
identical from outside, because `import_source.transaction_id` is null and the
reason is gone.

## What actually happens today

Established by reading the code, after a first draft of this spec got it wrong
twice:

1. **A thrown error loses the email silently.** `index.ts:44` wires
   `importEmail` as `processEmail(...).catch(console.error)`, so the rejection
   never reaches the poller. `pollOneConnection` advances
   `maxInternalDateSeconds` from each parsed message regardless of the import
   outcome (`poller.ts:111-117`), and `listMessageIdsSince` only ever asks for
   messages after the cursor (`gmail/client.ts:66-68`). The email is not
   retried; it is dropped, with no row and no trace.

2. **Rows do not have to live forever.** Because the poller never re-lists a
   message older than the cursor, deleting an old `import_source` row cannot
   cause a duplicate re-import. Only rows at the inclusive `after:` boundary
   second matter for dedupe. Retention is therefore a real choice, not a
   constraint.

The poller fetches **every** email that arrives (`q: after:<epoch>
-in:scheduled`), with no sender filter, and runs each through the AI detector.
`import_source` already holds one row per successfully-processed email, keyed
`(connection_id, message_id)`.

## Goal

A section listing every email the importer processed, with sender, subject,
date, verdict and a link to the transaction when one was created. A Telegram
alert when processing actually fails. And, because failures are now visible,
a bounded automatic retry so a transient outage stops costing real transactions.

## Data model

No new table. Migration `006_email_log.sql` extends `import_source`:

```sql
ALTER TABLE import_source
  ADD COLUMN IF NOT EXISTS sender     text,
  ADD COLUMN IF NOT EXISTS subject    text,
  ADD COLUMN IF NOT EXISTS email_date timestamptz,
  ADD COLUMN IF NOT EXISTS verdict    text,
  ADD COLUMN IF NOT EXISTS attempts   integer NOT NULL DEFAULT 0;

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
```

The four descriptive columns are nullable because historical rows have no values
for them; the UI renders those as unknown rather than pretending.

**The body is never stored.** Only the subject. `processEmail` already discards
the body after the AI call and continues to.

A separate `email_log` table was considered and rejected: two rows per email
that must agree, with nothing gained.

### Verdict vocabulary

| verdict | meaning |
| --- | --- |
| `imported` | A transaction was created. The row links to it. |
| `not_transaction` | The AI detector judged this not a purchase. |
| `not_configured` | The user has no accounts **or** no categories, so nothing could be attributed. |
| `extract_failed` | Detected as a transaction, but the extractor returned no fields. |
| `failed` | Processing threw. New: today this leaves no row at all. |
| `unknown` | Backfilled onto rows that predate this feature. Never written going forward. |

`imported` can still carry a null `transaction_id`: the column is
`ON DELETE SET NULL` (`005_connections.sql:27`), so deleting the transaction
orphans the link. The UI shows such a row as imported with the transaction
deleted, rather than offering a dead link.

## Retention

Sender and subject are cleared once a row is older than **30 days**. The row,
its verdict and its dedupe value survive, so the audit trail and duplicate
protection stay intact while the app stops holding a permanent readable log of
who emails the user and about what.

One statement, run once per poll cycle (it is cheap and idempotent):

```sql
UPDATE import_source
   SET sender = NULL, subject = NULL
 WHERE created_at < now() - interval '30 days'
   AND (sender IS NOT NULL OR subject IS NOT NULL)
```

The UI renders a cleared row the same as a historical one: verdict and dates
intact, sender and subject shown as unavailable.

## Pipeline changes

1. `gmail/parse.ts` also returns the `From` header as `sender`, **verbatim**.
   The header is typically `Bank Name <no-reply@bank.com>`; it is stored and
   displayed as-is rather than split, because the display name is the useful
   half and parsing RFC 5322 addresses is not worth it here.
2. The poller passes `sender` and the message's `internalDateSeconds` into
   `importEmail`. `internalDateSeconds` is seconds since the epoch as a string,
   converted with `to_timestamp($n::bigint)` for the `timestamptz` column.
3. `recordImportSource` takes the verdict, sender, subject and email date, and
   increments `attempts`. Every exit path in `processEmail` names its verdict.
4. `processEmail` records verdict `failed` on a throw and then rethrows.

### The error must reach the poller

`index.ts`'s `.catch` moves into `pollOneConnection`. Three constraints on where
it goes, each of which is a way to get this wrong:

- **It wraps `importEmail` only.** `fetchMessage` stays outside it. A 401 from
  Gmail mid-batch has to keep propagating to the existing `isAuthError` handler
  (`poller.ts:68-74`), or the connection never flips to `needs_reauth` and the
  user gets import-failure alerts every cycle instead of the reconnect alert.
- **The cursor advances only for messages that ended with a row.** If
  `recordImportSource` itself fails, the message must not be skipped: leaving
  the cursor short means it is re-listed next cycle. Advancing past a row-less
  email is exactly today's silent-loss bug.
- **One failure must not abort the batch.** The catch is per email, inside the
  loop, so the remaining messages still import.

A message that fails before `processEmail` runs (a `fetchMessage` or
`parseMessage` throw) has no sender or subject to record. The poller records a
`failed` row with nulls for those, so the email still appears in the log.

## Retry

`failed` is retryable up to **3 attempts**, then final. Without this, a
thirty-second AI provider blip would permanently cost a real transaction, which
is worse than useful: the row would be visible but dead.

Retry is possible because `message_id` is stored and
`fetchMessage(gmail, messageId)` works by id, independent of the cursor.

- `hasImportSource` becomes `shouldSkipMessage`: a row means skip, **unless**
  its verdict is `failed` and `attempts < 3`.
- Each cycle, `pollOneConnection` unions the ids from `listSince(cursor)` with
  the connection's retryable `failed` ids, and runs the existing loop over both.
  No second code path.
- Every `processEmail` run increments `attempts`, so a poison message stops
  after three cycles rather than retrying forever.
- Retried messages are older than the cursor, and the existing "only advance if
  greater" comparison already prevents them from dragging it backwards.

## Telegram alert on failure

Only `failed` alerts. `not_transaction` is the common case (every newsletter),
`not_configured` would fire per email until onboarding is done, and
`extract_failed` fires on any promotional email that mentions a price.

**Once per connection per cycle, and at most once per hour.** The poller
collects the cycle's failures and sends one message naming the first sender and
subject plus the total ("3 emails could not be processed"), linking to the
Inbox at `${APP_BASE_URL}/inbox`.

The hourly cooldown is the second half, and it matters: `GMAIL_POLL_INTERVAL_MS`
defaults to 60000, so an hour-long provider outage on a busy inbox would
otherwise send up to sixty messages. Unlike the Gmail disconnect alert, which is
gated by a one-way state transition, nothing here gates repetition. The cooldown
is an in-memory `Map<connectionId, lastAlertSentAt>` in the poller module:
deliberately best-effort, since it resets on restart, and a schema column for
throttling state is not worth it.

Delivery reuses the path built for the Gmail disconnect alert: find the user's
Telegram chat, send, flip the Telegram connection to `needs_reauth` on a 403,
swallow every other send failure. An alert must never break the import loop.
As there, the pipeline writes state and the poller notifies.

## API

`GET /api/emails?limit=&offset=`

Session-scoped by joining `connection.user_id`, ordered `created_at DESC`.
Response shape matches `routes/transactions.ts:82` exactly:
`{ items, total, limit, offset }`, `limit` defaulting to 50 and capped at 200.

```ts
interface EmailLogItem {
  message_id: string
  connection_id: string
  account_email: string          // connection.external_id, which Gmail it arrived on
  sender: string | null
  subject: string | null
  email_date: string | null
  received_at: string            // import_source.created_at, when we processed it
  verdict: 'imported' | 'not_transaction' | 'not_configured' | 'extract_failed' | 'failed' | 'unknown'
  attempts: number
  transaction: { id: string; description: string; amount: number; currency: string } | null
}
```

Registered in `app.ts` behind the existing default-deny session gate. Mock mode
returns `503 connections_require_live_mode`, matching the connections routes,
because these rows key off real connection rows.

## Clients

Both get a new top-level destination named **Inbox**.

**Web.** Route `/inbox` in `App.tsx`, a sixth item in `navigationItems`
(`AppLayout.tsx:19-25`), an `InboxPage` listing rows newest first with sender,
subject, date and verdict. An `imported` row links to its transaction.
Pagination follows the transactions page.

**Android.** A fourth bottom-bar destination (Material allows five), a
`Routes.INBOX`, an `InboxScreen`, list state on `SessionViewModel`, and a
`getEmails` call on `SpendApi`. All copy routes through `i18n/Strings.kt`. Mock
mode shows the same explanatory state the Integrations screen uses for its 503.

Both colour the verdict from theme tokens (`text-destructive` on web,
`MaterialTheme.colorScheme.error` on Android), never a hardcoded hue, so the
three-state light/dark/system preference keeps working.

## Testing

Backend:
- One `processEmail` test per verdict, including `failed` on a throw.
- A replayed message is deduped before any AI call.
- A `failed` row with `attempts < 3` is retried; at 3 it is skipped.
- A retried message does not move the cursor backwards.
- One email throwing does not stop the rest of the batch importing.
- An auth error from `fetchMessage` still flips the connection to
  `needs_reauth` and does not count as an import failure.
- The cursor does not advance past a message with no `import_source` row.
- Many failures in one cycle produce exactly one alert; a second cycle within
  the hour produces none.
- The retention statement clears sender and subject past 30 days and leaves the
  verdict and dedupe intact.
- Query tests for user scoping and pagination; a route test that one user
  cannot read another user's emails.

Web: `InboxPage` renders each verdict, an `imported` row links to its
transaction, and an orphaned `imported` row does not render a dead link.

Android: a pure verdict-to-label mapping test following the
`connectionStatusLabel` seam, plus a ViewModel test for the mock-mode state.

## Out of scope

- Manual retry from the UI. Automatic bounded retry covers the transient case;
  a button is a separate feature.
- Filtering or search. Newest-first with pagination first; add filters when the
  list proves unusable without them.
- Any change to which emails the poller fetches.

## Verification

- `pnpm --filter backend typecheck` and `pnpm --filter backend test`
- `pnpm --filter web typecheck` and `pnpm --filter web test`
- `./gradlew testDebugUnitTest` and `./gradlew assembleDebug` in `apps/android`
- Migration `006` applied per the ordering rules in `OPS.md`
