# Transaction Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side search, filters, and ECharts analytics to the spend tracker, all driven by one shared URL-based filter set across the Dashboard and Transactions pages.

**Architecture:** Separate, independent work on `main` (not on `feature/multicurrency-p0`). Backend gains a single `buildTransactionFilter` SQL translator reused by an extended list endpoint and a new `/analytics` aggregation endpoint (all aggregates grouped by currency). The web app stores the filter set in the URL, exposes a search bar + collapsible filter panel, and renders charts through a shared `EChart` wrapper (ported verbatim from `feature/multicurrency-p0`). Clicking a chart segment drills into the filtered transaction list.

**Tech Stack:** Hono + node-postgres (backend), React 19 + React Router + TanStack Query + Tailwind v4 + Radix (web), ECharts (charts), Vitest (tests).

## Global Constraints

- No em dashes anywhere (chat, code, comments, commits, UI copy). Use hyphen, colon, comma, or two sentences.
- Descriptive variable names always. No single-letter or throwaway names for domain values, including loop/map/filter/reduce bindings. Only `i`/`j` counters and `a`/`b` comparator params are allowed.
- Backend tests mock `db.query` via the `resolveDb` injection (`createXRoute(() => db)`) and assert SQL fragments + params. No live Postgres in tests.
- `amount < 0` is spend, `amount > 0` is income. Aggregates are grouped by `currency`; sums never cross currencies. No FX conversion.
- Backend test/typecheck: `pnpm --filter backend test` and `pnpm --filter backend typecheck`. Web: `pnpm --filter web typecheck` and `pnpm --filter web build`; web unit tests via `pnpm --filter web test` (Vitest, added in Task 4).
- Commits are made by the executing subagent via `/commita` (or `commita --no-push`), never plain `git add && git commit`.
- amount is selected as `amount::float8 AS amount` so pg returns a JS number.

## File Structure

Backend:
- `apps/backend/src/db/transactionFilter.ts` (new): `buildTransactionFilter`, `resolveDateRange`, types.
- `apps/backend/src/db/queries.ts` (modify): `getTransactions` gains filters+pagination; add `getTransactionsCount`, `getAnalytics`.
- `apps/backend/src/routes/transactions.ts` (modify): list route reads query params; add `/api/transactions/analytics`.
- `apps/backend/test/transactionFilter.test.ts`, `apps/backend/test/analytics.test.ts` (new); `apps/backend/test/transactions.test.ts` (modify).

Web:
- `apps/web/src/lib/filterParams.ts` (new): pure serialize/parse of the filter set.
- `apps/web/src/hooks/useTransactionFilters.ts` (new): URL-bound wrapper over `filterParams`.
- `apps/web/src/types.ts` (modify): analytics + filter types.
- `apps/web/src/lib/api.ts` (modify): `transactionsApi.listFiltered`, `transactionsApi.analytics`.
- `apps/web/src/hooks/useTransactionsQuery.ts`, `apps/web/src/hooks/useTransactionAnalytics.ts` (new).
- `apps/web/src/components/filters/SearchBar.tsx`, `FilterPanel.tsx`, `FilterChips.tsx` (new).
- `apps/web/src/components/analytics/SummaryTiles.tsx`, `CurrencySwitcher.tsx`, `AnalyticsSection.tsx` (new).
- `apps/web/src/components/analytics/charts/CategoryPieChart.tsx`, `SpendingOverTimeChart.tsx`, `IncomeExpenseChart.tsx`, `TagBarChart.tsx`, `SpendCalendarHeatmap.tsx` (new).
- `apps/web/src/components/EChart.tsx` (new, ported verbatim from `feature/multicurrency-p0`, then extended with more echarts modules + an `onEvents` prop).
- `apps/web/src/lib/echartsTheme.ts` (new): shared color palette + base option helpers.
- `apps/web/src/pages/DashboardPage.tsx`, `TransactionsPage.tsx` (modify): render `AnalyticsSection`, wire filters.
- Web test setup: `apps/web/vitest.config.ts`, `apps/web/src/lib/filterParams.test.ts` (new).

---

## Task 1: Transaction filter SQL builder

**Files:**
- Create: `apps/backend/src/db/transactionFilter.ts`
- Test: `apps/backend/test/transactionFilter.test.ts`

**Interfaces:**
- Produces:
  - `interface TransactionFilter { q?: string; from?: string; to?: string; accountIds?: string[]; categoryIds?: string[]; tags?: string[]; tagMatch?: 'all' | 'any'; min?: number; max?: number; type?: 'all' | 'income' | 'expense' }`
  - `function buildTransactionFilter(filter: TransactionFilter, startIndex?: number): { clause: string; params: unknown[] }` — `clause` is either `''` or `WHERE ...`; `startIndex` (default 1) is the first `$n` placeholder number so callers can append their own params after.
  - `function resolveDateRange(range: string | undefined, from?: string, to?: string): { from?: string; to?: string }` — resolves preset keys (`this-month`, `last-3-months`, `this-year`, `all`) to ISO bounds; passes through explicit `from`/`to`. Uses a `now: Date` param defaulting to `new Date()` so tests can pin time: `resolveDateRange(range, from, to, now?)`.

- [ ] **Step 1: Write failing tests**

