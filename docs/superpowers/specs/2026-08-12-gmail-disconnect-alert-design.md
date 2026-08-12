# Gmail disconnect alert - design

Date: 2026-08-12
Status: approved, ready for implementation
Scope: `apps/backend` only

## Problem

When SpendTracker loses access to a linked Gmail account, the poller stops importing from it and
says nothing. The connection sits at `needs_reauth` on the Integrations screen, but nobody visits
that screen unprompted, so the user discovers the breakage weeks later as a gap in their
transactions.

## Goal

Send the user a Telegram message at the moment a Gmail connection breaks, naming the account and
pointing at the page where they reconnect it.

## Trigger

Exactly one transition: `poller.ts` catching an auth error (HTTP 401 or an `invalid_grant` message)
and flipping the connection from `active` to `needs_reauth`. That is the moment the account became
useless to the user.

These are explicitly **not** alerted:

- A transient failure (network blip, Gmail 5xx). The poller logs it and retries next cycle; the
  connection stays `active`.
- The downgrade pass parking an over-cap connection as `disabled`. That is a billing state, not a
  broken account.
- The user deleting a Gmail connection themselves from the Integrations screen. No point confirming
  an action they just took.

## Why it fires exactly once, with no new state

`listActiveGmailConnections` selects `status = 'active'` only. The instant the connection flips to
`needs_reauth` it leaves the poll set and cannot produce a second alert. The existing advisory lock
(`POLL_LOCK_ID`) already prevents two pollers racing the same transition.

No `notified_at` column, no notification table, no dedupe key.

Re-linking the account runs `upsertGmailConnection`, which sets the row back to `active`, so a later
break alerts again. That is intended. Do not add suppression on top of it.

## Flow

```
poll cycle (active gmail rows)
  └─ gmail call throws
       ├─ not an auth error ──→ log, retry next cycle, status unchanged, no alert
       └─ auth error
            ├─ gmail.status = needs_reauth        (written first, always)
            └─ notify, inside its own try/catch
                 ├─ no telegram connection ──→ return, send nothing
                 └─ sendMessage(alert)
                      ├─ 403 ──→ telegram.status = needs_reauth
                      ├─ other failure ──→ swallowed, logged, never rethrown
                      └─ ok ──→ delivered
```

## Ordering and failure isolation

1. Write the Gmail status first. A Telegram outage must never leave a broken connection marked
   `active`, because that would make the poller retry a dead token forever.
2. Notify second, wrapped in its own try/catch inside the poller's existing per-connection catch. No
   Telegram failure may abort the poll loop for the remaining connections.
3. A `TelegramSendError` with status 403 means the user blocked or removed the bot, so the Telegram
   connection flips to `needs_reauth` too. This matches the intent already documented on
   `TelegramSendError` in `telegram/client.ts`.

## Components

### `apps/backend/src/connections/notifyConnectionLost.ts` (new)

```ts
export interface ConnectionLostNotifierDeps {
  db: Queryable
  sendMessage: (chatId: string, text: string) => Promise<void>
}

export async function notifyGmailConnectionLost(
  deps: ConnectionLostNotifierDeps,
  connection: { user_id: string; external_id: string },
): Promise<void>
```

Looks up the user's Telegram chat with the existing `getTelegramConnectionForUser`, formats the
message, sends it. Returns without sending when the user has no Telegram connection. Catches
`TelegramSendError`: on 403 it calls `setConnectionStatus(db, telegramConnection.id,
'needs_reauth')`. Every send failure is logged and swallowed; the function never throws.

`sendMessage` is injected so the notifier's own tests need no network stubbing.

### `apps/backend/src/connections/poller.ts` (modified)

Add to `ConnectionPollerDeps`:

```ts
notifyGmailConnectionLost: (connection: Connection) => Promise<void>
```

Injected alongside the existing `buildGmail` / `importEmail` seams, so poller tests stay pure. In the
auth-error branch, after `setConnectionStatus(deps.db, connection.id, 'needs_reauth')`, call it and
swallow anything it somehow throws.

### `apps/backend/src/telegram/format.ts` (modified)

Add `formatGmailConnectionLost({ email, integrationsUrl })`, using the existing `escapeHtml`. The URL
is built from `APP_BASE_URL` at the call site, as `gmailCallback.ts` already does.

Copy:

```
SpendTracker lost access to a Gmail account:

<strong>{email}</strong>

Transactions from that account will not be imported until you reconnect it.

Reconnect: {APP_BASE_URL}/integrations
```

### Wiring

`app.ts` / `index.ts`, wherever `startConnectionPolling` is composed today, passes the real notifier
bound to the pool and the real `sendMessage`.

## Language

All messages are English. The eight Spanish strings that exist today are translated as part of this
work, so the bot does not speak two languages:

`telegram/format.ts`

| Line | Spanish today | English |
| --- | --- | --- |
| 18 | `Nueva transacción creada en SpendTracker:` | `New transaction created in SpendTracker:` |
| 29 | `Fecha/hora:` | `Date/time:` |
| 42 | `Transacción actualizada:` | `Transaction updated:` |
| 53 | `Transacción eliminada` | `Transaction deleted` |
| 57 | `Error creando la transacción en SpendTracker:` | `Could not create the transaction in SpendTracker:` |

`telegram/webhook.ts`

| Line | Spanish today | English |
| --- | --- | --- |
| 84 | `El código de vinculación no es válido o ya expiró.` | `That pairing code is invalid or has expired.` |
| 91 | `Este chat ya está vinculado a otra cuenta de SpendTracker.` | `This chat is already linked to another SpendTracker account.` |
| 97 | `Chat vinculado a SpendTracker. Responde a un mensaje de transacción para editarla.` | `Chat linked to SpendTracker. Reply to a transaction message to edit it.` |

One existing test asserts Spanish copy (`test/telegram-format.test.ts:16`, `toContain('eliminada')`)
and is updated. No other test, and neither client, asserts any of these strings.

Real localization is out of scope and is recorded as roadmap item 4 in `CLAUDE.md`: a per-user
language preference on the `user` row, a catalog on web, and the backend resolving a locale before
formatting, since Telegram copy is written server-side where no client catalog reaches.

## Tests

- Poller: an auth error calls the notifier once with the connection that broke.
- Poller: a transient error calls the notifier zero times and leaves the status `active`.
- Poller: a notifier that rejects does not abort the cycle; later connections still poll.
- Notifier: no Telegram connection means no send and no throw.
- Notifier: a successful send passes the user's chat id and includes the Gmail address.
- Notifier: a 403 marks the Telegram connection `needs_reauth`.
- Notifier: a 500 is swallowed and leaves the Telegram connection alone.
- Formatter: the Gmail address is HTML-escaped.

## Client parity

Backend only, and the standing "must also ship on Android" rule does not apply: the entire surface is
a Telegram message. Both clients already render the `needs_reauth` status
(`apps/web/src/pages/IntegrationsPage.tsx:17`, `IntegrationsScreen.kt:51`), so there is nothing new
to build on either one.

## Verification

- `pnpm --filter backend typecheck`
- `pnpm --filter backend test`
