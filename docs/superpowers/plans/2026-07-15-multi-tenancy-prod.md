# Multi-Tenancy & Production-Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SpendTracker safe for multiple real users by scoping all ledger data to the authenticated user, hardening the auth path against the mock-mode bypass, and enforcing an invite allowlist — so a second person can sign in and see only their own data.

**Architecture:** Add a `user_id` foreign key (to Better Auth's `"user"` table) on every ledger table (`accounts`, `categories`, `transactions`). Thread the authenticated user id from the session guard onto the Hono request context, and push it as an explicit parameter into every query so the SQL filters/inserts by owner. Reject mock mode in production and require the allowlist to be set.

**Tech Stack:** Hono + Better Auth + node-postgres (`pg`) on the backend; Vitest for tests; raw SQL migrations run by `apps/backend/scripts/migrate.ts`. TypeScript throughout.

## Global Constraints

- Package manager is pnpm; run backend commands with `pnpm --filter backend <script>` from the repo root, or `pnpm exec <cmd>` inside `apps/backend`.
- Backend tests: `pnpm --filter backend test` (Vitest). Typecheck: `pnpm --filter backend typecheck`.
- Never use em dashes in any code, comment, commit message, or doc. Use a hyphen, colon, comma, or two sentences.
- Use descriptive variable names (`transaction`, `account`, `userId`), never single letters for domain values.
- Commit only via `commita` (or `commita --no-push`). Never `git add && git commit`. Each task commits its own work.
- Ledger tables are `accounts`, `categories`, `transactions`. Better Auth tables are `"user"`, `"session"`, `"account"` (singular, OAuth), `"verification"`. The new FK targets `"user"("id")`, whose type is `text`.
- The owner's email comes from `ALLOWED_EMAILS` (first entry). Today's default is `misaelabanto@gmail.com`.

## Out of scope (future plans)

- **Per-user Gmail/Telegram auto-import** (including linking multiple Gmail accounts as a premium feature). For this milestone the Gmail poller and Telegram webhook stay owner-only: their imported rows are attributed to the owner's user id (Task 12). A separate plan will add per-user connections.
- **Deployment execution.** Appendix A is a checklist, not TDD tasks.

---

## File Structure

- `apps/backend/scripts/migrate.ts` — MODIFY: run every `NNN_*.sql` migration in sorted order (today it only runs `001_init.sql`), tracked in a `schema_migrations` table so re-runs are safe.
- `apps/backend/migrations/003_user_scoping.sql` — CREATE: add nullable `user_id` + index to the three ledger tables.
- `apps/backend/migrations/004_user_scoping_not_null.sql` — CREATE: set `user_id NOT NULL` (applied after backfill).
- `apps/backend/scripts/backfill-owner.ts` — CREATE: assign every `user_id IS NULL` ledger row to the owner (looked up by email).
- `apps/backend/src/auth/sessionGuard.ts` — MODIFY: store the authenticated user id on the Hono context.
- `apps/backend/src/auth/resolveSession.ts` — MODIFY: return a typed `{ user: { id } }` session; the mock branch already does.
- `apps/backend/src/http/context.ts` — CREATE: shared Hono `Variables` type + a `getUserId(context)` helper.
- `apps/backend/src/app.ts` — MODIFY: guard sets `userId`; type the app with `Variables`.
- `apps/backend/src/db/queries.ts` — MODIFY: add `userId` param to every ledger read/write and scope the SQL.
- `apps/backend/src/db/transactionFilter.ts` — MODIFY: add `userId` to the always-on conditions.
- `apps/backend/src/routes/accounts.ts`, `categories.ts`, `transactions.ts`, `transfers.ts`, `tags.ts` — MODIFY: read `userId` from context and pass it to queries.
- `apps/backend/src/config/env.ts` — MODIFY: in production, reject `APP_MODE=mock` and require a non-default `ALLOWED_EMAILS`.
- Test files alongside each: `test/queries.test.ts`, `test/transactionFilter.test.ts`, `test/accounts.test.ts`, `test/categories.test.ts`, `test/transactions.test.ts`, `test/transfers.test.ts`, `test/tags.test.ts`, `test/sessionGuard.test.ts`, `test/env.test.ts`, plus a new `test/migrate.test.ts`.

---

## Phase 1 — Migration runner and schema

### Task 1: Make the migration runner apply all migrations in order

**Files:**
- Modify: `apps/backend/scripts/migrate.ts`
- Create: `apps/backend/src/db/migrationFiles.ts` (a testable pure helper)
- Test: `apps/backend/test/migrate.test.ts`

**Interfaces:**
- Produces: `sortMigrationFileNames(fileNames: string[]): string[]` — returns only `NNN_*.sql` names, ascending by the numeric prefix.

**Why:** `migrate.ts` today hardcodes `001_init.sql`, so `002_auth.sql` and every new migration never run. Deploys silently miss schema changes.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/test/migrate.test.ts
import { describe, it, expect } from 'vitest'
import { sortMigrationFileNames } from '../src/db/migrationFiles.js'

describe('sortMigrationFileNames', () => {
  it('keeps only NNN_*.sql files, ordered by numeric prefix', () => {
    const input = ['010_late.sql', '002_auth.sql', 'README.md', '001_init.sql', '.keep']
    expect(sortMigrationFileNames(input)).toEqual([
      '001_init.sql',
      '002_auth.sql',
      '010_late.sql',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter backend test -- migrate`
Expected: FAIL — cannot find module `../src/db/migrationFiles.js`.

- [ ] **Step 3: Write the helper**

```typescript
// apps/backend/src/db/migrationFiles.ts
// Ordered list of migration file names. Only NNN_*.sql files run, sorted by the
// leading number so 010 lands after 002 (lexical sort would misorder them).
export function sortMigrationFileNames(fileNames: string[]): string[] {
  return fileNames
    .filter((fileName) => /^\d+_.*\.sql$/.test(fileName))
    .sort((first, second) => Number(first.split('_')[0]) - Number(second.split('_')[0]))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter backend test -- migrate`
Expected: PASS.

- [ ] **Step 5: Rewrite the runner to apply every migration once, tracked**

```typescript
// apps/backend/scripts/migrate.ts
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { sortMigrationFileNames } from '../src/db/migrationFiles.js'

async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exitCode = 1
    return
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const migrationsDirectory = join(scriptDirectory, '..', 'migrations')
  const migrationFileNames = sortMigrationFileNames(await readdir(migrationsDirectory))

  const pool = new pg.Pool({ connectionString })
  try {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    for (const migrationFileName of migrationFileNames) {
      const alreadyApplied = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [migrationFileName],
      )
      if (alreadyApplied.rows.length > 0) {
        console.log(`Skipping already-applied ${migrationFileName}`)
        continue
      }
      const migrationSql = await readFile(join(migrationsDirectory, migrationFileName), 'utf8')
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(migrationSql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migrationFileName])
        await client.query('COMMIT')
        console.log(`Applied ${migrationFileName}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    }
  } finally {
    await pool.end()
  }
}

runMigrations().catch((error) => {
  console.error('Migration failed:', error)
  process.exitCode = 1
})
```

Note: `001_init.sql` and `002_auth.sql` are already idempotent (`CREATE TABLE IF NOT EXISTS`), so on an existing database they will be recorded as applied on the first run without harm.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter backend typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
commita --no-push -x "Fix migrate runner to apply all NNN_*.sql migrations in order, tracked in schema_migrations. Previously only 001_init.sql ran, so 002 and later were never applied."
```

---

### Task 2: Add nullable user_id columns to ledger tables

**Files:**
- Create: `apps/backend/migrations/003_user_scoping.sql`

**Interfaces:**
- Produces: `accounts.user_id`, `categories.user_id`, `transactions.user_id` (all `text` nullable, each indexed, FK to `"user"("id")` on delete cascade).

There is no unit test for raw SQL; this task is verified by the runner and downstream query tests.

- [ ] **Step 1: Write the migration**

```sql
-- apps/backend/migrations/003_user_scoping.sql
-- Add per-user ownership to ledger tables. Nullable for now so existing rows
-- survive; a backfill (scripts/backfill-owner.ts) then 004 makes it NOT NULL.
ALTER TABLE accounts     ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"("id") ON DELETE CASCADE;
ALTER TABLE categories   ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"("id") ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id text REFERENCES "user"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS accounts_user_id_idx     ON accounts(user_id);
CREATE INDEX IF NOT EXISTS categories_user_id_idx   ON categories(user_id);
CREATE INDEX IF NOT EXISTS transactions_user_id_idx ON transactions(user_id);
```

- [ ] **Step 2: Verify it parses against a scratch database (optional, if a local Postgres is available)**

Run: `DATABASE_URL=<scratch> pnpm --filter backend migrate`
Expected: `Applied 003_user_scoping.sql`. Skip if no scratch DB; the columns are exercised by later tasks.

- [ ] **Step 3: Commit**

```bash
commita --no-push -x "Add nullable user_id FK + index to accounts, categories, transactions (migration 003). Nullable so existing rows survive until backfill."
```

---

### Task 3: Backfill script assigns existing rows to the owner

**Files:**
- Create: `apps/backend/scripts/backfill-owner.ts`
- Create: `apps/backend/migrations/004_user_scoping_not_null.sql`

**Interfaces:**
- Consumes: the owner's Better Auth user id, resolved by email from `ALLOWED_EMAILS`.

**Why:** The app was single-user, so every existing row belongs to the owner. The owner must have signed in via Google at least once (so a `"user"` row exists) before running this.

- [ ] **Step 1: Write the backfill script**

```typescript
// apps/backend/scripts/backfill-owner.ts
// One-off: assign every ledger row with a NULL user_id to the owner (the first
// email in ALLOWED_EMAILS). The owner must have signed in once so a "user" row
// exists. Run AFTER migration 003, BEFORE migration 004.
import pg from 'pg'

async function backfill(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  const ownerEmail = (process.env.ALLOWED_EMAILS ?? '').split(',')[0]?.trim()
  if (!connectionString || !ownerEmail) {
    console.error('DATABASE_URL and ALLOWED_EMAILS must be set')
    process.exitCode = 1
    return
  }
  const pool = new pg.Pool({ connectionString })
  try {
    const owner = await pool.query('SELECT id FROM "user" WHERE email = $1', [ownerEmail])
    const ownerId = owner.rows[0]?.id as string | undefined
    if (!ownerId) {
      console.error(`No "user" row for ${ownerEmail}. Sign in once with Google, then re-run.`)
      process.exitCode = 1
      return
    }
    for (const table of ['accounts', 'categories', 'transactions']) {
      const result = await pool.query(
        `UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`,
        [ownerId],
      )
      console.log(`Backfilled ${result.rowCount} rows in ${table}`)
    }
  } finally {
    await pool.end()
  }
}

backfill().catch((error) => {
  console.error('Backfill failed:', error.message)
  process.exitCode = 1
})
```

- [ ] **Step 2: Write the NOT NULL migration (applied after backfill)**

```sql
-- apps/backend/migrations/004_user_scoping_not_null.sql
-- Runs only after scripts/backfill-owner.ts has populated user_id on every row.
ALTER TABLE accounts     ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE categories   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;
```

- [ ] **Step 3: Commit**

```bash
commita --no-push -x "Add owner backfill script and the follow-up NOT NULL migration (004). Deploy order: migrate (003), owner signs in, run backfill-owner, migrate (004)."
```

---

## Phase 2 — Thread the user id through the request

### Task 4: Session guard stores the user id on the context

**Files:**
- Create: `apps/backend/src/http/context.ts`
- Modify: `apps/backend/src/auth/sessionGuard.ts`
- Modify: `apps/backend/src/app.ts`
- Test: `apps/backend/test/sessionGuard.test.ts`

**Interfaces:**
- Produces: `type AppVariables = { userId: string }`; `getUserId(context): string`.
- Produces: the guard calls `context.set('userId', session.user.id)` before `next()`.

- [ ] **Step 1: Write the shared context helper**

```typescript
// apps/backend/src/http/context.ts
import type { Context } from 'hono'

// Variables the session guard populates and handlers read. Typing the Hono app
// with this makes context.get('userId') a string, not unknown.
export type AppVariables = {
  userId: string
}

export function getUserId(context: Context<{ Variables: AppVariables }>): string {
  return context.get('userId')
}
```

- [ ] **Step 2: Write/adjust the guard test**

```typescript
// apps/backend/test/sessionGuard.test.ts (add this case)
import { Hono } from 'hono'
import { createSessionGuard } from '../src/auth/sessionGuard.js'
import type { AppVariables } from '../src/http/context.js'

it('sets userId on the context from the resolved session', async () => {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', createSessionGuard(async () => ({ user: { id: 'user-123' } })))
  app.get('/whoami', (context) => context.json({ userId: context.get('userId') }))
  const response = await app.request('/whoami')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ userId: 'user-123' })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter backend test -- sessionGuard`
Expected: FAIL — `userId` is undefined (guard does not set it yet).

- [ ] **Step 4: Update the guard to read the user and set the context**

```typescript
// apps/backend/src/auth/sessionGuard.ts
import type { MiddlewareHandler } from 'hono'
import type { AppVariables } from '../http/context.js'

// A session shaped like Better Auth's getSession result (and the mock resolver):
// { user: { id, ... } }. Only the id is needed to scope data.
type ResolvedSession = { user: { id: string } } | null | undefined

export function createSessionGuard(
  getSession: (headers: Headers) => Promise<unknown>,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    const session = (await getSession(context.req.raw.headers)) as ResolvedSession
    if (!session || !session.user?.id) {
      return context.json({ error: 'Unauthorized' }, 401)
    }
    context.set('userId', session.user.id)
    await next()
  }
}
```

- [ ] **Step 5: Type the app with AppVariables**

In `apps/backend/src/app.ts`, change `const app = new Hono()` to:

```typescript
import type { AppVariables } from './http/context.js'
// ...
const app = new Hono<{ Variables: AppVariables }>()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter backend test -- sessionGuard`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Session guard now stores the authenticated user id on the Hono context (AppVariables.userId) so handlers can scope queries by owner."
```

---

## Phase 3 — Scope queries by user (the bulk)

For each task in this phase the transformation is the same shape, applied to
specific functions. The pattern:

- **Reads (list/get):** add `userId: string` as the first parameter after `db`; add `user_id = $N` to the `WHERE` clause (raising other placeholder indexes accordingly); push `userId` into the params array.
- **Writes (insert):** add `user_id` to the column list and `$N` to `VALUES`, passing `userId`.
- **Writes (update/delete/getById):** add `AND user_id = $N` to the `WHERE id = $1` clause so a user can only touch their own rows (a mismatched id returns 0 rows → 404, never another user's data).
- **Routes:** read `const userId = getUserId(context)` and pass it as the new argument.
- **Existing tests:** update every route/query test to pass a `userId` argument and assert the SQL contains `user_id`.

### Task 5: Scope account queries and route

**Files:**
- Modify: `apps/backend/src/db/queries.ts` (`getAccounts`, `getAccountById`, `insertAccount`, `updateAccount`, `deleteAccount`)
- Modify: `apps/backend/src/routes/accounts.ts`
- Test: `apps/backend/test/accounts.test.ts`, `apps/backend/test/queries.test.ts`

**Interfaces:**
- Produces: `getAccounts(db, userId)`, `getAccountById(db, userId, id)`, `insertAccount(db, userId, account)`, `updateAccount(db, userId, update)`, `deleteAccount(db, userId, id)`.

- [ ] **Step 1: Update the account route test to expect user scoping**

In `apps/backend/test/accounts.test.ts`, for the list test assert the SQL is scoped. Example for the GET list case:

```typescript
it('GET /api/accounts lists only the user rows', async () => {
  const db = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) }
  const route = createAccountsRoute(() => db)
  // The guard normally sets userId; inject it for the unit test.
  const response = await route.request('/api/accounts', {
    headers: {},
  }, { Variables: { userId: 'user-1' } } as never)
  // If the route factory reads userId from context, drive it through app-level
  // middleware in the test instead (see note). Assert scoping on the SQL:
  const listSql = db.query.mock.calls[0][0]
  expect(listSql).toMatch(/user_id = \$/)
  expect(db.query.mock.calls[0][1]).toContain('user-1')
})
```

Note for the implementer: route unit tests currently call `route.request(path)` with no session. Because handlers now need `context.get('userId')`, wrap the route under a tiny middleware in the test that sets it: `route.use('*', async (context, next) => { context.set('userId', 'user-1'); await next() })` registered before `route.route(...)`, or build a parent `Hono<{ Variables: AppVariables }>()` that sets it then mounts the route. Use whichever the existing suite finds cleanest; the assertion (`user_id = $`, param contains `'user-1'`) is what matters.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter backend test -- accounts`
Expected: FAIL — SQL has no `user_id`.

- [ ] **Step 3: Scope the account queries**

Edit `apps/backend/src/db/queries.ts`. Apply the read/write pattern above. Concretely:

```typescript
export async function getAccounts(db: Queryable, userId: string): Promise<Account[]> {
  const result = await db.query(
    'SELECT id, name, type, currency FROM accounts WHERE user_id = $1 ORDER BY name',
    [userId],
  )
  return result.rows as Account[]
}

export async function getAccountById(
  db: Queryable, userId: string, id: string,
): Promise<Account | null> {
  const result = await db.query(
    'SELECT id, name, type, currency FROM accounts WHERE id = $1 AND user_id = $2',
    [id, userId],
  )
  return result.rows.length ? (result.rows[0] as Account) : null
}

export async function insertAccount(
  db: Queryable, userId: string, account: NewAccount,
): Promise<{ id: string }> {
  const result = await db.query(
    'INSERT INTO accounts (name, type, currency, user_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [account.name, account.type, account.currency, userId],
  )
  return { id: result.rows[0].id as string }
}
```

Apply the same `AND user_id = $N` scoping to `updateAccount` (add to its `WHERE id = ...`) and `deleteAccount`. Preserve each function's existing column list and ordering; only add the user scoping.

- [ ] **Step 4: Pass userId from the route**

In `apps/backend/src/routes/accounts.ts`, import `getUserId` from `../http/context.js`, and in each handler read `const userId = getUserId(context)` and pass it as the new first data argument (`getAccounts(db, userId)`, `insertAccount(db, userId, parsed.data)`, etc.).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter backend test -- accounts queries`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Scope account queries and route by the authenticated user_id so each user only sees and edits their own accounts."
```

---

### Task 6: Scope category queries and route

**Files:**
- Modify: `apps/backend/src/db/queries.ts` (`getCategories`, `getCategoryById`, `insertCategory`, `updateCategory`, `deleteCategory`)
- Modify: `apps/backend/src/routes/categories.ts`
- Test: `apps/backend/test/categories.test.ts`

**Interfaces:**
- Produces: `getCategories(db, userId)`, `getCategoryById(db, userId, id)`, `insertCategory(db, userId, category)`, `updateCategory(db, userId, update)`, `deleteCategory(db, userId, id)`.

- [ ] **Step 1: Update `test/categories.test.ts`** the same way as Task 5 Step 1 (inject `userId`, assert `user_id = $` in the list SQL and the param array contains the id).
- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter backend test -- categories`.
- [ ] **Step 3: Scope the five category functions** in `queries.ts` using the read/write pattern (mirror the exact shape shown for accounts in Task 5 Step 3: `WHERE user_id = $1 ORDER BY name` for the list, `id = $1 AND user_id = $2` for by-id/update/delete, `user_id` added to the insert columns/values).
- [ ] **Step 4: Pass `getUserId(context)`** into each call in `apps/backend/src/routes/categories.ts`.
- [ ] **Step 5: Run to verify PASS** — `pnpm --filter backend test -- categories`.
- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Scope category queries and route by user_id."
```

---

### Task 7: Scope the transaction filter by user

**Files:**
- Modify: `apps/backend/src/db/transactionFilter.ts`
- Test: `apps/backend/test/transactionFilter.test.ts`

**Interfaces:**
- Consumes: `TransactionFilter.userId?: string`.
- Produces: `buildTransactionFilter` emits `user_id = $N` whenever `userId` is set.

**Why:** `getTransactions`, `getTransactionsCount`, and `getAnalytics` all share `buildTransactionFilter`, so scoping there covers the list, count, and every analytics aggregate in one place.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/test/transactionFilter.test.ts (add)
it('scopes by user_id when userId is set', () => {
  const { clause, params } = buildTransactionFilter({ userId: 'user-1' })
  expect(clause).toMatch(/user_id = \$1/)
  expect(params).toEqual(['user-1'])
})
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter backend test -- transactionFilter`.

- [ ] **Step 3: Add userId to the interface and the first condition**

In `apps/backend/src/db/transactionFilter.ts` add `userId?: string` to the `TransactionFilter` interface, and add this as the FIRST condition inside `buildTransactionFilter`, before the `q` block:

```typescript
if (filter.userId) {
  conditions.push(`user_id = $${placeholder}`)
  params.push(filter.userId)
  placeholder += 1
}
```

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter backend test -- transactionFilter`.
- [ ] **Step 5: Commit**

```bash
commita --no-push -x "Add user_id scoping to buildTransactionFilter so list, count, and analytics all filter by owner from one place."
```

---

### Task 8: Scope transaction queries and route

**Files:**
- Modify: `apps/backend/src/db/queries.ts` (`getTransactions`, `getTransactionsCount`, `getAnalytics`, `getTransactionById`, `insertTransaction`, `updateTransaction`, `deleteTransaction`, `getDistinctTags`)
- Modify: `apps/backend/src/routes/transactions.ts`, `apps/backend/src/routes/tags.ts`
- Test: `apps/backend/test/transactions.test.ts`, `apps/backend/test/tags.test.ts`, `apps/backend/test/analytics.test.ts`, `apps/backend/test/queries.test.ts`

**Interfaces:**
- Produces:
  - `getTransactions(db, filter, page)` and `getTransactionsCount(db, filter)` and `getAnalytics(db, filter, bucket)` — unchanged signatures; the caller now sets `filter.userId`.
  - `getTransactionById(db, userId, id)`, `insertTransaction(db, userId, transaction)`, `updateTransaction(db, userId, update)`, `deleteTransaction(db, userId, id)`, `getDistinctTags(db, userId)`.

- [ ] **Step 1: Update the route tests** in `test/transactions.test.ts` and `test/tags.test.ts` to inject `userId` (as in Task 5 Step 1) and assert the list/tags SQL contains `user_id = $`. The existing `?currency=USD` test keeps working; add that `user_id` is also present.

- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter backend test -- transactions tags`.

- [ ] **Step 3: Scope the read aggregates via the filter.** In `apps/backend/src/routes/transactions.ts`, in `parseListQuery`, set `userId` on the returned `filter` object: add `const userId = getUserId(context)` in each handler and include `userId` when building the `TransactionFilter` (parseListQuery takes `context`, so add `userId: getUserId(context)` to the filter it returns). No SQL change is needed in `getTransactions`/`getTransactionsCount`/`getAnalytics` because they delegate to `buildTransactionFilter` (Task 7).

- [ ] **Step 4: Scope the direct-by-id functions.** In `queries.ts`:

```typescript
export async function getTransactionById(
  db: Queryable, userId: string, id: string,
): Promise<Transaction | null> {
  const result = await db.query(
    `SELECT id, description, amount::float8 AS amount, currency, account_id, category_id, tags, created_at, updated_at
       FROM transactions WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return result.rows.length ? (result.rows[0] as Transaction) : null
}
```

Add `user_id` to `insertTransaction` (extra column + `$8` value = `userId`, as the new first parameter after `db`). Add `AND user_id = $N` to `updateTransaction` and `deleteTransaction` WHERE clauses. Scope `getDistinctTags` with `WHERE user_id = $1`.

- [ ] **Step 5: Pass userId from the routes.** In `transactions.ts` handlers, pass `userId` to `getTransactionById`, `insertTransaction`, `updateTransaction`, `deleteTransaction`. In `tags.ts`, pass `getUserId(context)` to `getDistinctTags`.

- [ ] **Step 6: Run to verify PASS** — `pnpm --filter backend test -- transactions tags analytics queries`.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Scope every transaction read/write (list, count, analytics, by-id, insert, update, delete, tags) by the authenticated user_id."
```

---

### Task 9: Scope the transfer endpoint

**Files:**
- Modify: `apps/backend/src/db/queries.ts` (`createTransfer` — the two `insertTransaction` calls now pass `userId`)
- Modify: `apps/backend/src/routes/transfers.ts`
- Test: `apps/backend/test/transfers.test.ts`

**Interfaces:**
- Produces: `createTransfer(pool, userId, legs)` — both inserted legs carry `user_id = userId`.

- [ ] **Step 1: Update `test/transfers.test.ts`** to inject `userId` (parent middleware setting `context.set('userId', 'user-1')`) and assert both insert param arrays contain `'user-1'`.
- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter backend test -- transfers`.
- [ ] **Step 3: Thread userId** — change `createTransfer(pool, legs)` to `createTransfer(pool, userId, legs)` and pass `userId` into both `insertTransaction(client, userId, legs.from)` / `insertTransaction(client, userId, legs.to)` calls. In `transfers.ts`, read `const userId = getUserId(context)` and pass it.
- [ ] **Step 4: Run to verify PASS** — `pnpm --filter backend test -- transfers`.
- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Scope both legs of a transfer to the authenticated user_id."
```

---

## Phase 4 — Production safety

### Task 10: Reject mock mode and default allowlist in production

**Files:**
- Modify: `apps/backend/src/config/env.ts`
- Test: `apps/backend/test/env.test.ts`

**Interfaces:**
- Produces: `loadEnv` throws when `NODE_ENV=production` and `APP_MODE=mock`, and when `NODE_ENV=production` and `ALLOWED_EMAILS` is unset/empty.

**Why:** `APP_MODE=mock` synthesizes a session for every request (no auth) and the web build's `VITE_APP_MODE=mock` skips the login gate. If either reaches prod, anyone has full access. Fail fast instead.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/backend/test/env.test.ts (add)
it('rejects mock mode in production', () => {
  expect(() =>
    loadEnv({ ...validEnv, NODE_ENV: 'production', APP_MODE: 'mock' }),
  ).toThrow(/mock/i)
})

it('requires ALLOWED_EMAILS in production', () => {
  const { ALLOWED_EMAILS, ...withoutAllowlist } = validEnv
  expect(() =>
    loadEnv({ ...withoutAllowlist, NODE_ENV: 'production', APP_MODE: 'live' }),
  ).toThrow(/ALLOWED_EMAILS/i)
})
```

(Reuse or define `validEnv` as a complete valid env object in the test file, matching the existing env test's fixture.)

- [ ] **Step 2: Run to verify FAIL** — `pnpm --filter backend test -- env`.

- [ ] **Step 3: Add the production guards.** In `apps/backend/src/config/env.ts`, add `NODE_ENV: z.string().optional()` to the schema if absent, and after the successful `schema.safeParse`, before returning, add:

```typescript
const parsedEnv = parsed.data
if (parsedEnv.NODE_ENV === 'production') {
  if (parsedEnv.APP_MODE === 'mock') {
    throw new Error('APP_MODE=mock is not allowed in production (it bypasses auth).')
  }
  if (!source.ALLOWED_EMAILS || source.ALLOWED_EMAILS.trim() === '') {
    throw new Error('ALLOWED_EMAILS must be set explicitly in production.')
  }
}
return parsedEnv
```

Note: because `ALLOWED_EMAILS` has a schema default, check the raw `source.ALLOWED_EMAILS` (not the parsed value) so the owner-only default does not silently satisfy the production requirement.

- [ ] **Step 4: Run to verify PASS** — `pnpm --filter backend test -- env`.
- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Fail fast in production if APP_MODE=mock (auth bypass) or ALLOWED_EMAILS is unset, so the LAN-preview mock config can never reach prod."
```

---

### Task 11: Full regression + verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite green** — `pnpm --filter backend test` → all pass.
- [ ] **Step 2: Backend typecheck** — `pnpm --filter backend typecheck` → clean.
- [ ] **Step 3: Web typecheck + tests** — `pnpm --filter web typecheck && pnpm --filter web test` → clean/pass (no web code changed, but confirm nothing broke).
- [ ] **Step 4: Manual two-user smoke (against a scratch DB in live mode).** Sign in as two allowlisted Google accounts; create an account/transaction as user A; confirm user B sees an empty ledger and cannot GET/PATCH/DELETE user A's rows by id (expect 404). Document the result.
- [ ] **Step 5: Commit any test fixups**

```bash
commita --no-push -x "Regression pass for multi-tenancy: full backend suite, typecheck, and two-user isolation smoke."
```

---

## Task 12: Attribute owner-only imports (Gmail/Telegram) to the owner

**Files:**
- Modify: `apps/backend/src/index.ts` (Gmail poller wiring), `apps/backend/src/telegram/webhook.ts`, and their `insertTransaction`/`processEmail` calls.
- Test: `apps/backend/test/processEmail.test.ts`, `apps/backend/test/telegram-webhook.test.ts`

**Interfaces:**
- Consumes: the owner's user id, resolved once at startup by email from `ALLOWED_EMAILS` (same lookup as the backfill).

**Why:** After Task 8, `insertTransaction` requires a `userId`. The Gmail poller and Telegram webhook still run server-side with no session, so they must attribute imported rows to the owner. This keeps the existing single-user import working; per-user import is a future plan.

- [ ] **Step 1: Add an owner-id resolver.** In `queries.ts` add `getUserIdByEmail(db, email): Promise<string | null>` (`SELECT id FROM "user" WHERE email = $1`). Unit test it in `queries.test.ts` with a mock db.
- [ ] **Step 2: Resolve the owner id at startup** in `index.ts` (first entry of `ALLOWED_EMAILS`); if absent, log a clear warning and skip starting the poller (the owner has not signed in yet).
- [ ] **Step 3: Thread the owner id** into `processEmail`/the poller `onEmail` and the Telegram webhook so their `insertTransaction` calls pass it. Update the two tests to pass and assert the owner id.
- [ ] **Step 4: Run to verify PASS** — `pnpm --filter backend test -- processEmail telegram-webhook queries`.
- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter backend typecheck
commita --no-push -x "Attribute Gmail/Telegram auto-imports to the owner user id so imports keep working under user-scoped inserts. Per-user import is a later milestone."
```

---

## Self-Review notes (for the executor)

- Every ledger read and write is now scoped: list/get/insert/update/delete for accounts, categories, transactions; analytics and tags; both transfer legs; and the two import paths. If you add a new ledger query, it MUST take `userId`.
- `getTransactionById` scoping means update/delete of another user's row returns 404 (row not found for this user), which the existing route 404 handling already surfaces correctly.
- The mock resolver returns `{ user: { id: mockUser } }`, so `userId` is `demo-user` (or the `x-mock-user` header) in mock mode. Mock mode is dev/LAN-only and now blocked in production (Task 10).

---

## Appendix A — Deployment checklist (not TDD tasks)

Do these when promoting to a real environment (Coolify):

- **Topology (recommended: same-origin).** Serve the web build and proxy `/api` to the backend under one HTTPS domain. This avoids cross-origin cookie/CORS issues. Set the web build's `VITE_API_URL` to `/api` (default) and reverse-proxy `/api` → backend:3000.
- **Web hosting.** `pnpm --filter web build` produces static assets in `apps/web/dist`; serve them via the proxy/static host. (The backend serves no static files today.)
- **Backend env (production):** `NODE_ENV=production`, `APP_MODE=live` (mock now rejected), `DATABASE_URL`, fresh strong `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://<prod-origin>`, `WEB_ORIGIN=https://<prod-origin>`, `GOOGLE_CLIENT_ID/SECRET`, `ALLOWED_EMAILS=<invited emails>`, `OPENAI_*`. Include `GOOGLE_*`/`TELEGRAM_*` only if keeping owner-only import.
- **Web env (production):** do NOT set `VITE_APP_MODE` (mock bypass); set `VITE_API_URL` per topology.
- **Google OAuth:** add `https://<prod-origin>/api/auth/callback/google` to the OAuth client's authorized redirect URIs. A public consent screen may need Google verification (invite-only can stay in testing with the allowlisted testers).
- **Migrations on deploy:** run `pnpm --filter backend migrate` (now applies 003). Sign in once as the owner, run `pnpm --filter backend exec tsx scripts/backfill-owner.ts`, then run `migrate` again for 004.
- **Cookies/TLS:** HTTPS only; Better Auth secure cookies. Same-origin topology keeps `sameSite` simple.
- **Operational:** managed Postgres backups; error monitoring (e.g. Sentry); rate limiting on `/api/auth/*`; the existing `/health` check as the container healthcheck; CI running `pnpm -r typecheck && pnpm -r test` before deploy.

## Appendix B — Future plan: per-user integrations (premium)

Not in this milestone. Sketch: a `connection` table (`user_id`, provider, encrypted OAuth tokens, status) so each user links their own Gmail (multiple allowed for premium) and Telegram; the poller iterates connections instead of one env-configured token; imported rows attribute to the connection's `user_id`. Requires its own spec and plan.