```typescript
// apps/backend/test/transactionFilter.test.ts
import { describe, it, expect } from 'vitest'
import { buildTransactionFilter, resolveDateRange } from '../src/db/transactionFilter.js'

describe('buildTransactionFilter', () => {
  it('returns empty clause when no filters set', () => {
    const { clause, params } = buildTransactionFilter({})
    expect(clause).toBe('')
    expect(params).toEqual([])
  })

  it('builds an ILIKE search on description with escaped wildcards', () => {
    const { clause, params } = buildTransactionFilter({ q: '50%_off' })
    expect(clause).toMatch(/description ILIKE/i)
    expect(params[0]).toBe('%50\\%\\_off%')
  })

  it('filters expense as amount < 0 and income as amount > 0', () => {
    expect(buildTransactionFilter({ type: 'expense' }).clause).toMatch(/amount < 0/)
    expect(buildTransactionFilter({ type: 'income' }).clause).toMatch(/amount > 0/)
    expect(buildTransactionFilter({ type: 'all' }).clause).toBe('')
  })

  it('uses ANY for tag match "any" and @> for "all"', () => {
    const anyMatch = buildTransactionFilter({ tags: ['food', 'trip'], tagMatch: 'any' })
    expect(anyMatch.clause).toMatch(/tags && \$1::text\[\]/)
    expect(anyMatch.params[0]).toEqual(['food', 'trip'])
    const allMatch = buildTransactionFilter({ tags: ['food'], tagMatch: 'all' })
    expect(allMatch.clause).toMatch(/tags @> \$1::text\[\]/)
  })

  it('filters accounts and categories with ANY($ids)', () => {
    const { clause, params } = buildTransactionFilter({ accountIds: ['a1'], categoryIds: ['c1', 'c2'] })
    expect(clause).toMatch(/account_id = ANY\(\$1\)/)
    expect(clause).toMatch(/category_id = ANY\(\$2\)/)
    expect(params).toEqual([['a1'], ['c1', 'c2']])
  })

  it('applies amount magnitude and date bounds', () => {
    const { clause, params } = buildTransactionFilter({
      min: 10, max: 100, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z',
    })
    expect(clause).toMatch(/abs\(amount\) >= \$1/)
    expect(clause).toMatch(/abs\(amount\) <= \$2/)
    expect(clause).toMatch(/created_at >= \$3/)
    expect(clause).toMatch(/created_at < \$4/)
    expect(params).toEqual([10, 100, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'])
  })

  it('honors a custom startIndex for placeholder numbering', () => {
    const { clause } = buildTransactionFilter({ q: 'coffee' }, 5)
    expect(clause).toMatch(/\$5/)
  })
})

describe('resolveDateRange', () => {
  const now = new Date('2026-07-12T12:00:00Z')
  it('resolves this-month to the month start with no upper bound', () => {
    expect(resolveDateRange('this-month', undefined, undefined, now).from).toBe('2026-07-01T00:00:00.000Z')
  })
  it('resolves last-3-months', () => {
    expect(resolveDateRange('last-3-months', undefined, undefined, now).from).toBe('2026-04-12T12:00:00.000Z')
  })
  it('resolves all to no bounds', () => {
    expect(resolveDateRange('all', undefined, undefined, now)).toEqual({})
  })
  it('passes through explicit from/to', () => {
    expect(resolveDateRange(undefined, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', now))
      .toEqual({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' })
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter backend test transactionFilter`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `transactionFilter.ts`**

```typescript
// apps/backend/src/db/transactionFilter.ts
export interface TransactionFilter {
  q?: string
  from?: string
  to?: string
  accountIds?: string[]
  categoryIds?: string[]
  tags?: string[]
  tagMatch?: 'all' | 'any'
  min?: number
  max?: number
  type?: 'all' | 'income' | 'expense'
}

// Escape LIKE metacharacters so a user's literal % or _ is not treated as a wildcard.
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export function buildTransactionFilter(
  filter: TransactionFilter,
  startIndex = 1,
): { clause: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  let placeholder = startIndex

  if (filter.q && filter.q.trim() !== '') {
    conditions.push(`description ILIKE $${placeholder}`)
    params.push(`%${escapeLike(filter.q.trim())}%`)
    placeholder += 1
  }
  if (filter.tags && filter.tags.length > 0) {
    const operator = filter.tagMatch === 'all' ? '@>' : '&&'
    conditions.push(`tags ${operator} $${placeholder}::text[]`)
    params.push(filter.tags)
    placeholder += 1
  }
  if (filter.accountIds && filter.accountIds.length > 0) {
    conditions.push(`account_id = ANY($${placeholder})`)
    params.push(filter.accountIds)
    placeholder += 1
  }
  if (filter.categoryIds && filter.categoryIds.length > 0) {
    conditions.push(`category_id = ANY($${placeholder})`)
    params.push(filter.categoryIds)
    placeholder += 1
  }
  if (filter.type === 'expense') conditions.push('amount < 0')
  if (filter.type === 'income') conditions.push('amount > 0')
  if (typeof filter.min === 'number') {
    conditions.push(`abs(amount) >= $${placeholder}`)
    params.push(filter.min)
    placeholder += 1
  }
  if (typeof filter.max === 'number') {
    conditions.push(`abs(amount) <= $${placeholder}`)
    params.push(filter.max)
    placeholder += 1
  }
  if (filter.from) {
    conditions.push(`created_at >= $${placeholder}`)
    params.push(filter.from)
    placeholder += 1
  }
  if (filter.to) {
    conditions.push(`created_at < $${placeholder}`)
    params.push(filter.to)
    placeholder += 1
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { clause, params }
}

const RANGE_PRESETS = new Set(['this-month', 'last-3-months', 'this-year', 'all'])

export function resolveDateRange(
  range: string | undefined,
  from?: string,
  to?: string,
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (!range || !RANGE_PRESETS.has(range)) {
    const resolved: { from?: string; to?: string } = {}
    if (from) resolved.from = from
    if (to) resolved.to = to
    return resolved
  }
  if (range === 'all') return {}
  if (range === 'this-month') {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { from: monthStart.toISOString() }
  }
  if (range === 'this-year') {
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    return { from: yearStart.toISOString() }
  }
  // last-3-months: rolling 3 months back from now.
  const threeMonthsAgo = new Date(now)
  threeMonthsAgo.setUTCMonth(threeMonthsAgo.getUTCMonth() - 3)
  return { from: threeMonthsAgo.toISOString() }
}
```

