# Gmail Disconnect Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the user a Telegram message the moment one of their linked Gmail accounts loses access, so they stop discovering breakage as a gap in their transactions weeks later.

**Architecture:** The alert hangs off exactly one state transition already in the code: `pollConnectionsOnce` catching an auth error and flipping a connection from `active` to `needs_reauth`. Because the poll query selects only `active` rows, that transition happens once per break and needs no dedupe state. A new `notifyConnectionLost.ts` module owns the Telegram side (find the chat, format, send, handle a 403) and is injected into the poller through the existing `ConnectionPollerDeps` seam so poller tests stay pure.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Hono, node-postgres, Vitest, Telegram Bot API.

Spec: `docs/superpowers/specs/2026-08-12-gmail-disconnect-alert-design.md`

## Global Constraints

- **All code in English**: identifiers, comments, test names, commit messages. Enforced by a PostToolUse hook.
- **All Telegram copy in English.** This plan translates the eight Spanish strings that exist today. Do not add new Spanish copy. Localization is roadmap item 4 in `CLAUDE.md` and is out of scope.
- **No em dashes** anywhere: code, comments, docs, commit messages, UI copy. Use a comma, a colon, or two sentences.
- **Descriptive names.** No single-letter or throwaway names for domain values, including in `.map`/`.filter` callbacks and loop bindings. `connection`, not `c`.
- **Commits use `commita` only.** Every task commits with `commita --no-push` (the push happens once at the end, after review). Never `git add && git commit`.
- **Imports use `.js` specifiers** even for `.ts` files, matching the rest of `apps/backend`.
- **Verification per task**: `pnpm --filter backend typecheck` and `pnpm --filter backend test` must both pass before committing.
- **Backend only.** No `apps/web` or `apps/android` changes. Both clients already render the `needs_reauth` status.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/backend/src/telegram/format.ts` | Modify. Add `formatGmailConnectionLost`. Translate the five Spanish strings. |
| `apps/backend/src/telegram/webhook.ts` | Modify. Translate the three Spanish strings. No behaviour change. |
| `apps/backend/src/connections/notifyConnectionLost.ts` | Create. Owns the whole Telegram side of the alert: find the chat, send, handle 403, swallow failures. |
| `apps/backend/src/connections/poller.ts` | Modify. New injected dep `notifyGmailConnectionLost`, called after the status flip. |
| `apps/backend/src/index.ts` | Modify. Wire the real notifier into `startConnectionPolling`. Changes in the same task as the poller, because the dep is required. |
| `apps/backend/test/telegram-format.test.ts` | Modify. Cover the new formatter, update the one Spanish assertion. |
| `apps/backend/test/notifyConnectionLost.test.ts` | Create. Notifier behaviour: no chat, happy path, 403, other failure. |
| `apps/backend/test/connectionPoller.test.ts` | Modify. Notifier called on auth error, not on transient error, and its rejection does not abort the cycle. |

---

### Task 1: English Telegram copy

Translating first means Task 2 adds the new message to a file that already speaks one language, and it keeps the translation in its own reviewable commit.

**Files:**
- Modify: `apps/backend/src/telegram/format.ts` (lines 18, 29, 42, 53, 57)
- Modify: `apps/backend/src/telegram/webhook.ts` (lines 84, 91, 97)
- Test: `apps/backend/test/telegram-format.test.ts:16`

**Interfaces:**
- Consumes: nothing.
- Produces: no signature changes. `formatNewTransaction`, `formatUpdatedTransaction`, `formatDeleted`, `formatError` keep their exact names and parameter types.

- [ ] **Step 1: Update the one test that asserts Spanish copy**

In `apps/backend/test/telegram-format.test.ts`, replace the existing delete-confirmation test:

```ts
  it('formats a delete confirmation', () => {
    expect(formatDeleted()).toBe('Transaction deleted')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter backend test -- telegram-format`
Expected: FAIL. `formatDeleted()` still returns `'Transacción eliminada'`.

- [ ] **Step 3: Translate the five strings in `format.ts`**

Replace each literal, leaving the surrounding structure untouched:

| Line | From | To |
| --- | --- | --- |
| 18 | `'Nueva transacción creada en SpendTracker:'` | `'New transaction created in SpendTracker:'` |
| 29 | `` `Fecha/hora: <code>${view.created_at}</code>` `` | `` `Date/time: <code>${view.created_at}</code>` `` |
| 42 | `'Transacción actualizada:'` | `'Transaction updated:'` |
| 53 | `'Transacción eliminada'` | `'Transaction deleted'` |
| 57 | `` `Error creando la transacción en SpendTracker:\n\n${detail}` `` | `` `Could not create the transaction in SpendTracker:\n\n${detail}` `` |

- [ ] **Step 4: Translate the three strings in `webhook.ts`**

| Line | From | To |
| --- | --- | --- |
| 84 | `'El código de vinculación no es válido o ya expiró.'` | `'That pairing code is invalid or has expired.'` |
| 91 | `'Este chat ya está vinculado a otra cuenta de SpendTracker.'` | `'This chat is already linked to another SpendTracker account.'` |
| 97 | `'Chat vinculado a SpendTracker. Responde a un mensaje de transacción para editarla.'` | `'Chat linked to SpendTracker. Reply to a transaction message to edit it.'` |

- [ ] **Step 5: Verify no Spanish copy is left**

Run: `grep -rnP "[áéíóúñ¿¡ÁÉÍÓÚÑ]" apps/backend/src && grep -rn "Fecha/hora" apps/backend/src`
Expected: no output from either. Verified before this plan was written: the only files that match today are `telegram/format.ts` and `telegram/webhook.ts`, and `Fecha/hora` needs its own grep because it carries no accent.

Spanish that appears inside AI prompts, extraction keywords, or email-parsing rules is domain data, not user copy. There is none in the backend today, but if you find any, leave it alone: translating a bank-email keyword silently breaks transaction parsing.

- [ ] **Step 6: Run the checks**

Run: `pnpm --filter backend typecheck && pnpm --filter backend test`
Expected: both PASS.

- [ ] **Step 7: Commit**

Run: `commita --no-push`

---

### Task 2: The alert message

**Files:**
- Modify: `apps/backend/src/telegram/format.ts`
- Test: `apps/backend/test/telegram-format.test.ts`

**Interfaces:**
- Consumes: the module-local `escapeHtml(value: string): string` already at the top of `format.ts`.
- Produces:

```ts
export interface GmailConnectionLostView {
  email: string
  integrationsUrl: string
}

export function formatGmailConnectionLost(view: GmailConnectionLostView): string
```

Task 3 calls this. The `integrationsUrl` is passed in, not read from env, so the formatter stays pure.

- [ ] **Step 1: Write the failing tests**

Add to `apps/backend/test/telegram-format.test.ts`, and add `formatGmailConnectionLost` to the existing import at the top of the file:

```ts
  it('names the account and links to the integrations page', () => {
    const message = formatGmailConnectionLost({
      email: 'misaelabanto@gmail.com',
      integrationsUrl: 'https://spendtracker.openlinks.app/integrations',
    })
    expect(message).toContain('misaelabanto@gmail.com')
    expect(message).toContain('https://spendtracker.openlinks.app/integrations')
    expect(message).toContain('lost access')
  })

  it('escapes HTML special characters in the account address', () => {
    const message = formatGmailConnectionLost({
      email: 'a<b>&c@gmail.com',
      integrationsUrl: 'https://example.test/integrations',
    })
    expect(message).toContain('a&lt;b&gt;&amp;c@gmail.com')
    expect(message).not.toContain('<b>')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter backend test -- telegram-format`
Expected: FAIL. `formatGmailConnectionLost` is not exported from `../src/telegram/format.js`.

- [ ] **Step 3: Write the formatter**

Append to `apps/backend/src/telegram/format.ts`:

```ts
export interface GmailConnectionLostView {
  email: string
  integrationsUrl: string
}

export function formatGmailConnectionLost(view: GmailConnectionLostView): string {
  return [
    'SpendTracker lost access to a Gmail account:',
    '',
    `<strong>${escapeHtml(view.email)}</strong>`,
    '',
    'Transactions from that account will not be imported until you reconnect it.',
    '',
    `Reconnect: ${view.integrationsUrl}`,
  ].join('\n')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter backend test -- telegram-format`
Expected: PASS.

- [ ] **Step 5: Run the checks**

Run: `pnpm --filter backend typecheck && pnpm --filter backend test`
Expected: both PASS.

- [ ] **Step 6: Commit**

Run: `commita --no-push`

---

### Task 3: The notifier

**Files:**
- Create: `apps/backend/src/connections/notifyConnectionLost.ts`
- Test: `apps/backend/test/notifyConnectionLost.test.ts`

**Interfaces:**
- Consumes: `formatGmailConnectionLost` from Task 2; `getTelegramConnectionForUser(db, userId)` and `setConnectionStatus(db, connectionId, status)` from `./queries.js`; `TelegramSendError` from `../telegram/client.js`.
- Produces:

```ts
export interface ConnectionLostNotifierDeps {
  db: Queryable
  sendMessage: (chatId: string, text: string) => Promise<void>
  integrationsUrl: string
}

export async function notifyGmailConnectionLost(
  deps: ConnectionLostNotifierDeps,
  connection: { user_id: string; external_id: string },
): Promise<void>
```

Task 4 injects a stub of this shape into the poller. Task 5 builds the real one.

Behaviour contract: never throws. The `connection` parameter is deliberately structural rather than the full `Connection` type, so the poller can pass its row directly and the tests can pass a two-field literal.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/test/notifyConnectionLost.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { notifyGmailConnectionLost } from '../src/connections/notifyConnectionLost.js'
import { TelegramSendError } from '../src/telegram/client.js'

const brokenConnection = { user_id: 'user-1', external_id: 'broken@gmail.com' }

function telegramRow(rows: unknown[]) {
  return vi.fn(async (sql: string) =>
    /provider = 'telegram'/.test(sql) ? { rows } : { rows: [] })
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    db: { query: telegramRow([{ id: 'tg-1', user_id: 'user-1', external_id: '5551234' }]) },
    sendMessage: vi.fn().mockResolvedValue(undefined),
    integrationsUrl: 'https://spendtracker.openlinks.app/integrations',
    ...overrides,
  }
}

describe('notifyGmailConnectionLost', () => {
  it('sends the alert to the user telegram chat', async () => {
    const deps = baseDeps()
    await notifyGmailConnectionLost(deps as never, brokenConnection)
    expect(deps.sendMessage).toHaveBeenCalledTimes(1)
    const [chatId, text] = deps.sendMessage.mock.calls[0]
    expect(chatId).toBe('5551234')
    expect(text).toContain('broken@gmail.com')
    expect(text).toContain('https://spendtracker.openlinks.app/integrations')
  })

  it('sends nothing when the user has no telegram connection', async () => {
    const deps = baseDeps({ db: { query: telegramRow([]) } })
    await notifyGmailConnectionLost(deps as never, brokenConnection)
    expect(deps.sendMessage).not.toHaveBeenCalled()
  })

  it('marks the telegram connection needs_reauth when the bot is blocked', async () => {
    const deps = baseDeps({
      sendMessage: vi.fn().mockRejectedValue(new TelegramSendError(403, 'bot was blocked by the user')),
    })
    await notifyGmailConnectionLost(deps as never, brokenConnection)
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['tg-1', 'needs_reauth'])
  })

  it('swallows other send failures and leaves the telegram connection alone', async () => {
    const deps = baseDeps({
      sendMessage: vi.fn().mockRejectedValue(new TelegramSendError(500, 'internal server error')),
    })
    await expect(notifyGmailConnectionLost(deps as never, brokenConnection)).resolves.toBeUndefined()
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall).toBeUndefined()
  })

  it('swallows a database failure', async () => {
    const deps = baseDeps({ db: { query: vi.fn().mockRejectedValue(new Error('connection reset')) } })
    await expect(notifyGmailConnectionLost(deps as never, brokenConnection)).resolves.toBeUndefined()
    expect(deps.sendMessage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter backend test -- notifyConnectionLost`
Expected: FAIL. The module `../src/connections/notifyConnectionLost.js` does not exist.

- [ ] **Step 3: Write the notifier**

Create `apps/backend/src/connections/notifyConnectionLost.ts`:

```ts
import type { Queryable } from '../db/pool.js'
import { TelegramSendError } from '../telegram/client.js'
import { formatGmailConnectionLost } from '../telegram/format.js'
import { getTelegramConnectionForUser, setConnectionStatus } from './queries.js'

export interface ConnectionLostNotifierDeps {
  db: Queryable
  sendMessage: (chatId: string, text: string) => Promise<void>
  integrationsUrl: string
}

/**
 * Tell the user, over Telegram, that one of their Gmail accounts stopped
 * importing. Called at the moment the connection flips to needs_reauth, which
 * is why it needs no dedupe state: the row leaves the active poll set, so the
 * transition happens once per break.
 *
 * Never throws. A Telegram outage must not abort the poll cycle for the other
 * connections, and the Gmail status has already been written by the time we get
 * here, so there is nothing left to roll back.
 */
export async function notifyGmailConnectionLost(
  deps: ConnectionLostNotifierDeps,
  connection: { user_id: string; external_id: string },
): Promise<void> {
  try {
    const telegram = await getTelegramConnectionForUser(deps.db, connection.user_id)
    if (!telegram) return
    try {
      await deps.sendMessage(
        telegram.external_id,
        formatGmailConnectionLost({
          email: connection.external_id,
          integrationsUrl: deps.integrationsUrl,
        }),
      )
    } catch (error) {
      // A 403 means the user blocked or removed the bot, so the telegram
      // connection is dead too and should stop being treated as a live channel.
      if (error instanceof TelegramSendError && error.status === 403) {
        await setConnectionStatus(deps.db, telegram.id, 'needs_reauth')
      }
      throw error
    }
  } catch (error) {
    console.error(`Failed to alert user ${connection.user_id} about a lost Gmail connection:`, error)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter backend test -- notifyConnectionLost`
Expected: PASS, five tests.

- [ ] **Step 5: Run the checks**

Run: `pnpm --filter backend typecheck && pnpm --filter backend test`
Expected: both PASS.

- [ ] **Step 6: Commit**

Run: `commita --no-push`

---

### Task 4: Call the notifier from the poller, and wire it up

The dep is required, so `index.ts` stops typechecking the moment the interface grows. Adding the field and wiring the composition root are one indivisible change.

**Files:**
- Modify: `apps/backend/src/connections/poller.ts` (the `ConnectionPollerDeps` interface at 18-31, the auth-error branch at 67-74)
- Modify: `apps/backend/src/index.ts:24-48`
- Test: `apps/backend/test/connectionPoller.test.ts`

**Interfaces:**
- Consumes: the `notifyGmailConnectionLost` contract from Task 3.
- Produces: a new required field on `ConnectionPollerDeps`:

```ts
notifyGmailConnectionLost: (connection: Connection) => Promise<void>
```

`index.ts` is the composition root and has no test of its own. The typecheck is what proves the wiring.

- [ ] **Step 1: Write the failing tests**

In `apps/backend/test/connectionPoller.test.ts`, add `notifyGmailConnectionLost: vi.fn().mockResolvedValue(undefined),` to the `deps` object inside `baseDeps` (right after `importEmail`), then add these tests to the `describe` block:

```ts
  it('alerts the user when a connection breaks', async () => {
    const failing = encryptedConnection('conn-bad', 'user-1', 'bad@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi.fn().mockRejectedValue(Object.assign(new Error('invalid_grant'), { status: 400 })),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [failing] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.notifyGmailConnectionLost).toHaveBeenCalledTimes(1)
    expect(deps.notifyGmailConnectionLost.mock.calls[0][0].id).toBe('conn-bad')
    expect(deps.notifyGmailConnectionLost.mock.calls[0][0].external_id).toBe('bad@gmail.com')
    // The status must be written before the alert goes out: a Telegram outage
    // must never leave a dead token marked active.
    const statusCall = deps.db.query.mock.calls.find(([sql]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['conn-bad', 'needs_reauth'])
    expect(deps.db.query.mock.invocationCallOrder.at(-1)).toBeLessThan(
      deps.notifyGmailConnectionLost.mock.invocationCallOrder[0],
    )
  })

  it('does not alert on a transient failure', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi.fn().mockRejectedValue(Object.assign(new Error('socket hang up'), { status: 503 })),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [connection] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.notifyGmailConnectionLost).not.toHaveBeenCalled()
    const statusCall = deps.db.query.mock.calls.find(([sql]) => /SET status/.test(sql))
    expect(statusCall).toBeUndefined()
  })

  it('keeps polling the remaining connections when the alert throws', async () => {
    const failing = encryptedConnection('conn-bad', 'user-1', 'bad@gmail.com', '1690000000')
    const healthy = encryptedConnection('conn-ok', 'user-2', 'ok@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('invalid_grant'), { status: 400 }))
        .mockResolvedValueOnce([]),
      notifyGmailConnectionLost: vi.fn().mockRejectedValue(new Error('telegram is down')),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [failing, healthy] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.listSince).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter backend test -- connectionPoller`
Expected: FAIL on the first new test. `notifyGmailConnectionLost` was never called, because the poller does not call it yet.

- [ ] **Step 3: Add the dep to the interface**

In `apps/backend/src/connections/poller.ts`, add to `ConnectionPollerDeps`, after `importEmail`:

```ts
  notifyGmailConnectionLost: (connection: Connection) => Promise<void>
```

- [ ] **Step 4: Call it from the auth-error branch**

Replace the `if (isAuthError(error))` branch inside `pollConnectionsOnce`:

```ts
        if (isAuthError(error)) {
          // Status first: a Telegram outage must never leave a dead token
          // marked active, or the poller retries it forever.
          await setConnectionStatus(deps.db, connection.id, 'needs_reauth')
          console.error(`Connection ${connection.id} needs re-auth:`, error)
          try {
            await deps.notifyGmailConnectionLost(connection)
          } catch (notifyError) {
            console.error(`Failed to alert about connection ${connection.id}:`, notifyError)
          }
        } else {
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter backend test -- connectionPoller`
Expected: PASS, seven tests.

- [ ] **Step 6: Add the import to the composition root**

Typecheck is now red: `index.ts` builds the deps object and the new field is required. In `apps/backend/src/index.ts`, next to the other `./connections/` imports:

```ts
import { notifyGmailConnectionLost } from './connections/notifyConnectionLost.js'
```

- [ ] **Step 7: Pass the real notifier**

Inside the `startConnectionPolling` deps object in `apps/backend/src/index.ts`, after `importEmail`, add:

```ts
      notifyGmailConnectionLost: (connection) =>
        notifyGmailConnectionLost(
          { db, sendMessage, integrationsUrl: `${env.APP_BASE_URL}/integrations` },
          connection,
        ),
```

`sendMessage`, `env` and `db` are already imported and in scope in that file. The `/integrations` path matches what `gmailCallback.ts` redirects to. The property key and the imported function share a name; that is not a shadowing problem, because an object key is not a binding.

- [ ] **Step 8: Run the checks**

Run: `pnpm --filter backend typecheck && pnpm --filter backend test`
Expected: both PASS, with no "Property 'notifyGmailConnectionLost' is missing" error. Do not commit a red typecheck.

- [ ] **Step 9: Build**

Run: `pnpm --filter backend build`
Expected: builds clean.

- [ ] **Step 10: Commit**

Run: `commita --no-push`

---

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

Roadmap item 4 (Localization) was already added to `CLAUDE.md` while the spec was written. This task records the shipped feature so the next reader knows the alert exists and why it needs no dedupe state.

- [ ] **Step 1: Record the behaviour where the roadmap items live**

In `CLAUDE.md`, immediately after the numbered roadmap list (so it sits with the connections work it belongs to, not under `### Android specifics`, which is about the client), add:

```markdown
- A Gmail connection that loses access is announced over Telegram, not in-app: the poller flips it to `needs_reauth` and `connections/notifyConnectionLost.ts` sends the alert. Both clients only show the resulting status on their Integrations screens.
```

- [ ] **Step 2: Verify the docs still read correctly**

Run: `grep -n "notifyConnectionLost" CLAUDE.md`
Expected: one match.

- [ ] **Step 3: Commit**

Run: `commita --no-push`

---

## Final verification

After Task 5, before pushing:

- [ ] `pnpm --filter backend typecheck` passes
- [ ] `pnpm --filter backend test` passes
- [ ] `grep -rnP "[áéíóúñ¿¡]" apps/backend/src` returns nothing
- [ ] `git log --oneline main..HEAD` shows one commit per task
- [ ] Ask the user before pushing