Note: the placeholder-ordering assertions in Step 1 assume filters are appended in the source order above (q, tags, accounts, categories, type, min, max, from, to). Keep that order.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter backend test transactionFilter`
Expected: PASS. Then `pnpm --filter backend typecheck`.

- [ ] **Step 5: Commit** via `/commita`.

---

## Task 2: Filtered + paginated transactions list endpoint

**Files:**
- Modify: `apps/backend/src/db/queries.ts` (`getTransactions`, add `getTransactionsCount`)
- Modify: `apps/backend/src/routes/transactions.ts` (list route)
- Modify: `apps/backend/test/transactions.test.ts`

**Interfaces:**
- Consumes: `buildTransactionFilter`, `resolveDateRange`, `TransactionFilter` from Task 1.
- Produces:
  - `getTransactions(db, filter: TransactionFilter, page: { limit: number; offset: number; sort?: string }): Promise<Transaction[]>`
  - `getTransactionsCount(db, filter: TransactionFilter): Promise<number>`
  - `GET /api/transactions?q&range&from&to&account&category&tag&tagMatch&min&max&type&limit&offset&sort` returns `{ items: Transaction[]; total: number; limit: number; offset: number }`.

- [ ] **Step 1: Write failing tests** (add to `transactions.test.ts`)

```typescript
it('GET /api/transactions applies filters and pagination', async () => {
  const db = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 't1', description: 'Coffee', amount: -5, currency: 'PEN', account_id: 'a1', category_id: 'c1', tags: [], created_at: 'x', updated_at: null }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }),
  }
  const route = createTransactionsRoute(() => db)
  const response = await route.request('/api/transactions?q=coffee&type=expense&limit=10&offset=0')
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.total).toBe(1)
  expect(body.items[0].id).toBe('t1')
  const listSql = db.query.mock.calls[0][0]
  expect(listSql).toMatch(/description ILIKE/i)
  expect(listSql).toMatch(/amount < 0/)
  expect(listSql).toMatch(/LIMIT/i)
})
```

Update any existing list test that expected a bare array to expect `body.items`.

- [ ] **Step 2: Run, verify fail.** `pnpm --filter backend test transactions`

- [ ] **Step 3: Implement.** Replace `getTransactions` and add count in `queries.ts`:

```typescript
import { buildTransactionFilter, type TransactionFilter } from './transactionFilter.js'

const TRANSACTION_COLUMNS =
  'id, description, amount::float8 AS amount, currency, account_id, category_id, tags, created_at, updated_at'

const SORT_COLUMNS: Record<string, string> = {
  'created_at desc': 'created_at DESC',
  'created_at asc': 'created_at ASC',
  'amount desc': 'amount DESC',
  'amount asc': 'amount ASC',
}

export async function getTransactions(
  db: Queryable,
  filter: TransactionFilter = {},
  page: { limit: number; offset: number; sort?: string } = { limit: 50, offset: 0 },
): Promise<Transaction[]> {
  const { clause, params } = buildTransactionFilter(filter)
  const orderBy = SORT_COLUMNS[page.sort ?? 'created_at desc'] ?? 'created_at DESC'
  const limitPlaceholder = params.length + 1
  const offsetPlaceholder = params.length + 2
  const result = await db.query(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions ${clause} ORDER BY ${orderBy} LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}`,
    [...params, page.limit, page.offset],
  )
  return result.rows as Transaction[]
}

export async function getTransactionsCount(db: Queryable, filter: TransactionFilter = {}): Promise<number> {
  const { clause, params } = buildTransactionFilter(filter)
  const result = await db.query(`SELECT count(*)::int AS count FROM transactions ${clause}`, params)
  return result.rows[0]?.count ?? 0
}
```

Add a query-param parser + updated list route in `transactions.ts`:

```typescript
import { resolveDateRange, type TransactionFilter } from '../db/transactionFilter.js'
import { getTransactionsCount } from '../db/queries.js'

function parseListQuery(context: Context): { filter: TransactionFilter; limit: number; offset: number; sort?: string } {
  const query = context.req.query()
  const many = (key: string) => context.req.queries(key) ?? []
  const dateRange = resolveDateRange(query.range, query.from, query.to)
  const filter: TransactionFilter = {
    q: query.q,
    from: dateRange.from,
    to: dateRange.to,
    accountIds: many('account'),
    categoryIds: many('category'),
    tags: many('tag'),
    tagMatch: query.tagMatch === 'all' ? 'all' : 'any',
    min: query.min ? Number(query.min) : undefined,
    max: query.max ? Number(query.max) : undefined,
    type: query.type === 'income' || query.type === 'expense' ? query.type : 'all',
  }
  return {
    filter,
    limit: Math.min(query.limit ? Number(query.limit) : 50, 200),
    offset: query.offset ? Number(query.offset) : 0,
    sort: query.sort,
  }
}
```

Rewrite the list handler to return `{ items, total, limit, offset }` using `getTransactions(db, filter, { limit, offset, sort })` and `getTransactionsCount(db, filter)`. Import `Context` type from `hono`. Empty `many(...)` arrays are fine (builder ignores empty arrays); pass them through.

- [ ] **Step 4: Run tests + typecheck, verify pass.** `pnpm --filter backend test` then `pnpm --filter backend typecheck`.

- [ ] **Step 5: Commit** via `/commita`.

---

## Task 3: Analytics aggregation endpoint

**Files:**
- Modify: `apps/backend/src/db/queries.ts` (add `getAnalytics`)
- Modify: `apps/backend/src/routes/transactions.ts` (add `/api/transactions/analytics`)
- Create: `apps/backend/test/analytics.test.ts`

**Interfaces:**
- Consumes: `buildTransactionFilter`, `resolveDateRange`, `parseListQuery` (filter portion) from Tasks 1-2.
- Produces:
  - `getAnalytics(db, filter, bucket: 'day' | 'week' | 'month'): Promise<AnalyticsPayload>` where
    `AnalyticsPayload = { summary: SummaryRow[]; series: SeriesRow[]; byCategory: CategoryRow[]; byTag: TagRow[] }`
    - `SummaryRow = { currency: string; income: number; spend: number; net: number; count: number }`
    - `SeriesRow = { bucketStart: string; currency: string; income: number; spend: number; net: number }`
    - `CategoryRow = { categoryId: string; currency: string; spend: number; income: number; net: number; count: number }`
    - `TagRow = { tag: string; currency: string; spend: number; count: number }`
  - `GET /api/transactions/analytics?<same filter params>&bucket=day|week|month` returns `AnalyticsPayload`.

- [ ] **Step 1: Write failing test** (`analytics.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createTransactionsRoute } from '../src/routes/transactions.js'

describe('analytics route', () => {
  it('GET /api/transactions/analytics returns grouped aggregates', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ currency: 'PEN', income: 100, spend: 40, net: 60, count: 3 }] })
        .mockResolvedValueOnce({ rows: [{ bucketStart: '2026-07-01T00:00:00.000Z', currency: 'PEN', income: 100, spend: 40, net: 60 }] })
        .mockResolvedValueOnce({ rows: [{ categoryId: 'c1', currency: 'PEN', spend: 40, income: 0, net: -40, count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ tag: 'coffee', currency: 'PEN', spend: 40, count: 2 }] }),
    }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/analytics?bucket=month&type=expense')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.summary[0].currency).toBe('PEN')
    expect(body.series[0].bucketStart).toBe('2026-07-01T00:00:00.000Z')
    expect(body.byCategory[0].categoryId).toBe('c1')
    expect(body.byTag[0].tag).toBe('coffee')
    expect(db.query.mock.calls[1][0]).toMatch(/date_trunc\('month'/)
  })

  it('defaults an invalid bucket to month', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createTransactionsRoute(() => db)
    await route.request('/api/transactions/analytics?bucket=nonsense')
    expect(db.query.mock.calls[1][0]).toMatch(/date_trunc\('month'/)
  })
})
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter backend test analytics`

- [ ] **Step 3: Implement `getAnalytics`** in `queries.ts`. The four queries share the same `WHERE` clause+params from `buildTransactionFilter(filter)`; `bucket` is validated to a whitelist before interpolation (never from raw input).

```typescript
const INCOME = 'sum(case when amount > 0 then amount else 0 end)::float8'
const SPEND = 'sum(case when amount < 0 then -amount else 0 end)::float8'

export async function getAnalytics(
  db: Queryable,
  filter: TransactionFilter,
  bucket: 'day' | 'week' | 'month',
): Promise<AnalyticsPayload> {
  const safeBucket = bucket === 'day' || bucket === 'week' ? bucket : 'month'
  const { clause, params } = buildTransactionFilter(filter)

  const summary = await db.query(
    `SELECT currency, ${INCOME} AS income, ${SPEND} AS spend, sum(amount)::float8 AS net, count(*)::int AS count
       FROM transactions ${clause} GROUP BY currency ORDER BY currency`,
    params,
  )
  const series = await db.query(
    `SELECT to_char(date_trunc('${safeBucket}', created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "bucketStart",
            currency, ${INCOME} AS income, ${SPEND} AS spend, sum(amount)::float8 AS net
       FROM transactions ${clause}
      GROUP BY 1, currency ORDER BY 1`,
    params,
  )
  const byCategory = await db.query(
    `SELECT category_id AS "categoryId", currency, ${SPEND} AS spend, ${INCOME} AS income,
            sum(amount)::float8 AS net, count(*)::int AS count
       FROM transactions ${clause} GROUP BY category_id, currency ORDER BY spend DESC`,
    params,
  )
  const byTag = await db.query(
    `SELECT tag, currency, ${SPEND} AS spend, count(*)::int AS count
       FROM (SELECT unnest(tags) AS tag, amount, currency FROM transactions ${clause}) tagged
      GROUP BY tag, currency ORDER BY spend DESC`,
    params,
  )
  return {
    summary: summary.rows,
    series: series.rows,
    byCategory: byCategory.rows,
    byTag: byTag.rows,
  }
}
```

Add the `AnalyticsPayload` and row types near the top of `queries.ts` (exported). Add the route in `transactions.ts`:

```typescript
route.get('/api/transactions/analytics', async (context) => {
  try {
    const { filter } = parseListQuery(context)
    const requestedBucket = context.req.query('bucket')
    const bucket = requestedBucket === 'day' || requestedBucket === 'week' ? requestedBucket : 'month'
    const analytics = await getAnalytics(resolveDb(), filter, bucket)
    return context.json(analytics)
  } catch (error) {
    console.error('Failed to compute analytics:', error)
    return context.json({ error: 'Failed to compute analytics' }, 500)
  }
})
```

Register this route BEFORE `GET /api/transactions/:id` so `/analytics` is not captured as an id.

- [ ] **Step 4: Run tests + typecheck.** `pnpm --filter backend test` then `pnpm --filter backend typecheck`.

- [ ] **Step 5: Commit** via `/commita`.

---

## Task 4: Web filter params + URL hook + Vitest setup

**Files:**
- Create: `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json` (add `test` script + vitest devDep)
- Create: `apps/web/src/lib/filterParams.ts`, `apps/web/src/lib/filterParams.test.ts`
- Create: `apps/web/src/hooks/useTransactionFilters.ts`

**Interfaces:**
- Produces:
  - `interface TransactionFilterState { q: string; range: string; from?: string; to?: string; accounts: string[]; categories: string[]; tags: string[]; tagMatch: 'all' | 'any'; min?: number; max?: number; type: 'all' | 'income' | 'expense'; currency?: string }`
  - `function parseFilterParams(searchParams: URLSearchParams): TransactionFilterState`
  - `function toSearchParams(state: TransactionFilterState): URLSearchParams`
  - `const EMPTY_FILTERS: TransactionFilterState` (range default `'this-month'`, tagMatch `'any'`, type `'all'`, arrays empty, q `''`)
  - `function useTransactionFilters(): { filters: TransactionFilterState; setFilters: (next: Partial<TransactionFilterState>) => void; resetFilters: () => void }` — reads/writes `useSearchParams`.

- [ ] **Step 1: Add Vitest.** In `apps/web/package.json` add `"test": "vitest run"` to scripts and `"vitest": "^2.1.0"`, `"jsdom": "^25.0.0"` to devDependencies. Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'jsdom', globals: true } })
```

Run `pnpm install` at the repo root.

- [ ] **Step 2: Write failing tests** (`filterParams.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { parseFilterParams, toSearchParams, EMPTY_FILTERS } from './filterParams'

describe('filterParams round-trip', () => {
  it('parses defaults from empty params', () => {
    const state = parseFilterParams(new URLSearchParams())
    expect(state.range).toBe('this-month')
    expect(state.type).toBe('all')
    expect(state.accounts).toEqual([])
  })

  it('round-trips a populated state', () => {
    const populated = { ...EMPTY_FILTERS, q: 'coffee', accounts: ['a1', 'a2'], tags: ['trip'], tagMatch: 'all' as const, min: 10, type: 'expense' as const }
    const reparsed = parseFilterParams(toSearchParams(populated))
    expect(reparsed.q).toBe('coffee')
    expect(reparsed.accounts).toEqual(['a1', 'a2'])
    expect(reparsed.tags).toEqual(['trip'])
    expect(reparsed.tagMatch).toBe('all')
    expect(reparsed.min).toBe(10)
    expect(reparsed.type).toBe('expense')
  })

  it('omits default-valued keys from the query string', () => {
    expect(toSearchParams(EMPTY_FILTERS).toString()).toBe('')
  })
})
```

- [ ] **Step 3: Run, verify fail.** `pnpm --filter web test filterParams`

- [ ] **Step 4: Implement `filterParams.ts`** (repeatable multi-values use repeated keys; drop keys equal to defaults so URLs stay clean):

```typescript
export interface TransactionFilterState {
  q: string
  range: string
  from?: string
  to?: string
  accounts: string[]
  categories: string[]
  tags: string[]
  tagMatch: 'all' | 'any'
  min?: number
  max?: number
  type: 'all' | 'income' | 'expense'
  currency?: string
}

export const EMPTY_FILTERS: TransactionFilterState = {
  q: '', range: 'this-month', accounts: [], categories: [], tags: [], tagMatch: 'any', type: 'all',
}

export function parseFilterParams(searchParams: URLSearchParams): TransactionFilterState {
  const number = (key: string) => (searchParams.has(key) ? Number(searchParams.get(key)) : undefined)
  const typeParam = searchParams.get('type')
  return {
    q: searchParams.get('q') ?? '',
    range: searchParams.get('range') ?? 'this-month',
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    accounts: searchParams.getAll('account'),
    categories: searchParams.getAll('category'),
    tags: searchParams.getAll('tag'),
    tagMatch: searchParams.get('tagMatch') === 'all' ? 'all' : 'any',
    min: number('min'),
    max: number('max'),
    type: typeParam === 'income' || typeParam === 'expense' ? typeParam : 'all',
    currency: searchParams.get('currency') ?? undefined,
  }
}

export function toSearchParams(state: TransactionFilterState): URLSearchParams {
  const searchParams = new URLSearchParams()
  if (state.q) searchParams.set('q', state.q)
  if (state.range && state.range !== 'this-month') searchParams.set('range', state.range)
  if (state.from) searchParams.set('from', state.from)
  if (state.to) searchParams.set('to', state.to)
  for (const accountId of state.accounts) searchParams.append('account', accountId)
  for (const categoryId of state.categories) searchParams.append('category', categoryId)
  for (const tag of state.tags) searchParams.append('tag', tag)
  if (state.tagMatch !== 'any') searchParams.set('tagMatch', state.tagMatch)
  if (typeof state.min === 'number') searchParams.set('min', String(state.min))
  if (typeof state.max === 'number') searchParams.set('max', String(state.max))
  if (state.type !== 'all') searchParams.set('type', state.type)
  if (state.currency) searchParams.set('currency', state.currency)
  return searchParams
}
```

Then `useTransactionFilters.ts`:

```typescript
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { parseFilterParams, toSearchParams, EMPTY_FILTERS, type TransactionFilterState } from '@/lib/filterParams'

export function useTransactionFilters() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseFilterParams(searchParams), [searchParams])
  const setFilters = useCallback(
    (next: Partial<TransactionFilterState>) => setSearchParams(toSearchParams({ ...filters, ...next })),
    [filters, setSearchParams],
  )
  const resetFilters = useCallback(() => setSearchParams(toSearchParams(EMPTY_FILTERS)), [setSearchParams])
  return { filters, setFilters, resetFilters }
}
```

- [ ] **Step 5: Run tests + typecheck.** `pnpm --filter web test` then `pnpm --filter web typecheck`.

- [ ] **Step 6: Commit** via `/commita`.

---

## Task 5: Web API client + data hooks + types

**Files:**
- Modify: `apps/web/src/types.ts` (analytics types)
- Modify: `apps/web/src/lib/api.ts` (`transactionsApi.listFiltered`, `transactionsApi.analytics`)
- Create: `apps/web/src/hooks/useTransactionsQuery.ts`, `apps/web/src/hooks/useTransactionAnalytics.ts`

**Interfaces:**
- Consumes: `TransactionFilterState`, `toSearchParams` (Task 4); backend endpoints (Tasks 2-3).
- Produces:
  - Types mirroring the backend: `TransactionListResponse { items: Transaction[]; total: number; limit: number; offset: number }`, `AnalyticsPayload`, `SummaryRow`, `SeriesRow`, `CategoryRow`, `TagRow` (copy the field names/types from Task 3 exactly).
  - `transactionsApi.listFiltered(state, page): Promise<TransactionListResponse>`
  - `transactionsApi.analytics(state, bucket): Promise<AnalyticsPayload>`
  - `useTransactionsQuery(state, page)` and `useTransactionAnalytics(state, bucket)` React Query hooks keyed on `['transactions', 'list', queryString]` / `['transactions', 'analytics', bucket, queryString]`.

- [ ] **Step 1:** Add the analytics/list types to `types.ts` copying Task 3 field names verbatim (`bucketStart`, `categoryId`, etc.).

- [ ] **Step 2:** Add to `api.ts` (reuse the existing `request` helper and `toSearchParams`):

```typescript
import { toSearchParams } from './filterParams'
import type { TransactionFilterState } from './filterParams'
import type { AnalyticsPayload, TransactionListResponse } from '@/types'

export const transactionsAnalyticsApi = {
  listFiltered(state: TransactionFilterState, page: { limit: number; offset: number; sort?: string }) {
    const params = toSearchParams(state)
    params.set('limit', String(page.limit))
    params.set('offset', String(page.offset))
    if (page.sort) params.set('sort', page.sort)
    return request<TransactionListResponse>(`/transactions?${params.toString()}`)
  },
  analytics(state: TransactionFilterState, bucket: 'day' | 'week' | 'month') {
    const params = toSearchParams(state)
    params.set('bucket', bucket)
    return request<AnalyticsPayload>(`/transactions/analytics?${params.toString()}`)
  },
}
```

(Keep the existing `transactionsApi` resource object for CRUD; add the two methods to it or export the new object and use it in the hooks. Choose one and be consistent.)

- [ ] **Step 3:** Create the two hooks with `useQuery`, `keepPreviousData` for smooth filtering:

```typescript
// useTransactionAnalytics.ts
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { transactionsAnalyticsApi } from '@/lib/api'
import { toSearchParams, type TransactionFilterState } from '@/lib/filterParams'

export function useTransactionAnalytics(filters: TransactionFilterState, bucket: 'day' | 'week' | 'month') {
  const queryString = toSearchParams(filters).toString()
  return useQuery({
    queryKey: ['transactions', 'analytics', bucket, queryString],
    queryFn: () => transactionsAnalyticsApi.analytics(filters, bucket),
    placeholderData: keepPreviousData,
  })
}
```

`useTransactionsQuery.ts` follows the same shape for the list.

- [ ] **Step 4:** `pnpm --filter web typecheck`. (No new unit test; covered by typecheck + later integration.)

- [ ] **Step 5: Commit** via `/commita`.

---

## Task 6: Search bar, filter panel, filter chips

**Files:**
- Create: `apps/web/src/components/filters/SearchBar.tsx`, `FilterPanel.tsx`, `FilterChips.tsx`

**Interfaces:**
- Consumes: `useTransactionFilters` (Task 4), `useAccounts`, `useCategories`, `useTags` (existing hooks), existing Radix UI primitives (`select`, `popover`, `calendar`, `input`, `button`, `date-time-picker`).
- Produces:
  - `<SearchBar />` - reads/writes `filters.q` with a 300ms debounce; a magnifier icon (`@tabler/icons-react`).
  - `<FilterPanel />` - collapsible (Radix or local `useState` open flag). Controls: range preset `Select` (This month / Last 3 months / This year / All time) with a custom from/to via the existing `date-time-picker`; account multi-select; category multi-select; tag multi-select + ALL/ANY toggle; amount min/max inputs; type segmented control (All / Income / Expense). A toggle button shows/hides the panel; hidden by default.
  - `<FilterChips />` - renders one removable chip per active non-default filter, plus a "Clear all" that calls `resetFilters()`. Always visible.

- [ ] **Step 1:** Build `SearchBar.tsx`. Debounce local input state; on debounce call `setFilters({ q })`. Use the existing `Input` and an `IconSearch`.

- [ ] **Step 2:** Build `FilterPanel.tsx` using existing primitives. Multi-selects can be a `Popover` containing checkboxes over the entity lists. Range `Select` writes `range`; choosing "Custom" reveals two `date-time-picker`s writing `from`/`to`. Type control writes `type`. Amount inputs write `min`/`max` (number or undefined when blank). Tag ALL/ANY writes `tagMatch`.

- [ ] **Step 3:** Build `FilterChips.tsx`. For each of q, range (when not default), each account/category/tag, min/max, type, render a chip with an `IconX` remove that calls `setFilters` removing just that value. "Clear all" -> `resetFilters()`.

- [ ] **Step 4:** `pnpm --filter web typecheck` and `pnpm --filter web build`.

- [ ] **Step 5: Commit** via `/commita`.

---

## Task 7: Summary tiles + currency switcher

**Files:**
- Create: `apps/web/src/components/analytics/SummaryTiles.tsx`, `CurrencySwitcher.tsx`

**Interfaces:**
- Consumes: `SummaryRow[]` from analytics; existing `Card`, `formatCurrency`.
- Produces:
  - `<CurrencySwitcher currencies={string[]} value={string} onChange={(currency: string) => void} />` - a `Select`; hidden when only one currency present.
  - `<SummaryTiles summary={SummaryRow[]} currency={string} />` - picks the row for `currency`, renders Income / Spend / Net / Count tiles with `formatCurrency`. Shows a zeroed state when the row is missing.

- [ ] **Step 1:** Build `CurrencySwitcher.tsx` (Radix `Select`).
- [ ] **Step 2:** Build `SummaryTiles.tsx` reusing the existing `Card` layout from `DashboardPage`.
- [ ] **Step 3:** `pnpm --filter web typecheck`.
- [ ] **Step 4: Commit** via `/commita`.

---

## Task 8: ECharts charts (on the shared EChart wrapper)

**Files:**
- Modify: `apps/web/package.json` (add `"echarts": "^6.1.0"`)
- Create: `apps/web/src/components/EChart.tsx` (ported from `feature/multicurrency-p0`, extended)
- Create: `apps/web/src/lib/echartsTheme.ts`
- Create: `apps/web/src/components/analytics/charts/CategoryPieChart.tsx`, `SpendingOverTimeChart.tsx`, `IncomeExpenseChart.tsx`, `TagBarChart.tsx`, `SpendCalendarHeatmap.tsx`

**Interfaces:**
- Consumes: `CategoryRow[]`, `SeriesRow[]`, `TagRow[]`, `SummaryRow[]` (filtered to the selected currency by the parent), category name map (`toNameById`).
- Produces:
  - `<EChart option onEvents? height />` shared wrapper (owns init / resize / dispose).
  - Five chart components. Each builds an ECharts `option` (via `useMemo`) and renders `<EChart option ... />`. Each takes already-currency-filtered rows plus an optional `onSelect` drill-down callback (`onSelect(categoryId)` / `onSelect(tag)` / `onSelect({ from, to })`), wired through `onEvents.click`.

- [ ] **Step 1:** Add `"echarts": "^6.1.0"` to `apps/web/package.json` deps, run `pnpm install` at the repo root.

- [ ] **Step 2:** Create `EChart.tsx`. Reproduce the wrapper verbatim, then (a) extend the module registration and (b) add an optional `onEvents` prop that binds handlers after init:

```typescript
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, PieChart, LineChart, HeatmapChart } from 'echarts/charts'
import {
  GridComponent, TitleComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, CalendarComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([
  BarChart, PieChart, LineChart, HeatmapChart,
  GridComponent, TitleComponent, TooltipComponent, LegendComponent,
  VisualMapComponent, CalendarComponent, CanvasRenderer,
])

type EChartClickHandler = (params: { data?: unknown; name?: string; value?: unknown }) => void

interface EChartProps {
  option: EChartsCoreOption
  height: number
  onEvents?: { click?: EChartClickHandler }
}

export function EChart({ option, height, onEvents }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.EChartsType | undefined>(undefined)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = echarts.init(container)
    chartRef.current = chart
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      chart.dispose()
      chartRef.current = undefined
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onEvents?.click) return
    const handler = onEvents.click
    chart.on('click', handler)
    return () => {
      chart.off('click', handler)
    }
  }, [onEvents])

  return <div ref={containerRef} style={{ height, width: '100%' }} />
}
```

- [ ] **Step 3:** Create `echartsTheme.ts` with a shared categorical palette (hex values matching the app's Tailwind palette; support light/dark by reading the `document.documentElement` class if the app toggles dark mode). Keep it small. Follow the dataviz skill's palette guidance when picking colors.

- [ ] **Step 4:** Build each chart as an option-builder that renders through `EChart`. Reference (`CategoryPieChart.tsx`):

```typescript
import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { palette } from '@/lib/echartsTheme'
import type { CategoryRow } from '@/types'

interface CategoryPieChartProps {
  rows: CategoryRow[]
  categoryNameById: Map<string, string>
  onSelect?: (categoryId: string) => void
}

export function CategoryPieChart({ rows, categoryNameById, onSelect }: CategoryPieChartProps) {
  const option = useMemo(
    () => ({
      color: palette,
      tooltip: { trigger: 'item' as const, formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie' as const,
          radius: ['45%', '70%'],
          data: rows
            .filter((categoryRow) => categoryRow.spend > 0)
            .map((categoryRow) => ({
              value: categoryRow.spend,
              name: categoryNameById.get(categoryRow.categoryId) ?? 'Uncategorized',
              categoryId: categoryRow.categoryId,
            })),
        },
      ],
    }),
    [rows, categoryNameById],
  )
  return (
    <EChart
      option={option}
      height={288}
      onEvents={{
        click: (params) => {
          const clicked = params.data as { categoryId?: string } | undefined
          if (onSelect && clicked?.categoryId) onSelect(clicked.categoryId)
        },
      }}
    />
  )
}
```

- [ ] **Step 5:** Build the other four the same way (each a `useMemo` option + `<EChart>`):
  - `SpendingOverTimeChart` - `type: 'bar'`, x = `bucketStart`, y = `spend`. Click emits `onSelect({ from: bucketStart, to: nextBucketStart })`.
  - `IncomeExpenseChart` - two bar series (income, spend) + a `line` series for net, shared x = `bucketStart`, with a legend.
  - `TagBarChart` - horizontal bars (`yAxis type: 'category'`), sorted by spend, click emits `onSelect(tag)`.
  - `SpendCalendarHeatmap` - `calendar` coordinate system + `heatmap` series over daily spend derived from `series` when `bucket === 'day'` (or aggregated client-side from day rows). `visualMap` from 0 to max daily spend.

- [ ] **Step 6:** `pnpm --filter web typecheck` and `pnpm --filter web build`.

- [ ] **Step 7: Commit** via `/commita`.

---

## Task 9: AnalyticsSection + page wiring

**Files:**
- Create: `apps/web/src/components/analytics/AnalyticsSection.tsx`
- Modify: `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/TransactionsPage.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `<AnalyticsSection bucket state />` - calls `useTransactionAnalytics`, picks the display currency (from `filters.currency` or the most-used currency in `summary`), renders `CurrencySwitcher` + `SummaryTiles` + a responsive grid of the five charts, all fed the currency-filtered rows. A day/week/month bucket toggle sets local `bucket` state. Chart `onSelect` calls `setFilters({...})` to drill down.
  - Dashboard renders `SearchBar` + `FilterChips` + `AnalyticsSection` + a short recent-transactions slice (reuse existing `TransactionListItem`).
  - Transactions page renders `SearchBar` + `FilterPanel` + `FilterChips` + `AnalyticsSection` above the existing day-grouped list, and switches the list to `useTransactionsQuery(filters, page)` with a "Load more" (offset += limit). Keep the existing day-grouping over `response.items`.

- [ ] **Step 1:** Build `AnalyticsSection.tsx`. Determine `displayCurrency = filters.currency ?? mostUsedCurrency(summary)`. Filter each aggregate array to that currency before passing to charts. Wire `onSelect` handlers to `setFilters`.

- [ ] **Step 2:** Wire `DashboardPage.tsx`: replace the client-side `summary`/`spendingByCategory` computation with `AnalyticsSection`; keep a compact recent list. Remove now-dead client-side aggregation code.

- [ ] **Step 3:** Wire `TransactionsPage.tsx`: add `SearchBar` + `FilterPanel` + `FilterChips` + `AnalyticsSection` above the list; move the list to `useTransactionsQuery`; add "Load more". Preserve create/edit/delete flows.

- [ ] **Step 4:** Full verification: `pnpm --filter backend test`, `pnpm --filter web test`, `pnpm typecheck`, `pnpm build`. Then run the app (`pnpm dev`) and confirm: searching filters the list and charts; toggling a filter updates both; clicking a pie slice drills into that category; currency switcher swaps aggregates.

- [ ] **Step 5: Commit** via `/commita`.

---

## Self-review notes

- Spec coverage: search (Task 1-2 ILIKE, Task 6 SearchBar), all filter dimensions (Task 1 builder, Task 6 panel), server-side aggregation grouped by currency (Task 3), URL-shared state across pages (Task 4, Task 9), five charts incl. pie + calendar surprise (Task 8), pagination (Task 2, Task 9), drill-down (Task 8 onSelect, Task 9 wiring), tests (Tasks 1-4). Covered.
- Type consistency: backend row field names (`bucketStart`, `categoryId`, `income`, `spend`, `net`, `count`, `tag`) are mirrored verbatim in the web types (Task 5) and consumed unchanged in Tasks 7-9.
- Currency correctness: every aggregate groups by currency; the UI shows one currency at a time. No cross-currency sums.
```
