# Multicurrency P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ('- [ ]') syntax for tracking.

**Goal:** Turn the single-list spend tracker into a real multicurrency money tracker: controlled currencies, PEN base with frozen per-transaction conversion, exchange rates with a daily fetch, transaction types with transfers, payee/notes/occurred_at, and full server-side filtering with cursor pagination, surfaced in the React web app.

**Architecture:** Schema-first: migration 002 adds currencies, settings, exchange_rates and widens transactions; a pure rate module converts at the occurred_at date and freezes base_amount at insert; a pure filter query-builder powers GET /api/transactions with totals and cursors; the AI ingestion pipeline normalizes currency, dedupes by Gmail message id, and converts at ingestion; the web app gets an infinite-scroll filtered register, a type-driven transaction form, and PEN-converted dashboard totals.

**Tech Stack:** Hono, PostgreSQL (pg), Zod, Vitest; React 19, TanStack Query 5 (useInfiniteQuery), react-router 8, Tailwind 4, ECharts 6; rates from the MMEX ExchangeRate-API mirror and exchangerate.host backfill.

## Global Constraints

- Base currency: PEN, single-row settings table, never fall back to rate = 1; a missing rate means base_amount is null and is surfaced, never guessed.
- Rate direction: rate = units of quote per 1 unit of base; storage is USD-based pairs, triangulate through USD.
- Every commit uses 'commita --no-push', never plain git commit.
- No em dashes anywhere, in code, comments, copy, or docs.
- Meaningful variable names, no single-letter domain bindings.
- Verification: pnpm -r typecheck && pnpm -r test must pass at the end of every task.
- Amounts: stored signed (expense and transfer source negative, income positive); API accepts positive amounts and derives sign from type.
- Android app is explicitly out of scope for P0.

---

Tasks 1-4 of the multicurrency implementation plan. Every task follows strict TDD: write the failing test, run it and watch it fail, write the minimal implementation, run it and watch it pass, commit with `commita --no-push`.

Conventions in this repo (verified against existing code, follow them exactly):

- Backend is ESM TypeScript: local imports always end in `.js` (`from '../db/pool.js'`).
- Routes are factories `createXRoute(resolveDb: () => Queryable = getPool): Hono` that register `/api/...` paths on a fresh `Hono` instance and are mounted in `src/app.ts` with `app.route('/', createXRoute())`.
- Query helpers live in `src/db/queries.ts`, take `db: Queryable` as first parameter, and cast `result.rows`.
- Numeric columns are selected as `amount::float8 AS amount` so node-postgres returns JS numbers. Date columns must be selected as `date::text AS date` so node-postgres returns `'YYYY-MM-DD'` strings instead of `Date` objects.
- Tests mock the db as `{ query: vi.fn() }` and drive routes with `route.request(path, init)`.
- Body validation uses zod schemas plus `parseJsonBody(context, schema)` from `src/routes/validation.ts`, returning 400 with `{ error }` on failure.
- Backend test command: `pnpm --filter backend test -- test/<file>.test.ts` (the `--` forwards the file argument to `vitest run`). Typecheck: `pnpm --filter backend typecheck`.
- Every commit step is exactly: run `commita --no-push` and confirm it created a commit. Never `git add` or `git commit` directly.

---

## Task 1: Migration 002_multicurrency.sql, multi-file migrate runner, types.ts update

Creates the `currencies`, `settings`, and `exchange_rates` tables, reshapes `transactions` for multicurrency and transfers, and updates the TypeScript row types. The migration is DDL, so verification is `pnpm --filter backend migrate` plus typecheck plus the existing suite staying green. No new unit test file: there is no query logic to mock in this task.

**Files:**

- Create: `apps/backend/migrations/002_multicurrency.sql`
- Modify: `apps/backend/scripts/migrate.ts` (run all migration files in order, tracked in a `schema_migrations` table)
- Modify: `apps/backend/src/db/types.ts`

**Interfaces:**

- Consumes: nothing from other tasks. Reads existing schema from `migrations/001_init.sql` (tables `accounts`, `categories`, `transactions`).
- Produces (consumed by Tasks 2-4 and by the transactions/pipeline tasks in other sections):
  - Tables: `currencies(code, name, symbol, decimal_places)`, `settings(id, base_currency_code, created_at, updated_at)`, `exchange_rates(base_code, quote_code, date, rate, source, created_at, updated_at)` with PK `(base_code, quote_code, date)`.
  - `transactions` gains `occurred_at`, `type`, `payee`, `notes`, `base_amount`, `rate_used`, `to_account_id`, `to_amount`, `external_id`; `category_id` becomes nullable; constraint `transactions_transfer_shape`.
  - Types in `src/db/types.ts`:
    - `interface Transaction { id: string; description: string; amount: number; currency: string; account_id: string; category_id: string | null; tags: string[]; type: 'expense' | 'income' | 'transfer'; payee: string | null; notes: string | null; occurred_at: string; base_amount: number | null; rate_used: number | null; to_account_id: string | null; to_amount: number | null; external_id: string | null; created_at: string; updated_at: string | null }`
    - `interface Currency { code: string; name: string; symbol: string; decimal_places: number }`
    - `interface Settings { id: number; base_currency_code: string }`
    - `interface ExchangeRate { base_code: string; quote_code: string; date: string; rate: number; source: 'exchangerate-api' | 'exchangerate-host' | 'manual' }`

**Why the migrate runner must change:** `scripts/migrate.ts` currently hardcodes `001_init.sql` and re-runs it every time. Re-running 001 after 002 would be destructive: 001 ends with `UPDATE transactions SET category_id = <Uncategorized> WHERE category_id IS NULL` followed by `SET NOT NULL`, which would assign a category to transfer rows (whose `category_id` is legitimately NULL after 002) and then violate `transactions_transfer_shape`, failing the whole run. The fix is a standard applied-migrations table: each file runs exactly once. 001 is idempotent, so databases where it already ran take one harmless re-run before being recorded.

**Steps:**

- [ ] **Step 1.1: Write the migration file.** Create `apps/backend/migrations/002_multicurrency.sql` with exactly this content. The seed block below lists 52 major currencies explicitly; the executing engineer must extend the same `VALUES` list with the remaining ISO 4217 active codes (about 180 total) in the identical `('CODE', 'Name', 'Symbol', decimal_places)` format before running the migration. Decimal places come from ISO 4217 minor units: 0 for JPY, KRW, CLP, VND, ISK, PYG, GNF, RWF, UGX, VUV, XAF, XOF, XPF, KMF, DJF, BIF; 3 for BHD, IQD, JOD, KWD, LYD, OMR, TND; 2 for everything else.

```sql
-- Idempotent multicurrency migration: currency catalog, base-currency
-- settings, exchange rates, and the multicurrency/transfer transaction shape.
-- Safe to run repeatedly against the same database (the migrate runner also
-- records applied files, so in practice it runs once).

-- 1. Currency catalog ------------------------------------------------------

CREATE TABLE IF NOT EXISTS currencies (
  code text PRIMARY KEY,
  name text NOT NULL,
  symbol text NOT NULL,
  decimal_places int NOT NULL DEFAULT 2
);

INSERT INTO currencies (code, name, symbol, decimal_places) VALUES
  ('PEN', 'Peruvian Sol', 'S/', 2),
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('JPY', 'Japanese Yen', '¥', 0),
  ('GBP', 'Pound Sterling', '£', 2),
  ('CLP', 'Chilean Peso', '$', 0),
  ('COP', 'Colombian Peso', '$', 2),
  ('BRL', 'Brazilian Real', 'R$', 2),
  ('ARS', 'Argentine Peso', '$', 2),
  ('MXN', 'Mexican Peso', '$', 2),
  ('BOB', 'Boliviano', 'Bs.', 2),
  ('UYU', 'Peso Uruguayo', '$U', 2),
  ('PYG', 'Guarani', '₲', 0),
  ('VES', 'Bolivar Soberano', 'Bs.S', 2),
  ('CAD', 'Canadian Dollar', 'CA$', 2),
  ('AUD', 'Australian Dollar', 'A$', 2),
  ('NZD', 'New Zealand Dollar', 'NZ$', 2),
  ('CHF', 'Swiss Franc', 'CHF', 2),
  ('CNY', 'Yuan Renminbi', '¥', 2),
  ('HKD', 'Hong Kong Dollar', 'HK$', 2),
  ('TWD', 'New Taiwan Dollar', 'NT$', 2),
  ('KRW', 'South Korean Won', '₩', 0),
  ('INR', 'Indian Rupee', '₹', 2),
  ('IDR', 'Rupiah', 'Rp', 2),
  ('MYR', 'Malaysian Ringgit', 'RM', 2),
  ('PHP', 'Philippine Peso', '₱', 2),
  ('SGD', 'Singapore Dollar', 'S$', 2),
  ('THB', 'Baht', '฿', 2),
  ('VND', 'Dong', '₫', 0),
  ('AED', 'UAE Dirham', 'AED', 2),
  ('SAR', 'Saudi Riyal', 'SAR', 2),
  ('ILS', 'New Israeli Sheqel', '₪', 2),
  ('TRY', 'Turkish Lira', '₺', 2),
  ('RUB', 'Russian Ruble', '₽', 2),
  ('ZAR', 'Rand', 'R', 2),
  ('EGP', 'Egyptian Pound', 'E£', 2),
  ('NGN', 'Naira', '₦', 2),
  ('KES', 'Kenyan Shilling', 'KSh', 2),
  ('MAD', 'Moroccan Dirham', 'MAD', 2),
  ('DKK', 'Danish Krone', 'kr', 2),
  ('NOK', 'Norwegian Krone', 'kr', 2),
  ('SEK', 'Swedish Krona', 'kr', 2),
  ('PLN', 'Zloty', 'zł', 2),
  ('CZK', 'Czech Koruna', 'Kč', 2),
  ('HUF', 'Forint', 'Ft', 2),
  ('RON', 'Romanian Leu', 'lei', 2),
  ('ISK', 'Iceland Krona', 'kr', 0),
  ('BHD', 'Bahraini Dinar', 'BD', 3),
  ('KWD', 'Kuwaiti Dinar', 'KD', 3),
  ('OMR', 'Rial Omani', 'OMR', 3),
  ('JOD', 'Jordanian Dinar', 'JD', 3),
  ('TND', 'Tunisian Dinar', 'DT', 3)
  -- ... the full ISO 4217 active currency list continues here in the same
  -- ('CODE', 'Name', 'Symbol', decimal_places) format, one row per active
  -- code, until all roughly 180 currencies are present.
ON CONFLICT (code) DO NOTHING;

-- 2. Single-row settings ----------------------------------------------------

CREATE TABLE IF NOT EXISTS settings (
  id int PRIMARY KEY CHECK (id = 1),
  base_currency_code text NOT NULL REFERENCES currencies(code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

INSERT INTO settings (id, base_currency_code) VALUES (1, 'PEN')
ON CONFLICT (id) DO NOTHING;

-- 3. Exchange rates ----------------------------------------------------------
-- Direction convention: rate = units of quote_code per 1 unit of base_code,
-- so 1 USD = 3.74 PEN is the row ('USD', 'PEN', date, 3.74).

CREATE TABLE IF NOT EXISTS exchange_rates (
  base_code text NOT NULL REFERENCES currencies(code),
  quote_code text NOT NULL REFERENCES currencies(code),
  date date NOT NULL,
  rate numeric(20, 10) NOT NULL CHECK (rate > 0),
  source text NOT NULL CHECK (source IN ('exchangerate-api', 'exchangerate-host', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  PRIMARY KEY (base_code, quote_code, date)
);

-- 4. Normalize legacy free-text currency values, absorb unknown codes into
--    the catalog, then add the FKs. The absorb step guarantees the FK adds
--    can never fail on legacy data.

UPDATE accounts SET currency = upper(trim(currency));
UPDATE transactions SET currency = upper(trim(currency));

INSERT INTO currencies (code, name, symbol, decimal_places)
SELECT DISTINCT legacy.currency, legacy.currency, legacy.currency, 2
FROM (
  SELECT currency FROM accounts
  UNION
  SELECT currency FROM transactions
) AS legacy
WHERE legacy.currency IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM currencies known WHERE known.code = legacy.currency);

DO $$
BEGIN
  ALTER TABLE accounts
    ADD CONSTRAINT accounts_currency_fkey
    FOREIGN KEY (currency) REFERENCES currencies(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT transactions_currency_fkey
    FOREIGN KEY (currency) REFERENCES currencies(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. New transaction columns --------------------------------------------------

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payee text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_amount numeric(14, 2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rate_used numeric(20, 10);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_account_id uuid REFERENCES accounts(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_amount numeric(14, 2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_id text;

DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT transactions_external_id_key UNIQUE (external_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6. Backfills, then NOT NULL and checks ---------------------------------------

UPDATE transactions SET occurred_at = created_at WHERE occurred_at IS NULL;
ALTER TABLE transactions ALTER COLUMN occurred_at SET NOT NULL;

UPDATE transactions
SET type = CASE WHEN amount < 0 THEN 'expense' ELSE 'income' END
WHERE type IS NULL;
ALTER TABLE transactions ALTER COLUMN type SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('expense', 'income', 'transfer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- category_id: required for expense/income, forbidden for transfers.
ALTER TABLE transactions ALTER COLUMN category_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT transactions_transfer_shape
    CHECK (
      (type = 'transfer' AND to_account_id IS NOT NULL AND to_amount IS NOT NULL AND category_id IS NULL)
      OR
      (type <> 'transfer' AND to_account_id IS NULL AND to_amount IS NULL AND category_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7. Indexes -------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at
  ON transactions (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account
  ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type
  ON transactions (type);
```

- [ ] **Step 1.2: Rewrite the migrate runner to apply all files once each.** Replace the full contents of `apps/backend/scripts/migrate.ts` with:

```ts
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exitCode = 1
    return
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const migrationsDirectory = join(scriptDirectory, '..', 'migrations')
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()

  const pool = new pg.Pool({ connectionString })
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    )

    for (const fileName of migrationFiles) {
      const alreadyApplied = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [fileName],
      )
      if (alreadyApplied.rows.length) {
        console.log(`Skipping ${fileName} (already applied)`)
        continue
      }
      const migrationSql = await readFile(join(migrationsDirectory, fileName), 'utf8')
      await pool.query(migrationSql)
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [fileName])
      console.log(`Applied migration ${fileName}`)
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

- [ ] **Step 1.3: Update the row types.** In `apps/backend/src/db/types.ts`, replace the existing `Transaction` interface and append the three new interfaces. Leave `NewTransaction`, `TransactionUpdate`, `Account`, `Category`, and the other existing interfaces untouched: the transactions route rewrite task owns changing the write-path types.

```ts
export interface Transaction {
  id: string
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string | null
  tags: string[]
  type: 'expense' | 'income' | 'transfer'
  payee: string | null
  notes: string | null
  occurred_at: string
  base_amount: number | null
  rate_used: number | null
  to_account_id: string | null
  to_amount: number | null
  external_id: string | null
  created_at: string
  updated_at: string | null
}

export interface Currency {
  code: string
  name: string
  symbol: string
  decimal_places: number
}

export interface Settings {
  id: number
  base_currency_code: string
}

export interface ExchangeRate {
  base_code: string
  quote_code: string
  date: string
  rate: number
  source: 'exchangerate-api' | 'exchangerate-host' | 'manual'
}
```

- [ ] **Step 1.4: Typecheck and run the existing suite.**
  - Run: `pnpm --filter backend typecheck` and expect a clean exit. If it reports errors about `category_id` possibly being null in existing route or query code, do not widen types back: fix the specific usage with a narrow null check, or if the error is inside `src/routes/transactions.ts` (which the transactions rewrite task replaces wholesale), note it and confirm with the plan controller before patching.
  - Run: `pnpm --filter backend test` and expect all existing tests to pass (they mock the db, so the schema change cannot break them).
- [ ] **Step 1.5: Apply the migration.** Run: `pnpm --filter backend migrate` (requires `DATABASE_URL`, loaded from `apps/backend/.env`, e.g. run it as `cd apps/backend && env $(grep -v '^#' .env | xargs) pnpm migrate` or export the variable first). Expected output: `Applied migration 001_init.sql` (or `Skipping` once recorded), then `Applied migration 002_multicurrency.sql`. Run it a second time and expect both files to report `Skipping ... (already applied)`. If the database is unreachable, record that the migration step is pending: do not silently skip it or claim the task complete without flagging it.
- [ ] **Step 1.6: Commit.** Run `commita --no-push` and confirm it created a commit.

---

## Task 2: Rate module src/currency/rates.ts

Pure conversion logic over the `exchange_rates` and `currencies` tables: identity, direct pair, inverse pair, USD triangulation, decimal-places rounding, base currency lookup. Fully unit-tested against a mocked db.

**Files:**

- Create: `apps/backend/test/rates.test.ts` (test first)
- Create: `apps/backend/src/currency/rates.ts`

**Interfaces:**

- Consumes:
  - `Queryable` from `src/db/pool.ts`: `{ query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }`
  - Task 1 tables `exchange_rates` (PK `(base_code, quote_code, date)`, rate = quote units per 1 base unit), `currencies.decimal_places`, `settings.base_currency_code`.
- Produces:
  - `export async function getRate(db: Queryable, fromCode: string, toCode: string, onDate: string): Promise<{ rate: number; source: string } | null>`
  - `export async function convertAmount(db: Queryable, amount: number, fromCode: string, toCode: string, onDate: string): Promise<{ convertedAmount: number; rateUsed: number } | null>`
  - `export async function getBaseCurrencyCode(db: Queryable): Promise<string>`
  - Source values returned by `getRate`: `'identity'` for same-code, the stored row's `source` for direct and inverse hits, `'triangulated'` for USD two-leg results.

**Lookup order inside `getRate` (tests depend on this exact call order):**

1. `fromCode === toCode` returns `{ rate: 1, source: 'identity' }` with zero queries.
2. Direct pair `(fromCode, toCode)` at the latest `date <= onDate`.
3. Inverse pair `(toCode, fromCode)`; result is `1 / rate`.
4. If neither code is `'USD'`: leg A = pair `(fromCode, 'USD')` (direct then inverse), leg B = pair `('USD', toCode)` (direct then inverse), result `legA.rate * legB.rate`.
5. Otherwise `null`. Never returns 1 across different codes.

**Steps:**

- [ ] **Step 2.1: Write the failing test.** Create `apps/backend/test/rates.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { getRate, convertAmount, getBaseCurrencyCode } from '../src/currency/rates.js'

function fakeDbSequence(rowSets: unknown[][]) {
  const query = vi.fn()
  for (const rows of rowSets) {
    query.mockResolvedValueOnce({ rows })
  }
  return { query }
}

describe('getRate', () => {
  it('returns identity for the same code without querying', async () => {
    const db = { query: vi.fn() }
    const lookup = await getRate(db, 'PEN', 'PEN', '2026-07-10')
    expect(lookup).toEqual({ rate: 1, source: 'identity' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns the direct pair at the latest date on or before onDate', async () => {
    const db = fakeDbSequence([[{ rate: 3.74, source: 'exchangerate-api' }]])
    const lookup = await getRate(db, 'USD', 'PEN', '2026-07-10')
    expect(lookup).toEqual({ rate: 3.74, source: 'exchangerate-api' })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/from exchange_rates/i)
    expect(sql).toMatch(/date <= \$3/i)
    expect(sql).toMatch(/order by date desc/i)
    expect(sql).toMatch(/limit 1/i)
    expect(params).toEqual(['USD', 'PEN', '2026-07-10'])
  })

  it('falls back to the inverse pair and returns 1/rate', async () => {
    const db = fakeDbSequence([
      [], // direct PEN -> USD misses
      [{ rate: 3.74, source: 'manual' }], // inverse USD -> PEN hits
    ])
    const lookup = await getRate(db, 'PEN', 'USD', '2026-07-10')
    expect(lookup?.rate).toBeCloseTo(1 / 3.74, 10)
    expect(lookup?.source).toBe('manual')
    expect(db.query.mock.calls[1][1]).toEqual(['USD', 'PEN', '2026-07-10'])
  })

  it('triangulates through USD when no direct or inverse pair exists', async () => {
    const db = fakeDbSequence([
      [], // direct PEN -> CLP
      [], // inverse CLP -> PEN
      [], // leg A direct PEN -> USD
      [{ rate: 3.74, source: 'exchangerate-api' }], // leg A inverse USD -> PEN
      [{ rate: 940, source: 'exchangerate-api' }], // leg B direct USD -> CLP
    ])
    const lookup = await getRate(db, 'PEN', 'CLP', '2026-07-10')
    expect(lookup?.rate).toBeCloseTo(940 / 3.74, 8)
    expect(lookup?.source).toBe('triangulated')
    expect(db.query).toHaveBeenCalledTimes(5)
  })

  it('returns null when nothing is stored, never a silent 1', async () => {
    const db = fakeDbSequence([[], [], [], [], [], []])
    const lookup = await getRate(db, 'PEN', 'CLP', '2026-07-10')
    expect(lookup).toBeNull()
  })

  it('does not triangulate when one side is USD', async () => {
    const db = fakeDbSequence([[], []])
    const lookup = await getRate(db, 'USD', 'PEN', '2026-07-10')
    expect(lookup).toBeNull()
    expect(db.query).toHaveBeenCalledTimes(2)
  })
})

describe('convertAmount', () => {
  it('rounds to the target currency decimal_places', async () => {
    const db = fakeDbSequence([
      [{ rate: 3.7412, source: 'exchangerate-api' }], // direct USD -> PEN
      [{ decimal_places: 2 }], // currencies lookup for PEN
    ])
    const conversion = await convertAmount(db, 20, 'USD', 'PEN', '2026-07-10')
    expect(conversion).toEqual({ convertedAmount: 74.82, rateUsed: 3.7412 })
    const [currencySql, currencyParams] = db.query.mock.calls[1]
    expect(currencySql).toMatch(/from currencies/i)
    expect(currencyParams).toEqual(['PEN'])
  })

  it('rounds to zero decimals for zero-decimal currencies', async () => {
    const db = fakeDbSequence([
      [{ rate: 155.123, source: 'exchangerate-api' }],
      [{ decimal_places: 0 }],
    ])
    const conversion = await convertAmount(db, 10, 'USD', 'JPY', '2026-07-10')
    expect(conversion).toEqual({ convertedAmount: 1551, rateUsed: 155.123 })
  })

  it('preserves the sign of negative amounts', async () => {
    const db = fakeDbSequence([
      [{ rate: 3.74, source: 'exchangerate-api' }],
      [{ decimal_places: 2 }],
    ])
    const conversion = await convertAmount(db, -20, 'USD', 'PEN', '2026-07-10')
    expect(conversion?.convertedAmount).toBeCloseTo(-74.8, 2)
  })

  it('defaults to 2 decimal places when the currency row is missing', async () => {
    const db = fakeDbSequence([
      [{ rate: 3.7412, source: 'exchangerate-api' }],
      [],
    ])
    const conversion = await convertAmount(db, 20, 'USD', 'PEN', '2026-07-10')
    expect(conversion?.convertedAmount).toBe(74.82)
  })

  it('returns null when no rate exists', async () => {
    const db = fakeDbSequence([[], [], [], [], [], []])
    const conversion = await convertAmount(db, 20, 'PEN', 'CLP', '2026-07-10')
    expect(conversion).toBeNull()
  })
})

describe('getBaseCurrencyCode', () => {
  it('reads the settings row', async () => {
    const db = fakeDbSequence([[{ base_currency_code: 'USD' }]])
    expect(await getBaseCurrencyCode(db)).toBe('USD')
    expect(db.query.mock.calls[0][0]).toMatch(/from settings/i)
  })

  it('defaults to PEN when the row is missing', async () => {
    const db = fakeDbSequence([[]])
    expect(await getBaseCurrencyCode(db)).toBe('PEN')
  })
})
```

- [ ] **Step 2.2: Run it and expect failure.** Run: `pnpm --filter backend test -- test/rates.test.ts`. Expected: the whole file errors with a module resolution failure such as `Failed to load url ../src/currency/rates.js` / `Cannot find module`, because `src/currency/rates.ts` does not exist yet.
- [ ] **Step 2.3: Implement the module.** Create `apps/backend/src/currency/rates.ts`:

```ts
import type { Queryable } from '../db/pool.js'

const PIVOT_CODE = 'USD'

const PAIR_LOOKUP_SQL = `SELECT rate::float8 AS rate, source
  FROM exchange_rates
 WHERE base_code = $1 AND quote_code = $2 AND date <= $3
 ORDER BY date DESC
 LIMIT 1`

// Latest stored rate for (baseCode -> quoteCode) on or before onDate, trying
// the direct row first and the inverse row (1/rate) second.
async function lookupPair(
  db: Queryable,
  baseCode: string,
  quoteCode: string,
  onDate: string,
): Promise<{ rate: number; source: string } | null> {
  const direct = await db.query(PAIR_LOOKUP_SQL, [baseCode, quoteCode, onDate])
  if (direct.rows.length) {
    return { rate: direct.rows[0].rate as number, source: direct.rows[0].source as string }
  }
  const inverse = await db.query(PAIR_LOOKUP_SQL, [quoteCode, baseCode, onDate])
  if (inverse.rows.length) {
    return { rate: 1 / (inverse.rows[0].rate as number), source: inverse.rows[0].source as string }
  }
  return null
}

export async function getRate(
  db: Queryable,
  fromCode: string,
  toCode: string,
  onDate: string,
): Promise<{ rate: number; source: string } | null> {
  if (fromCode === toCode) return { rate: 1, source: 'identity' }

  const pair = await lookupPair(db, fromCode, toCode, onDate)
  if (pair) return pair

  // Triangulate through USD: fromCode -> USD, then USD -> toCode. The daily
  // fetcher stores USD-based rows, so this covers any pair of known
  // currencies. Never fall back to 1 across different codes.
  if (fromCode === PIVOT_CODE || toCode === PIVOT_CODE) return null

  const fromLeg = await lookupPair(db, fromCode, PIVOT_CODE, onDate)
  if (!fromLeg) return null
  const toLeg = await lookupPair(db, PIVOT_CODE, toCode, onDate)
  if (!toLeg) return null
  return { rate: fromLeg.rate * toLeg.rate, source: 'triangulated' }
}

export async function convertAmount(
  db: Queryable,
  amount: number,
  fromCode: string,
  toCode: string,
  onDate: string,
): Promise<{ convertedAmount: number; rateUsed: number } | null> {
  const lookup = await getRate(db, fromCode, toCode, onDate)
  if (!lookup) return null

  const currencyResult = await db.query(
    'SELECT decimal_places FROM currencies WHERE code = $1',
    [toCode],
  )
  const decimalPlaces = currencyResult.rows.length
    ? (currencyResult.rows[0].decimal_places as number)
    : 2
  const roundingFactor = 10 ** decimalPlaces
  const convertedAmount = Math.round(amount * lookup.rate * roundingFactor) / roundingFactor
  return { convertedAmount, rateUsed: lookup.rate }
}

export async function getBaseCurrencyCode(db: Queryable): Promise<string> {
  const result = await db.query('SELECT base_currency_code FROM settings WHERE id = 1')
  return result.rows.length ? (result.rows[0].base_currency_code as string) : 'PEN'
}
```

- [ ] **Step 2.4: Run the tests and expect pass.** Run: `pnpm --filter backend test -- test/rates.test.ts`. Expected: 14 tests pass. Then run `pnpm --filter backend typecheck` and expect a clean exit.
- [ ] **Step 2.5: Commit.** Run `commita --no-push` and confirm it created a commit.

---

## Task 3: Rate fetching src/currency/fetchRates.ts and startup wiring

Daily USD-based rate ingestion from the keyless MMEX mirror, on-demand historical backfill from exchangerate.host guarded by an env key, and a startup loop wired into `src/index.ts` next to the existing Gmail poller. `fetch` is injected everywhere for testability.

**Files:**

- Create: `apps/backend/test/fetchRates.test.ts` (test first)
- Create: `apps/backend/src/currency/fetchRates.ts`
- Modify: `apps/backend/src/index.ts` (start the daily loop)
- Modify: `apps/backend/src/config/env.ts` (add optional `EXCHANGERATE_HOST_KEY`)

**Interfaces:**

- Consumes:
  - `Queryable` from `src/db/pool.ts`.
  - Task 1 tables `exchange_rates` and `currencies`; `ExchangeRate` type from `src/db/types.ts`.
  - Scheduling pattern from `src/gmail/poller.ts` `startPolling` (self-rescheduling `setTimeout` tick with a stop closure).
- Produces (consumed by the ingestion pipeline task in another section, which calls `backfillRate` before giving up on a conversion):
  - `export async function fetchDailyRates(db: Queryable, fetchImpl: typeof fetch = fetch): Promise<{ upserted: number }>`
  - `export async function backfillRate(db: Queryable, quoteCode: string, onDate: string, fetchImpl: typeof fetch = fetch): Promise<ExchangeRate | null>`
  - `export function startRateFetching(db: Queryable, intervalMs: number, fetchImpl?: typeof fetch): () => void`

**External API shapes:**

- Daily: `GET https://moneymanagerex.github.io/currency/data/latest_USD.json` returns `{ base: 'USD', date: 'YYYY-MM-DD', rates: { PEN: 3.74, EUR: 0.92, ... } }`.
- Historical: `GET https://api.exchangerate.host/historical?date={onDate}&source=USD&access_key={key}` returns `{ success: true, quotes: { USDPEN: 3.74, ... } }` (quotes keyed `USD` + quote code). The key comes from env `EXCHANGERATE_HOST_KEY`; when absent, `backfillRate` logs a warning once per process and returns null.
- Upserts never overwrite manual rows: `ON CONFLICT ... DO UPDATE ... WHERE exchange_rates.source <> 'manual'`, and the upsert `RETURNING` clause yields zero rows when the manual guard blocks the update, which is how `upserted` counts only real writes.

**Steps:**

- [ ] **Step 3.1: Write the failing test.** Create `apps/backend/test/fetchRates.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchDailyRates, backfillRate, startRateFetching } from '../src/currency/fetchRates.js'

function fakeResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload } as unknown as Response
}

const dailyPayload = {
  base: 'USD',
  date: '2026-07-10',
  rates: { PEN: 3.74, EUR: 0.92, USD: 1, XXX: 5.5 },
}

describe('fetchDailyRates', () => {
  it('upserts every known non-USD code and skips unknown codes', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ code: 'PEN' }, { code: 'EUR' }, { code: 'USD' }] })
        .mockResolvedValue({ rows: [{}] }),
    }
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(dailyPayload))

    const result = await fetchDailyRates(db, fetchImpl as unknown as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://moneymanagerex.github.io/currency/data/latest_USD.json',
    )
    // 1 currencies select + 2 upserts (PEN, EUR); USD and unknown XXX skipped.
    expect(db.query).toHaveBeenCalledTimes(3)
    const [penSql, penParams] = db.query.mock.calls[1]
    expect(penSql).toMatch(/insert into exchange_rates/i)
    expect(penSql).toMatch(/on conflict \(base_code, quote_code, date\) do update/i)
    expect(penParams).toEqual(['USD', 'PEN', '2026-07-10', 3.74, 'exchangerate-api'])
    expect(result).toEqual({ upserted: 2 })
  })

  it('never overwrites manual rows and does not count blocked upserts', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ code: 'PEN' }, { code: 'EUR' }] })
        .mockResolvedValueOnce({ rows: [{}] }) // PEN written
        .mockResolvedValueOnce({ rows: [] }), // EUR blocked by manual guard
    }
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(dailyPayload))

    const result = await fetchDailyRates(db, fetchImpl as unknown as typeof fetch)

    const [upsertSql] = db.query.mock.calls[1]
    expect(upsertSql).toMatch(/where exchange_rates\.source <> 'manual'/i)
    expect(result).toEqual({ upserted: 1 })
  })

  it('throws on a non-ok response', async () => {
    const db = { query: vi.fn() }
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 503))
    await expect(fetchDailyRates(db, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/503/)
    expect(db.query).not.toHaveBeenCalled()
  })
})

describe('backfillRate', () => {
  const originalKey = process.env.EXCHANGERATE_HOST_KEY

  beforeEach(() => {
    process.env.EXCHANGERATE_HOST_KEY = 'test-key'
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.EXCHANGERATE_HOST_KEY
    else process.env.EXCHANGERATE_HOST_KEY = originalKey
  })

  it('returns null without fetching when the key is absent', async () => {
    delete process.env.EXCHANGERATE_HOST_KEY
    const db = { query: vi.fn() }
    const fetchImpl = vi.fn()

    const stored = await backfillRate(db, 'PEN', '2026-01-15', fetchImpl as unknown as typeof fetch)

    expect(stored).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(db.query).not.toHaveBeenCalled()
  })

  it('fetches the historical quote and stores it as exchangerate-host', async () => {
    const storedRow = {
      base_code: 'USD',
      quote_code: 'PEN',
      date: '2026-01-15',
      rate: 3.7101,
      source: 'exchangerate-host',
    }
    const db = { query: vi.fn().mockResolvedValue({ rows: [storedRow] }) }
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ success: true, quotes: { USDPEN: 3.7101 } }))

    const stored = await backfillRate(db, 'PEN', '2026-01-15', fetchImpl as unknown as typeof fetch)

    const requestedUrl = fetchImpl.mock.calls[0][0] as string
    expect(requestedUrl).toContain('https://api.exchangerate.host/historical')
    expect(requestedUrl).toContain('date=2026-01-15')
    expect(requestedUrl).toContain('source=USD')
    expect(requestedUrl).toContain('access_key=test-key')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/insert into exchange_rates/i)
    expect(params).toEqual(['USD', 'PEN', '2026-01-15', 3.7101, 'exchangerate-host'])
    expect(stored).toEqual(storedRow)
  })

  it('returns null when the payload has no quote for the code', async () => {
    const db = { query: vi.fn() }
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ success: true, quotes: { USDEUR: 0.92 } }))

    const stored = await backfillRate(db, 'PEN', '2026-01-15', fetchImpl as unknown as typeof fetch)

    expect(stored).toBeNull()
    expect(db.query).not.toHaveBeenCalled()
  })
})

describe('startRateFetching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches once at startup and again after the interval, surviving failures', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [] }), // currencies select empty: zero upserts
    }
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down')) // startup tick fails, loop must survive
      .mockResolvedValue(fakeResponse(dailyPayload))

    const stop = startRateFetching(db, 24 * 60 * 60 * 1000, fetchImpl as unknown as typeof fetch)

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    stop()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3.2: Run it and expect failure.** Run: `pnpm --filter backend test -- test/fetchRates.test.ts`. Expected: module resolution failure (`Failed to load url ../src/currency/fetchRates.js` / `Cannot find module`) because the module does not exist yet.
- [ ] **Step 3.3: Implement the module.** Create `apps/backend/src/currency/fetchRates.ts`:

```ts
import type { Queryable } from '../db/pool.js'
import type { ExchangeRate } from '../db/types.js'

const DAILY_RATES_URL = 'https://moneymanagerex.github.io/currency/data/latest_USD.json'
const HISTORICAL_RATES_URL = 'https://api.exchangerate.host/historical'

// Manual rows always win: the guard makes DO UPDATE a no-op on them, and
// RETURNING then yields zero rows, which callers use to count real writes.
const UPSERT_RATE_SQL = `INSERT INTO exchange_rates (base_code, quote_code, date, rate, source)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (base_code, quote_code, date) DO UPDATE
  SET rate = EXCLUDED.rate, source = EXCLUDED.source, updated_at = now()
  WHERE exchange_rates.source <> 'manual'
RETURNING base_code, quote_code, date::text AS date, rate::float8 AS rate, source`

interface DailyRatesPayload {
  base: string
  date: string
  rates: Record<string, number>
}

export async function fetchDailyRates(
  db: Queryable,
  fetchImpl: typeof fetch = fetch,
): Promise<{ upserted: number }> {
  const response = await fetchImpl(DAILY_RATES_URL)
  if (!response.ok) {
    throw new Error(`Daily rates fetch failed: HTTP ${response.status}`)
  }
  const payload = (await response.json()) as DailyRatesPayload

  const knownCurrencies = await db.query('SELECT code FROM currencies')
  const knownCodes = new Set<string>(
    knownCurrencies.rows.map((currencyRow: { code: string }) => currencyRow.code),
  )

  let upserted = 0
  for (const [quoteCode, rate] of Object.entries(payload.rates)) {
    if (quoteCode === 'USD') continue
    if (!knownCodes.has(quoteCode)) continue
    if (!(rate > 0)) continue
    const result = await db.query(UPSERT_RATE_SQL, [
      'USD',
      quoteCode,
      payload.date,
      rate,
      'exchangerate-api',
    ])
    upserted += result.rows.length
  }
  return { upserted }
}

let warnedMissingKey = false

interface HistoricalRatesPayload {
  success: boolean
  quotes?: Record<string, number>
}

export async function backfillRate(
  db: Queryable,
  quoteCode: string,
  onDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeRate | null> {
  const accessKey = process.env.EXCHANGERATE_HOST_KEY
  if (!accessKey) {
    if (!warnedMissingKey) {
      console.warn('EXCHANGERATE_HOST_KEY is not set: historical rate backfill is disabled')
      warnedMissingKey = true
    }
    return null
  }

  const url = `${HISTORICAL_RATES_URL}?date=${encodeURIComponent(onDate)}&source=USD&access_key=${encodeURIComponent(accessKey)}`
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Historical rates fetch failed: HTTP ${response.status}`)
  }
  const payload = (await response.json()) as HistoricalRatesPayload
  const rate = payload.quotes?.[`USD${quoteCode}`]
  if (!payload.success || rate === undefined || !(rate > 0)) return null

  const result = await db.query(UPSERT_RATE_SQL, [
    'USD',
    quoteCode,
    onDate,
    rate,
    'exchangerate-host',
  ])
  return result.rows.length ? (result.rows[0] as ExchangeRate) : null
}

// Same self-rescheduling pattern as startPolling in src/gmail/poller.ts:
// run once at startup, then every intervalMs; failures are logged, never fatal.
export function startRateFetching(
  db: Queryable,
  intervalMs: number,
  fetchImpl: typeof fetch = fetch,
): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const { upserted } = await fetchDailyRates(db, fetchImpl)
      console.log(`Daily rates fetch upserted ${upserted} rows`)
    } catch (error) {
      console.error('Daily rates fetch failed:', error)
    }
    if (!stopped) setTimeout(tick, intervalMs)
  }
  setTimeout(tick, 0)
  return () => {
    stopped = true
  }
}
```

Note on `startRateFetching`: the first tick is scheduled with `setTimeout(tick, 0)` rather than called synchronously so the fake-timer test controls it deterministically; runtime behavior is identical (runs immediately after the current task).

- [ ] **Step 3.4: Run the tests and expect pass.** Run: `pnpm --filter backend test -- test/fetchRates.test.ts`. Expected: 8 tests pass.
- [ ] **Step 3.5: Add the optional env var.** In `apps/backend/src/config/env.ts`, add one line to the schema object, after `GMAIL_POLL_INTERVAL_MS`:

```ts
  EXCHANGERATE_HOST_KEY: z.string().optional(),
```

  This keeps `loadEnv()` passing when the key is absent (backfill degrades to null per the guard above).

- [ ] **Step 3.6: Wire the loop into startup.** Replace the full contents of `apps/backend/src/index.ts` with:

```ts
import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { loadEnv } from './config/env.js'
import { startRateFetching } from './currency/fetchRates.js'
import { getPool } from './db/pool.js'
import { ensureStateTable } from './db/queries.js'
import { createGmailClient } from './gmail/client.js'
import { startPolling } from './gmail/poller.js'
import { processEmail, defaultProcessDeps } from './pipeline/processEmail.js'

const RATE_FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000

const env = loadEnv()
const app = buildApp()
const db = getPool()

await ensureStateTable(db)

const gmail = createGmailClient()
startPolling(
  {
    gmail,
    db,
    onEmail: (email) =>
      processEmail(
        { subject: email.subject, text: email.text },
        { db, ...defaultProcessDeps },
      ).catch((error) => console.error('processEmail failed:', error)),
  },
  env.GMAIL_POLL_INTERVAL_MS,
)

startRateFetching(db, RATE_FETCH_INTERVAL_MS)

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`SpendTracker listening on :${info.port}`)
})
```

  Caution: another plan task (ingestion pipeline, separate section) also edits `index.ts` to pass the Gmail `messageId` through `onEmail`. If that task has already landed, do not paste this file wholesale; instead add only the `startRateFetching` import, the `RATE_FETCH_INTERVAL_MS` constant, and the `startRateFetching(db, RATE_FETCH_INTERVAL_MS)` call, keeping the existing `onEmail` wiring intact.

- [ ] **Step 3.7: Full verification.** Run: `pnpm --filter backend test` (whole suite green) and `pnpm --filter backend typecheck` (clean exit).
- [ ] **Step 3.8: Commit.** Run `commita --no-push` and confirm it created a commit.

---

## Task 4: currencies, settings, and rates routes plus mounting

Three small route factories following the exact `createAccountsRoute` pattern, backed by new query helpers in `src/db/queries.ts`, mounted in `src/app.ts`. TDD per route file.

**Files:**

- Create: `apps/backend/test/currencies.test.ts`, `apps/backend/test/settings.test.ts`, `apps/backend/test/ratesRoutes.test.ts` (tests first)
- Create: `apps/backend/src/routes/currencies.ts`, `apps/backend/src/routes/settings.ts`, `apps/backend/src/routes/rates.ts`
- Modify: `apps/backend/src/db/queries.ts` (append helpers), `apps/backend/src/app.ts` (mount)

**Interfaces:**

- Consumes:
  - Task 1 types `Currency`, `Settings`, `ExchangeRate` from `src/db/types.ts` and the three new tables.
  - `Queryable`/`getPool` from `src/db/pool.ts`, `parseJsonBody` from `src/routes/validation.ts`.
- Produces:
  - `export function createCurrenciesRoute(resolveDb: () => Queryable = getPool): Hono` serving `GET /api/currencies -> Currency[]` ordered by code.
  - `export function createSettingsRoute(resolveDb: () => Queryable = getPool): Hono` serving `GET /api/settings -> Settings` and `PUT /api/settings` body `{ base_currency_code: string }` (400 when the code is not in `currencies`) `-> Settings`.
  - `export function createRatesRoute(resolveDb: () => Queryable = getPool): Hono` serving `GET /api/rates?quote=PEN&from=2026-01-01&to=2026-07-11 -> ExchangeRate[]` (base USD implied, all params optional) and `PUT /api/rates` body `{ base_code, quote_code, date, rate }` upserting with source `'manual'` `-> ExchangeRate`.
  - Query helpers in `src/db/queries.ts`:
    - `export async function getCurrencies(db: Queryable): Promise<Currency[]>`
    - `export async function getSettings(db: Queryable): Promise<Settings>`
    - `export async function updateSettings(db: Queryable, baseCurrencyCode: string): Promise<Settings>`
    - `export async function currencyExists(db: Queryable, code: string): Promise<boolean>`
    - `export async function getExchangeRates(db: Queryable, filters: { quote?: string; from?: string; to?: string }): Promise<ExchangeRate[]>`
    - `export async function upsertManualRate(db: Queryable, manualRate: { base_code: string; quote_code: string; date: string; rate: number }): Promise<ExchangeRate>`
  - These routes (and `currencyExists`) are consumed by the web tasks (`useCurrencies()`, `useSettings()`) and by the transactions/pipeline tasks in other sections.

**Steps:**

- [ ] **Step 4.1: Write the failing currencies test.** Create `apps/backend/test/currencies.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createCurrenciesRoute } from '../src/routes/currencies.js'

const sampleCurrencies = [
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', decimal_places: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 },
]

describe('currencies route', () => {
  it('GET /api/currencies returns the list ordered by code', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: sampleCurrencies }) }
    const route = createCurrenciesRoute(() => db)
    const response = await route.request('/api/currencies')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveLength(2)
    expect(body[0].code).toBe('PEN')
    const [sql] = db.query.mock.calls[0]
    expect(sql).toMatch(/from currencies/i)
    expect(sql).toMatch(/order by code/i)
  })

  it('GET /api/currencies returns 500 on db failure', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('boom')) }
    const route = createCurrenciesRoute(() => db)
    const response = await route.request('/api/currencies')
    expect(response.status).toBe(500)
  })
})
```

- [ ] **Step 4.2: Run it and expect failure.** Run: `pnpm --filter backend test -- test/currencies.test.ts`. Expected: module resolution failure for `../src/routes/currencies.js`.
- [ ] **Step 4.3: Implement the currencies helper and route.** Append to `apps/backend/src/db/queries.ts` (and extend its `./types.js` import list with `Currency`, `Settings`, `ExchangeRate`):

```ts
export async function getCurrencies(db: Queryable): Promise<Currency[]> {
  const result = await db.query(
    'SELECT code, name, symbol, decimal_places FROM currencies ORDER BY code',
  )
  return result.rows as Currency[]
}
```

Create `apps/backend/src/routes/currencies.ts`:

```ts
import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { getCurrencies } from '../db/queries.js'

export function createCurrenciesRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/currencies', async (context) => {
    try {
      const currencies = await getCurrencies(resolveDb())
      return context.json(currencies)
    } catch (error) {
      console.error('Failed to list currencies:', error)
      return context.json({ error: 'Failed to list currencies' }, 500)
    }
  })

  return route
}
```

- [ ] **Step 4.4: Run it and expect pass.** Run: `pnpm --filter backend test -- test/currencies.test.ts`. Expected: 2 tests pass.
- [ ] **Step 4.5: Write the failing settings test.** Create `apps/backend/test/settings.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSettingsRoute } from '../src/routes/settings.js'

const sampleSettings = { id: 1, base_currency_code: 'PEN' }

describe('settings route', () => {
  it('GET /api/settings returns the single row', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleSettings] }) }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(sampleSettings)
    expect(db.query.mock.calls[0][0]).toMatch(/from settings/i)
  })

  it('GET /api/settings defaults to PEN when the row is missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 1, base_currency_code: 'PEN' })
  })

  it('PUT /api/settings returns 400 on invalid body', async () => {
    const db = { query: vi.fn() }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_currency_code: 123 }),
    })
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('PUT /api/settings returns 400 for an unknown currency code', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_currency_code: 'ZZZ' }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/unknown currency/i)
    // Only the existence check ran, no upsert.
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('PUT /api/settings upserts and returns the updated row', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ code: 'USD' }] }) // currencyExists
        .mockResolvedValueOnce({ rows: [{ id: 1, base_currency_code: 'USD' }] }), // upsert
    }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_currency_code: 'USD' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 1, base_currency_code: 'USD' })
    const [upsertSql, upsertParams] = db.query.mock.calls[1]
    expect(upsertSql).toMatch(/on conflict \(id\) do update/i)
    expect(upsertParams).toEqual(['USD'])
  })
})
```

- [ ] **Step 4.6: Run it and expect failure.** Run: `pnpm --filter backend test -- test/settings.test.ts`. Expected: module resolution failure for `../src/routes/settings.js`.
- [ ] **Step 4.7: Implement the settings helpers and route.** Append to `apps/backend/src/db/queries.ts`:

```ts
export async function getSettings(db: Queryable): Promise<Settings> {
  const result = await db.query('SELECT id, base_currency_code FROM settings WHERE id = 1')
  return result.rows.length ? (result.rows[0] as Settings) : { id: 1, base_currency_code: 'PEN' }
}

export async function updateSettings(
  db: Queryable,
  baseCurrencyCode: string,
): Promise<Settings> {
  const result = await db.query(
    `INSERT INTO settings (id, base_currency_code) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE
       SET base_currency_code = EXCLUDED.base_currency_code, updated_at = now()
     RETURNING id, base_currency_code`,
    [baseCurrencyCode],
  )
  return result.rows[0] as Settings
}

export async function currencyExists(db: Queryable, code: string): Promise<boolean> {
  const result = await db.query('SELECT code FROM currencies WHERE code = $1', [code])
  return result.rows.length > 0
}
```

Create `apps/backend/src/routes/settings.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { currencyExists, getSettings, updateSettings } from '../db/queries.js'
import { parseJsonBody } from './validation.js'

const settingsUpdateSchema = z.object({
  base_currency_code: z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO 4217 code'),
})

export function createSettingsRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/settings', async (context) => {
    try {
      const settings = await getSettings(resolveDb())
      return context.json(settings)
    } catch (error) {
      console.error('Failed to fetch settings:', error)
      return context.json({ error: 'Failed to fetch settings' }, 500)
    }
  })

  route.put('/api/settings', async (context) => {
    const parsed = await parseJsonBody(context, settingsUpdateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const db = resolveDb()
      const known = await currencyExists(db, parsed.data.base_currency_code)
      if (!known) {
        return context.json(
          { error: `Unknown currency code: ${parsed.data.base_currency_code}` },
          400,
        )
      }
      const settings = await updateSettings(db, parsed.data.base_currency_code)
      return context.json(settings)
    } catch (error) {
      console.error('Failed to update settings:', error)
      return context.json({ error: 'Failed to update settings' }, 500)
    }
  })

  return route
}
```

- [ ] **Step 4.8: Run it and expect pass.** Run: `pnpm --filter backend test -- test/settings.test.ts`. Expected: 5 tests pass.
- [ ] **Step 4.9: Write the failing rates route test.** Create `apps/backend/test/ratesRoutes.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createRatesRoute } from '../src/routes/rates.js'

const sampleRate = {
  base_code: 'USD',
  quote_code: 'PEN',
  date: '2026-07-10',
  rate: 3.74,
  source: 'exchangerate-api',
}

describe('rates route', () => {
  it('GET /api/rates lists USD-based rates', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleRate] }) }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates')
    expect(response.status).toBe(200)
    expect((await response.json())[0].quote_code).toBe('PEN')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/base_code = 'USD'/i)
    expect(sql).toMatch(/order by date desc/i)
    expect(params).toEqual([])
  })

  it('GET /api/rates applies quote, from, and to filters as params', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleRate] }) }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates?quote=PEN&from=2026-01-01&to=2026-07-11')
    expect(response.status).toBe(200)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/quote_code = \$1/i)
    expect(sql).toMatch(/date >= \$2/i)
    expect(sql).toMatch(/date <= \$3/i)
    expect(params).toEqual(['PEN', '2026-01-01', '2026-07-11'])
  })

  it('GET /api/rates returns 400 on a malformed date filter', async () => {
    const db = { query: vi.fn() }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates?from=not-a-date')
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('PUT /api/rates returns 400 on invalid body', async () => {
    const db = { query: vi.fn() }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_code: 'USD', quote_code: 'PEN', date: '2026-07-10', rate: -1 }),
    })
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('PUT /api/rates returns 400 for an unknown currency code', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } // currencyExists misses
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_code: 'USD', quote_code: 'ZZZ', date: '2026-07-10', rate: 3.74 }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/unknown currency/i)
  })

  it('PUT /api/rates upserts with source manual and returns the row', async () => {
    const manualRow = { ...sampleRate, source: 'manual' }
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ code: 'USD' }] }) // base_code exists
        .mockResolvedValueOnce({ rows: [{ code: 'PEN' }] }) // quote_code exists
        .mockResolvedValueOnce({ rows: [manualRow] }), // upsert
    }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_code: 'USD', quote_code: 'PEN', date: '2026-07-10', rate: 3.74 }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(manualRow)
    const [upsertSql, upsertParams] = db.query.mock.calls[2]
    expect(upsertSql).toMatch(/insert into exchange_rates/i)
    expect(upsertSql).toMatch(/'manual'/)
    expect(upsertParams).toEqual(['USD', 'PEN', '2026-07-10', 3.74])
  })
})
```

- [ ] **Step 4.10: Run it and expect failure.** Run: `pnpm --filter backend test -- test/ratesRoutes.test.ts`. Expected: module resolution failure for `../src/routes/rates.js`.
- [ ] **Step 4.11: Implement the rates helpers and route.** Append to `apps/backend/src/db/queries.ts`:

```ts
export async function getExchangeRates(
  db: Queryable,
  filters: { quote?: string; from?: string; to?: string },
): Promise<ExchangeRate[]> {
  const conditions = ["base_code = 'USD'"]
  const params: unknown[] = []
  if (filters.quote) {
    params.push(filters.quote)
    conditions.push(`quote_code = $${params.length}`)
  }
  if (filters.from) {
    params.push(filters.from)
    conditions.push(`date >= $${params.length}`)
  }
  if (filters.to) {
    params.push(filters.to)
    conditions.push(`date <= $${params.length}`)
  }
  const result = await db.query(
    `SELECT base_code, quote_code, date::text AS date, rate::float8 AS rate, source
       FROM exchange_rates
      WHERE ${conditions.join(' AND ')}
      ORDER BY date DESC, quote_code`,
    params,
  )
  return result.rows as ExchangeRate[]
}

export async function upsertManualRate(
  db: Queryable,
  manualRate: { base_code: string; quote_code: string; date: string; rate: number },
): Promise<ExchangeRate> {
  const result = await db.query(
    `INSERT INTO exchange_rates (base_code, quote_code, date, rate, source)
     VALUES ($1, $2, $3, $4, 'manual')
     ON CONFLICT (base_code, quote_code, date) DO UPDATE
       SET rate = EXCLUDED.rate, source = 'manual', updated_at = now()
     RETURNING base_code, quote_code, date::text AS date, rate::float8 AS rate, source`,
    [manualRate.base_code, manualRate.quote_code, manualRate.date, manualRate.rate],
  )
  return result.rows[0] as ExchangeRate
}
```

Create `apps/backend/src/routes/rates.ts`:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { currencyExists, getExchangeRates, upsertManualRate } from '../db/queries.js'
import { parseJsonBody } from './validation.js'

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const currencyCodePattern = /^[A-Z]{3}$/

const rateQuerySchema = z.object({
  quote: z.string().regex(currencyCodePattern).optional(),
  from: z.string().regex(isoDatePattern).optional(),
  to: z.string().regex(isoDatePattern).optional(),
})

const manualRateSchema = z.object({
  base_code: z.string().regex(currencyCodePattern, 'must be a 3-letter ISO 4217 code'),
  quote_code: z.string().regex(currencyCodePattern, 'must be a 3-letter ISO 4217 code'),
  date: z.string().regex(isoDatePattern, 'must be YYYY-MM-DD'),
  rate: z.number().positive(),
})

export function createRatesRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/rates', async (context) => {
    const parsedQuery = rateQuerySchema.safeParse({
      quote: context.req.query('quote'),
      from: context.req.query('from'),
      to: context.req.query('to'),
    })
    if (!parsedQuery.success) {
      return context.json(
        { error: 'Invalid query: quote must be a 3-letter code, from/to must be YYYY-MM-DD' },
        400,
      )
    }
    try {
      const rates = await getExchangeRates(resolveDb(), parsedQuery.data)
      return context.json(rates)
    } catch (error) {
      console.error('Failed to list rates:', error)
      return context.json({ error: 'Failed to list rates' }, 500)
    }
  })

  route.put('/api/rates', async (context) => {
    const parsed = await parseJsonBody(context, manualRateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const db = resolveDb()
      for (const code of [parsed.data.base_code, parsed.data.quote_code]) {
        const known = await currencyExists(db, code)
        if (!known) {
          return context.json({ error: `Unknown currency code: ${code}` }, 400)
        }
      }
      const storedRate = await upsertManualRate(db, parsed.data)
      return context.json(storedRate)
    } catch (error) {
      console.error('Failed to upsert rate:', error)
      return context.json({ error: 'Failed to upsert rate' }, 500)
    }
  })

  return route
}
```

- [ ] **Step 4.12: Run it and expect pass.** Run: `pnpm --filter backend test -- test/ratesRoutes.test.ts`. Expected: 6 tests pass.
- [ ] **Step 4.13: Mount the routes.** In `apps/backend/src/app.ts`, add the three imports and mounts. Full updated file:

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { healthRoute } from './routes/health.js'
import { oauthRoute } from './routes/oauth.js'
import { telegramRoute } from './telegram/webhook.js'
import { createTransactionsRoute } from './routes/transactions.js'
import { createAccountsRoute } from './routes/accounts.js'
import { createCategoriesRoute } from './routes/categories.js'
import { createTagsRoute } from './routes/tags.js'
import { createCurrenciesRoute } from './routes/currencies.js'
import { createSettingsRoute } from './routes/settings.js'
import { createRatesRoute } from './routes/rates.js'

export function buildApp(): Hono {
  const app = new Hono()

  const webOrigin = process.env.WEB_ORIGIN
  app.use(
    '/api/*',
    cors({
      origin: webOrigin ?? '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  )

  app.route('/', healthRoute)
  app.route('/', oauthRoute)
  app.route('/', telegramRoute)
  app.route('/', createTransactionsRoute())
  app.route('/', createAccountsRoute())
  app.route('/', createCategoriesRoute())
  app.route('/', createTagsRoute())
  app.route('/', createCurrenciesRoute())
  app.route('/', createSettingsRoute())
  app.route('/', createRatesRoute())
  return app
}
```

  Note the CORS `allowMethods` list gains `'PUT'`: without it the browser preflight for `PUT /api/settings` and `PUT /api/rates` fails.

- [ ] **Step 4.14: Full verification.** Run: `pnpm --filter backend test` (whole suite green, including the pre-existing tests) and `pnpm --filter backend typecheck` (clean exit).
- [ ] **Step 4.15: Commit.** Run `commita --no-push` and confirm it created a commit.

This section assumes Tasks 1 to 4 (section A) are done and delivered:

- Migration `apps/backend/migrations/002_multicurrency.sql` applied (new transaction columns, `currencies`, `settings`, `exchange_rates`).
- `apps/backend/src/db/types.ts` already exports the new `Transaction`, `Currency`, `Settings`, and `ExchangeRate` interfaces per the architecture contract. Section B only touches `NewTransaction` and `TransactionUpdate` there.
- `apps/backend/src/currency/rates.ts` exports:
  - `getRate(db: Queryable, fromCode: string, toCode: string, onDate: string): Promise<{ rate: number; source: string } | null>`
  - `convertAmount(db: Queryable, amount: number, fromCode: string, toCode: string, onDate: string): Promise<{ convertedAmount: number; rateUsed: number } | null>`
  - `getBaseCurrencyCode(db: Queryable): Promise<string>`
- `apps/backend/src/currency/fetchRates.ts` exports:
  - `fetchDailyRates(db: Queryable, fetchImpl?: typeof fetch): Promise<{ upserted: number }>`
  - `backfillRate(db: Queryable, quoteCode: string, onDate: string, fetchImpl?: typeof fetch): Promise<ExchangeRate | null>`

All backend tests mock the db as `{ query: vi.fn() }` following the existing files in `apps/backend/test/`. All commands run from the repo root `/home/misaelabanto/code/openlinks/spend-tracker`.

---

## Task 5: Transactions POST/PATCH upgrade (types, sign derivation, validations, base_amount)

One coherent deliverable: the write path of the transactions API speaks the new transaction shape. Three TDD cycles: (5A) queries and types, (5B) uuid helper, (5C) route rewrite. One commit at the end (intermediate steps run only the targeted test file; the full typecheck is only guaranteed green at the end of the task, because the queries change and the route rewrite land in the same commit).

**Files:**
- Modify: `apps/backend/src/db/types.ts` (replace `NewTransaction`, `TransactionUpdate`)
- Modify: `apps/backend/src/db/queries.ts` (export `transactionColumns`; rewrite `getTransactions`, `getTransactionById`, `insertTransaction`, `updateTransaction`)
- Modify: `apps/backend/src/routes/validation.ts` (add `isUuid`)
- Modify: `apps/backend/src/routes/transactions.ts` (new schemas, POST, PATCH)
- Modify: `apps/backend/src/pipeline/processEmail.ts` (adapt the `insertTransaction` call to the new shape; full pipeline upgrade is Task 7)
- Modify: `apps/backend/src/telegram/webhook.ts` (adapt the `updateTransaction` call to the new shape)
- Tests: `apps/backend/test/queries.test.ts`, `apps/backend/test/validation.test.ts` (new), `apps/backend/test/transactions.test.ts` (rewrite)

**Interfaces:**
- Consumes (section A):
  - `convertAmount(db, amount, fromCode, toCode, onDate): Promise<{ convertedAmount: number; rateUsed: number } | null>` from `src/currency/rates.ts`
  - `getBaseCurrencyCode(db): Promise<string>` from `src/currency/rates.ts`
  - `Transaction` row type from `src/db/types.ts`
- Produces:
  - `isUuid(value: string): boolean` from `src/routes/validation.ts`
  - `transactionColumns: string` from `src/db/queries.ts` (SELECT column list, reused by Task 6)
  - `insertTransaction(db: Queryable, transaction: NewTransaction): Promise<{ id: string }>` with the new 15-field `NewTransaction`
  - `updateTransaction(db: Queryable, update: TransactionUpdate): Promise<void>` with the new 16-field `TransactionUpdate`
  - `POST /api/transactions` and `PATCH /api/transactions/:id` per the architecture contract

### Steps

- [ ] **5.1 (RED, cycle A) Update the transaction query tests.** In `apps/backend/test/queries.test.ts`, replace the `insertTransaction passes params and returns id` test and the `getTransactions selects ordered rows` test, and add an `updateTransaction` test, so the transaction-related tests read:

```ts
  it('insertTransaction passes params and returns id', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'tx1' }] }) }
    const result = await insertTransaction(db, {
      description: 'PLIN',
      amount: -35,
      currency: 'PEN',
      account_id: 'a1',
      category_id: 'c1',
      tags: ['food', 'plin', 'transfer'],
      type: 'expense',
      payee: 'Marisela Calle',
      notes: null,
      occurred_at: '2026-06-29T20:55:00.000Z',
      base_amount: -35,
      rate_used: 1,
      to_account_id: null,
      to_amount: null,
      external_id: 'gmail-123',
    })
    expect(result.id).toBe('tx1')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/insert into transactions/i)
    expect(params).toEqual([
      'PLIN', -35, 'PEN', 'a1', 'c1', ['food', 'plin', 'transfer'],
      'expense', 'Marisela Calle', null, '2026-06-29T20:55:00.000Z',
      -35, 1, null, null, 'gmail-123',
    ])
  })

  it('updateTransaction writes every column and bumps updated_at', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await updateTransaction(db, {
      id: 'tx1',
      description: 'PLIN',
      amount: -35,
      currency: 'PEN',
      account_id: 'a1',
      category_id: 'c1',
      tags: ['food'],
      type: 'expense',
      payee: null,
      notes: null,
      occurred_at: '2026-06-29T20:55:00.000Z',
      base_amount: -35,
      rate_used: 1,
      to_account_id: null,
      to_amount: null,
      external_id: null,
    })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/update transactions/i)
    expect(sql).toMatch(/updated_at = now\(\)/i)
    expect(params).toHaveLength(16)
    expect(params[0]).toBe('tx1')
  })

  it('getTransactions selects the full row ordered by occurred_at', async () => {
    const db = fakeDb([{ id: 'tx1' }, { id: 'tx2' }])
    const transactions = await getTransactions(db)
    expect(transactions).toHaveLength(2)
    expect(db.query.mock.calls[0][0]).toMatch(/from transactions/i)
    expect(db.query.mock.calls[0][0]).toMatch(/order by occurred_at desc, id desc/i)
    expect(db.query.mock.calls[0][0]).toMatch(/payee/)
    expect(db.query.mock.calls[0][0]).toMatch(/base_amount/)
    expect(db.query.mock.calls[0][0]).toMatch(/external_id/)
  })
```

Also add `updateTransaction` to the import list at the top of the file.

- [ ] **5.2 Run and expect failure:** `pnpm --filter backend test -- test/queries.test.ts`
  Expected: 3 failures. `insertTransaction` fails with an array mismatch (7 params vs the expected 15, `AssertionError: expected [ 'PLIN', -35, ... ] to deeply equal [ ... ]`), `updateTransaction` fails with `expected 8 to be 16` on the params length (the old update passes 8 params), and `getTransactions` fails on `expected 'SELECT id, description, ...' to match /order by occurred_at desc, id desc/i`.

- [ ] **5.3 (GREEN, cycle A) Implement the new types and queries.** In `apps/backend/src/db/types.ts`, replace `NewTransaction` and `TransactionUpdate` with:

```ts
export type TransactionType = 'expense' | 'income' | 'transfer'

export interface NewTransaction {
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string | null
  tags: string[]
  type: TransactionType
  payee: string | null
  notes: string | null
  occurred_at: string
  base_amount: number | null
  rate_used: number | null
  to_account_id: string | null
  to_amount: number | null
  external_id: string | null
}

export interface TransactionUpdate extends NewTransaction {
  id: string
}
```

(If Task 1 already defined `TransactionType`, reuse it instead of redeclaring.)

In `apps/backend/src/db/queries.ts`, replace the four transaction functions with:

```ts
// Shared SELECT list. ::float8 casts because node-postgres returns NUMERIC as
// a string by default; scoping the cast to these columns avoids a
// process-global type parser.
export const transactionColumns = `id, description, amount::float8 AS amount, currency, account_id,
       category_id, tags, type, payee, notes, occurred_at,
       base_amount::float8 AS base_amount, rate_used::float8 AS rate_used,
       to_account_id, to_amount::float8 AS to_amount, external_id, created_at, updated_at`

export async function getTransactions(db: Queryable): Promise<Transaction[]> {
  const result = await db.query(
    `SELECT ${transactionColumns}
       FROM transactions
      ORDER BY occurred_at DESC, id DESC`,
  )
  return result.rows as Transaction[]
}

export async function getTransactionById(db: Queryable, id: string): Promise<Transaction | null> {
  const result = await db.query(
    `SELECT ${transactionColumns}
       FROM transactions
      WHERE id = $1`,
    [id],
  )
  return result.rows.length ? (result.rows[0] as Transaction) : null
}

export async function insertTransaction(
  db: Queryable,
  transaction: NewTransaction,
): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO transactions
       (description, amount, currency, account_id, category_id, tags,
        type, payee, notes, occurred_at, base_amount, rate_used,
        to_account_id, to_amount, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      transaction.description,
      transaction.amount,
      transaction.currency,
      transaction.account_id,
      transaction.category_id,
      transaction.tags,
      transaction.type,
      transaction.payee,
      transaction.notes,
      transaction.occurred_at,
      transaction.base_amount,
      transaction.rate_used,
      transaction.to_account_id,
      transaction.to_amount,
      transaction.external_id,
    ],
  )
  return { id: result.rows[0].id as string }
}

export async function updateTransaction(db: Queryable, update: TransactionUpdate): Promise<void> {
  await db.query(
    `UPDATE transactions
       SET description = $2, amount = $3, currency = $4, account_id = $5,
           category_id = $6, tags = $7, type = $8, payee = $9, notes = $10,
           occurred_at = $11, base_amount = $12, rate_used = $13,
           to_account_id = $14, to_amount = $15, external_id = $16,
           updated_at = now()
     WHERE id = $1`,
    [
      update.id,
      update.description,
      update.amount,
      update.currency,
      update.account_id,
      update.category_id,
      update.tags,
      update.type,
      update.payee,
      update.notes,
      update.occurred_at,
      update.base_amount,
      update.rate_used,
      update.to_account_id,
      update.to_amount,
      update.external_id,
    ],
  )
}
```

`created_at` is no longer passed on insert: the column keeps its `DEFAULT now()` and is pure insert metadata from here on.

Two callers must be adapted in the same step so the codebase still compiles. In `apps/backend/src/pipeline/processEmail.ts`, replace the `insertTransaction` call (lines around 49) with this interim shim (Task 7 replaces it with the real pipeline upgrade):

```ts
  const { id } = await insertTransaction(deps.db, {
    description: extracted.description,
    amount: extracted.amount,
    currency: extracted.currency,
    account_id: extracted.account_id,
    category_id: extracted.category_id,
    tags: extracted.tags,
    type: extracted.amount < 0 ? 'expense' : 'income',
    payee: null,
    notes: null,
    occurred_at: extracted.created_at,
    base_amount: null,
    rate_used: null,
    to_account_id: null,
    to_amount: null,
    external_id: null,
  })
```

In `apps/backend/src/telegram/webhook.ts`, replace the `updateTransaction` call with:

```ts
  await updateTransaction(deps.db, {
    id: transactionId,
    description: edit.description,
    amount: existing.amount,
    currency: existing.currency,
    account_id: existing.account_id,
    category_id: classified.category_id,
    tags: finalTags,
    type: existing.type,
    payee: existing.payee,
    notes: existing.notes,
    occurred_at: existing.occurred_at,
    base_amount: existing.base_amount,
    rate_used: existing.rate_used,
    to_account_id: existing.to_account_id,
    to_amount: existing.to_amount,
    external_id: existing.external_id,
  })
```

- [ ] **5.4 Run and expect pass:** `pnpm --filter backend test -- test/queries.test.ts` (all green). Also run `pnpm --filter backend test -- test/processEmail.test.ts test/telegram-webhook.test.ts` and expect green (both test files assert SQL by regex and specific params positions that survive this change).

- [ ] **5.5 (RED, cycle B) Write the uuid helper test.** Create `apps/backend/test/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isUuid } from '../src/routes/validation.js'

describe('isUuid', () => {
  it('accepts a canonical uuid', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isUuid('A6E7B8C9-D0E1-42F3-A4B5-C6D7E8F9A0B1')).toBe(true)
  })

  it('rejects malformed values', () => {
    expect(isUuid('nope')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid('11111111-1111-4111-8111-11111111111')).toBe(false)
    expect(isUuid('11111111-1111-4111-8111-111111111111 ')).toBe(false)
    expect(isUuid('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBe(false)
  })
})
```

- [ ] **5.6 Run and expect failure:** `pnpm --filter backend test -- test/validation.test.ts`
  Expected: `SyntaxError: The requested module '../src/routes/validation.js' does not provide an export named 'isUuid'`.

- [ ] **5.7 (GREEN, cycle B) Implement `isUuid`.** Append to `apps/backend/src/routes/validation.ts`:

```ts
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
```

- [ ] **5.8 Run and expect pass:** `pnpm --filter backend test -- test/validation.test.ts`

- [ ] **5.9 (RED, cycle C) Rewrite the transactions route tests.** Replace the whole of `apps/backend/test/transactions.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const convertAmount = vi.fn()
const getBaseCurrencyCode = vi.fn()
vi.mock('../src/currency/rates.js', () => ({
  convertAmount: (...args: unknown[]) => convertAmount(...args),
  getBaseCurrencyCode: (...args: unknown[]) => getBaseCurrencyCode(...args),
}))

import { createTransactionsRoute } from '../src/routes/transactions.js'

const accountId = '11111111-1111-4111-8111-111111111111'
const destinationAccountId = '22222222-2222-4222-8222-222222222222'
const expenseCategoryId = '33333333-3333-4333-8333-333333333333'
const incomeCategoryId = '44444444-4444-4444-8444-444444444444'
const transactionId = '55555555-5555-4555-8555-555555555555'
const missingId = '99999999-9999-4999-8999-999999999999'

const sampleTransaction = {
  id: transactionId,
  description: 'Coffee',
  amount: -12.5,
  currency: 'PEN',
  account_id: accountId,
  category_id: expenseCategoryId,
  tags: ['food'],
  type: 'expense',
  payee: null,
  notes: null,
  occurred_at: '2026-06-30T10:00:00.000Z',
  base_amount: -12.5,
  rate_used: 1,
  to_account_id: null,
  to_amount: null,
  external_id: null,
  created_at: '2026-06-30T10:00:00.000Z',
  updated_at: null,
}

interface DbFixtures {
  accounts?: Record<string, unknown>
  categories?: Record<string, unknown>
  transactions?: Record<string, unknown>
}

const defaultAccounts = {
  [accountId]: { id: accountId, name: 'Cash', type: 'cash', currency: 'PEN' },
  [destinationAccountId]: { id: destinationAccountId, name: 'BCP USD', type: 'bank', currency: 'USD' },
}

const defaultCategories = {
  [expenseCategoryId]: { id: expenseCategoryId, name: 'Food', type: 'expense' },
  [incomeCategoryId]: { id: incomeCategoryId, name: 'Salary', type: 'income' },
}

function defaultTransactions(): Record<string, unknown> {
  return {
    [transactionId]: { ...sampleTransaction },
    'tx-new': { ...sampleTransaction, id: 'tx-new' },
  }
}

function createDb(fixtures: DbFixtures = {}) {
  const accounts = fixtures.accounts ?? defaultAccounts
  const categories = fixtures.categories ?? defaultCategories
  const transactions = fixtures.transactions ?? defaultTransactions()
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/from accounts/i.test(sql)) {
        const account = (accounts as Record<string, unknown>)[String(params?.[0])]
        return { rows: account ? [account] : [] }
      }
      if (/from categories/i.test(sql)) {
        const category = (categories as Record<string, unknown>)[String(params?.[0])]
        return { rows: category ? [category] : [] }
      }
      if (/insert into transactions/i.test(sql)) return { rows: [{ id: 'tx-new' }] }
      if (/update transactions/i.test(sql)) return { rows: [] }
      if (/delete from transactions/i.test(sql)) return { rows: [] }
      if (/from transactions/i.test(sql) && /where id/i.test(sql)) {
        const transaction = transactions[String(params?.[0])]
        return { rows: transaction ? [transaction] : [] }
      }
      if (/from transactions/i.test(sql)) return { rows: Object.values(transactions) }
      return { rows: [] }
    }),
  }
}

function findParams(db: ReturnType<typeof createDb>, pattern: RegExp): unknown[] | undefined {
  const call = db.query.mock.calls.find(([sql]) => pattern.test(sql as string))
  return call?.[1] as unknown[] | undefined
}

function postTransaction(route: ReturnType<typeof createTransactionsRoute>, body: unknown) {
  return route.request('/api/transactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patchTransaction(
  route: ReturnType<typeof createTransactionsRoute>,
  id: string,
  body: unknown,
) {
  return route.request(`/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getBaseCurrencyCode.mockResolvedValue('PEN')
  convertAmount.mockResolvedValue({ convertedAmount: -12.5, rateUsed: 1 })
})

describe('transactions route: read and delete', () => {
  it('GET /api/transactions returns the list', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('GET /api/transactions/:id returns 404 when missing', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request(`/api/transactions/${missingId}`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Transaction not found' })
  })

  it('DELETE /api/transactions/:id deletes when present', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request(`/api/transactions/${transactionId}`, { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })

  it('DELETE /api/transactions/:id returns 404 when missing', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request(`/api/transactions/${missingId}`, { method: 'DELETE' })
    expect(response.status).toBe(404)
  })

  it('returns 500 with a JSON error when the query fails', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to list transactions' })
  })
})

describe('POST /api/transactions', () => {
  it('creates an expense: negative sign derived, base_amount from convertAmount', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      tags: ['food'],
      type: 'expense',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(201)
    expect((await response.json()).id).toBe('tx-new')
    const params = findParams(db, /insert into transactions/i)
    expect(params).toEqual([
      'Lunch', -12.5, 'PEN', accountId, expenseCategoryId, ['food'],
      'expense', null, null, '2026-06-30T10:00:00.000Z', -12.5, 1, null, null, null,
    ])
    expect(convertAmount).toHaveBeenCalledTimes(1)
    const [, amountArg, fromArg, toArg, dateArg] = convertAmount.mock.calls[0]
    expect([amountArg, fromArg, toArg, dateArg]).toEqual([-12.5, 'PEN', 'PEN', '2026-06-30'])
  })

  it('creates an income with a positive stored amount', async () => {
    convertAmount.mockResolvedValue({ convertedAmount: 1200, rateUsed: 1 })
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Salary',
      amount: 1200,
      currency: 'PEN',
      account_id: accountId,
      category_id: incomeCategoryId,
      type: 'income',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(201)
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[1]).toBe(1200)
    expect(params?.[6]).toBe('income')
  })

  it('defaults occurred_at to now when omitted', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
    })
    expect(response.status).toBe(201)
    const params = findParams(db, /insert into transactions/i)
    expect(String(params?.[9])).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('stores payee, notes, and external_id', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      payee: 'La Lucha',
      notes: 'with the team',
      external_id: 'gmail-abc',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[7]).toBe('La Lucha')
    expect(params?.[8]).toBe('with the team')
    expect(params?.[14]).toBe('gmail-abc')
  })

  it('stores null base_amount and rate_used when no rate exists (never 1)', async () => {
    convertAmount.mockResolvedValue(null)
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Import',
      amount: 20,
      currency: 'USD',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(201)
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[10]).toBeNull()
    expect(params?.[11]).toBeNull()
  })

  it('honors an explicit base_amount override and derives rate_used', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await postTransaction(route, {
      description: 'Import',
      amount: 20,
      currency: 'USD',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      base_amount: 74.8,
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[10]).toBe(-74.8)
    expect(params?.[11]).toBe(3.74)
    expect(convertAmount).not.toHaveBeenCalled()
  })

  it('honors an explicit rate_used alongside base_amount', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await postTransaction(route, {
      description: 'Import',
      amount: 20,
      currency: 'USD',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      base_amount: 74.8,
      rate_used: 3.7401,
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[11]).toBe(3.7401)
  })

  it('creates a transfer: negative source leg, null category, destination stored', async () => {
    convertAmount.mockResolvedValue({ convertedAmount: -100, rateUsed: 1 })
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'To USD account',
      amount: 100,
      currency: 'PEN',
      account_id: accountId,
      type: 'transfer',
      to_account_id: destinationAccountId,
      to_amount: 26.7,
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(201)
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[1]).toBe(-100)
    expect(params?.[4]).toBeNull()
    expect(params?.[6]).toBe('transfer')
    expect(params?.[12]).toBe(destinationAccountId)
    expect(params?.[13]).toBe(26.7)
  })

  it('returns 422 when the category type does not match the transaction type', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Salary',
      amount: 1200,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'income',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(422)
    expect((await response.json()).error).toMatch(/does not match/i)
    expect(findParams(db, /insert into transactions/i)).toBeUndefined()
  })

  it('returns 400 on a malformed account_id uuid', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: 'not-a-uuid',
      category_id: expenseCategoryId,
      type: 'expense',
    })
    expect(response.status).toBe(400)
    expect(findParams(db, /insert into transactions/i)).toBeUndefined()
  })

  it('returns 404 when the account does not exist', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: missingId,
      category_id: expenseCategoryId,
      type: 'expense',
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Account not found' })
  })

  it('returns 404 when the category does not exist', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: missingId,
      type: 'expense',
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Category not found' })
  })

  it('returns 422 for a transfer without to_amount', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Move',
      amount: 100,
      currency: 'PEN',
      account_id: accountId,
      type: 'transfer',
      to_account_id: destinationAccountId,
    })
    expect(response.status).toBe(422)
  })

  it('returns 422 for a transfer carrying a category_id', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Move',
      amount: 100,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'transfer',
      to_account_id: destinationAccountId,
      to_amount: 100,
    })
    expect(response.status).toBe(422)
  })

  it('returns 422 for a transfer into the same account', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Move',
      amount: 100,
      currency: 'PEN',
      account_id: accountId,
      type: 'transfer',
      to_account_id: accountId,
      to_amount: 100,
    })
    expect(response.status).toBe(422)
  })

  it('returns 422 for a non-transfer carrying to_account_id', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      to_account_id: destinationAccountId,
    })
    expect(response.status).toBe(422)
  })

  it('returns 422 for a non-transfer without category_id', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      type: 'expense',
    })
    expect(response.status).toBe(422)
  })

  it('returns 400 when amount is not positive', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: -5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
    })
    expect(response.status).toBe(400)
  })
})

describe('PATCH /api/transactions/:id', () => {
  it('merges description only and does not recompute base_amount', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, { description: 'Tea' })
    expect(response.status).toBe(200)
    const params = findParams(db, /update transactions/i)
    expect(params).toEqual([
      transactionId, 'Tea', -12.5, 'PEN', accountId, expenseCategoryId, ['food'],
      'expense', null, null, '2026-06-30T10:00:00.000Z', -12.5, 1, null, null, null,
    ])
    expect(convertAmount).not.toHaveBeenCalled()
  })

  it('recomputes base_amount when the amount changes', async () => {
    convertAmount.mockResolvedValue({ convertedAmount: -99.9, rateUsed: 1 })
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, { amount: 99.9 })
    expect(response.status).toBe(200)
    const params = findParams(db, /update transactions/i)
    expect(params?.[2]).toBe(-99.9)
    expect(params?.[11]).toBe(-99.9)
    expect(params?.[12]).toBe(1)
    expect(convertAmount).toHaveBeenCalledTimes(1)
  })

  it('recomputes base_amount when the currency changes', async () => {
    convertAmount.mockResolvedValue({ convertedAmount: -46.75, rateUsed: 3.74 })
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await patchTransaction(route, transactionId, { currency: 'USD' })
    const params = findParams(db, /update transactions/i)
    expect(params?.[3]).toBe('USD')
    expect(params?.[11]).toBe(-46.75)
    expect(params?.[12]).toBe(3.74)
  })

  it('does not recompute when an explicit base_amount accompanies the change', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await patchTransaction(route, transactionId, { amount: 20, currency: 'USD', base_amount: 74.8 })
    const params = findParams(db, /update transactions/i)
    expect(params?.[2]).toBe(-20)
    expect(params?.[11]).toBe(-74.8)
    expect(params?.[12]).toBe(3.74)
    expect(convertAmount).not.toHaveBeenCalled()
  })

  it('flips the stored sign when type changes to income', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, {
      type: 'income',
      category_id: incomeCategoryId,
    })
    expect(response.status).toBe(200)
    const params = findParams(db, /update transactions/i)
    expect(params?.[2]).toBe(12.5)
    expect(params?.[7]).toBe('income')
    expect(params?.[11]).toBe(12.5)
    expect(convertAmount).not.toHaveBeenCalled()
  })

  it('returns 422 when changing type to transfer without a destination', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, { type: 'transfer' })
    expect(response.status).toBe(422)
  })

  it('returns 422 when the new category type mismatches the type', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, {
      category_id: incomeCategoryId,
    })
    expect(response.status).toBe(422)
  })

  it('returns 404 when the transaction is missing', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, missingId, { description: 'Tea' })
    expect(response.status).toBe(404)
  })
})
```

- [ ] **5.10 Run and expect failure:** `pnpm --filter backend test -- test/transactions.test.ts`
  Expected: most POST/PATCH tests fail against the old route. Typical failures: `expected 400 to be 201` (the old schema rejects bodies missing the old required `category_id` or carrying unknown handling of `type`), `expected undefined to deeply equal [ 'Lunch', -12.5, ... ]` (old insert has 7 params), `expected 500 to be 404` and `expected 200 to be 422` (no validation existed).

- [ ] **5.11 (GREEN, cycle C) Rewrite the route.** Replace `apps/backend/src/routes/transactions.ts` entirely with:

```ts
import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import {
  deleteTransaction,
  getAccountById,
  getCategoryById,
  getTransactionById,
  getTransactions,
  insertTransaction,
  updateTransaction,
} from '../db/queries.js'
import { convertAmount, getBaseCurrencyCode } from '../currency/rates.js'
import { isUuid, parseJsonBody } from './validation.js'

const transactionTypeSchema = z.enum(['expense', 'income', 'transfer'])
type TransactionType = z.infer<typeof transactionTypeSchema>

const newTransactionSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(1),
  account_id: z.string().min(1),
  category_id: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
  type: transactionTypeSchema,
  payee: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  occurred_at: z.string().min(1).optional(),
  base_amount: z.number().positive().optional(),
  rate_used: z.number().positive().optional(),
  to_account_id: z.string().min(1).optional(),
  to_amount: z.number().positive().optional(),
  external_id: z.string().min(1).optional(),
})

const transactionUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().min(1).optional(),
  account_id: z.string().min(1).optional(),
  category_id: z.string().min(1).nullable().optional(),
  tags: z.array(z.string()).optional(),
  type: transactionTypeSchema.optional(),
  payee: z.string().min(1).nullable().optional(),
  notes: z.string().min(1).nullable().optional(),
  occurred_at: z.string().min(1).optional(),
  base_amount: z.number().positive().optional(),
  rate_used: z.number().positive().optional(),
  to_account_id: z.string().min(1).nullable().optional(),
  to_amount: z.number().positive().nullable().optional(),
  external_id: z.string().min(1).nullable().optional(),
})

interface ValidationFailure {
  status: 400 | 404 | 422
  error: string
}

interface TransactionShape {
  type: TransactionType
  account_id: string
  category_id: string | null
  to_account_id: string | null
  to_amount: number | null
}

async function validateTransactionShape(
  db: Queryable,
  shape: TransactionShape,
): Promise<ValidationFailure | null> {
  if (!isUuid(shape.account_id)) {
    return { status: 400, error: 'account_id is not a valid uuid' }
  }
  if (shape.category_id !== null && !isUuid(shape.category_id)) {
    return { status: 400, error: 'category_id is not a valid uuid' }
  }
  if (shape.to_account_id !== null && !isUuid(shape.to_account_id)) {
    return { status: 400, error: 'to_account_id is not a valid uuid' }
  }

  if (shape.type === 'transfer') {
    if (shape.to_account_id === null || shape.to_amount === null) {
      return { status: 422, error: 'Transfers require to_account_id and to_amount' }
    }
    if (shape.category_id !== null) {
      return { status: 422, error: 'Transfers must not carry a category_id' }
    }
    if (shape.to_account_id === shape.account_id) {
      return { status: 422, error: 'Transfer destination must differ from the source account' }
    }
  } else {
    if (shape.to_account_id !== null || shape.to_amount !== null) {
      return { status: 422, error: 'to_account_id and to_amount are only valid for transfers' }
    }
    if (shape.category_id === null) {
      return { status: 422, error: 'category_id is required for expense and income transactions' }
    }
  }

  const account = await getAccountById(db, shape.account_id)
  if (!account) return { status: 404, error: 'Account not found' }

  if (shape.type === 'transfer') {
    const destinationAccount = await getAccountById(db, shape.to_account_id as string)
    if (!destinationAccount) return { status: 404, error: 'Destination account not found' }
  } else {
    const category = await getCategoryById(db, shape.category_id as string)
    if (!category) return { status: 404, error: 'Category not found' }
    if (category.type !== shape.type) {
      return {
        status: 422,
        error: `Category type "${category.type}" does not match transaction type "${shape.type}"`,
      }
    }
  }
  return null
}

function signAmount(type: TransactionType, magnitude: number): number {
  return type === 'income' ? Math.abs(magnitude) : -Math.abs(magnitude)
}

// User-entered base_amount beats any computed one. When nothing is provided
// and no rate exists, both fields stay null: never a silent rate of 1.
async function resolveBaseAmount(
  db: Queryable,
  signedAmount: number,
  currency: string,
  occurredAt: string,
  override: { base_amount?: number; rate_used?: number },
): Promise<{ base_amount: number | null; rate_used: number | null }> {
  if (override.base_amount !== undefined) {
    const signedBaseAmount = Math.sign(signedAmount) * Math.abs(override.base_amount)
    const rateUsed = override.rate_used ?? Math.abs(override.base_amount / signedAmount)
    return { base_amount: signedBaseAmount, rate_used: rateUsed }
  }
  const baseCurrencyCode = await getBaseCurrencyCode(db)
  const conversion = await convertAmount(
    db,
    signedAmount,
    currency,
    baseCurrencyCode,
    occurredAt.slice(0, 10),
  )
  if (!conversion) return { base_amount: null, rate_used: null }
  return { base_amount: conversion.convertedAmount, rate_used: conversion.rateUsed }
}

export function createTransactionsRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/transactions', async (context) => {
    try {
      const transactions = await getTransactions(resolveDb())
      return context.json(transactions)
    } catch (error) {
      console.error('Failed to list transactions:', error)
      return context.json({ error: 'Failed to list transactions' }, 500)
    }
  })

  route.get('/api/transactions/:id', async (context) => {
    try {
      const transaction = await getTransactionById(resolveDb(), context.req.param('id'))
      if (!transaction) return context.json({ error: 'Transaction not found' }, 404)
      return context.json(transaction)
    } catch (error) {
      console.error('Failed to fetch transaction:', error)
      return context.json({ error: 'Failed to fetch transaction' }, 500)
    }
  })

  route.post('/api/transactions', async (context) => {
    const parsed = await parseJsonBody(context, newTransactionSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    const body = parsed.data
    try {
      const db = resolveDb()
      const failure = await validateTransactionShape(db, {
        type: body.type,
        account_id: body.account_id,
        category_id: body.category_id ?? null,
        to_account_id: body.to_account_id ?? null,
        to_amount: body.to_amount ?? null,
      })
      if (failure) return context.json({ error: failure.error }, failure.status)

      const occurredAt = body.occurred_at ?? new Date().toISOString()
      const signedAmount = signAmount(body.type, body.amount)
      const { base_amount, rate_used } = await resolveBaseAmount(
        db,
        signedAmount,
        body.currency,
        occurredAt,
        body,
      )

      const { id } = await insertTransaction(db, {
        description: body.description,
        amount: signedAmount,
        currency: body.currency,
        account_id: body.account_id,
        category_id: body.type === 'transfer' ? null : (body.category_id as string),
        tags: body.tags,
        type: body.type,
        payee: body.payee ?? null,
        notes: body.notes ?? null,
        occurred_at: occurredAt,
        base_amount,
        rate_used,
        to_account_id: body.to_account_id ?? null,
        to_amount: body.to_amount ?? null,
        external_id: body.external_id ?? null,
      })
      const transaction = await getTransactionById(db, id)
      return context.json(transaction, 201)
    } catch (error) {
      console.error('Failed to create transaction:', error)
      return context.json({ error: 'Failed to create transaction' }, 500)
    }
  })

  route.patch('/api/transactions/:id', async (context) => {
    const id = context.req.param('id')
    const parsed = await parseJsonBody(context, transactionUpdateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    const body = parsed.data
    try {
      const db = resolveDb()
      const existing = await getTransactionById(db, id)
      if (!existing) return context.json({ error: 'Transaction not found' }, 404)

      const mergedType = body.type ?? existing.type
      const typeChanged = mergedType !== existing.type
      const mergedAccountId = body.account_id ?? existing.account_id
      // When the type changes, drop the fields the new type forbids unless the
      // body sets them explicitly; the shape validation then demands the rest.
      const mergedCategoryId =
        body.category_id !== undefined
          ? body.category_id
          : typeChanged && mergedType === 'transfer'
            ? null
            : existing.category_id
      const mergedToAccountId =
        body.to_account_id !== undefined
          ? body.to_account_id
          : typeChanged && mergedType !== 'transfer'
            ? null
            : existing.to_account_id
      const mergedToAmount =
        body.to_amount !== undefined
          ? body.to_amount
          : typeChanged && mergedType !== 'transfer'
            ? null
            : existing.to_amount

      const failure = await validateTransactionShape(db, {
        type: mergedType,
        account_id: mergedAccountId,
        category_id: mergedCategoryId,
        to_account_id: mergedToAccountId,
        to_amount: mergedToAmount,
      })
      if (failure) return context.json({ error: failure.error }, failure.status)

      const mergedCurrency = body.currency ?? existing.currency
      const mergedOccurredAt = body.occurred_at ?? existing.occurred_at
      const amountMagnitude = body.amount ?? Math.abs(existing.amount)
      const signedAmount = signAmount(mergedType, amountMagnitude)

      let baseAmount = existing.base_amount
      let rateUsed = existing.rate_used
      if (body.base_amount !== undefined) {
        baseAmount = Math.sign(signedAmount) * Math.abs(body.base_amount)
        rateUsed = body.rate_used ?? Math.abs(body.base_amount / signedAmount)
      } else if (
        body.amount !== undefined ||
        body.currency !== undefined ||
        body.occurred_at !== undefined
      ) {
        const resolved = await resolveBaseAmount(db, signedAmount, mergedCurrency, mergedOccurredAt, {})
        baseAmount = resolved.base_amount
        rateUsed = resolved.rate_used
      } else if (baseAmount !== null) {
        // Only the type (and so the sign) may have changed: keep the frozen
        // magnitude but follow the sign of the stored amount.
        baseAmount = Math.sign(signedAmount) * Math.abs(baseAmount)
      }

      await updateTransaction(db, {
        id,
        description: body.description ?? existing.description,
        amount: signedAmount,
        currency: mergedCurrency,
        account_id: mergedAccountId,
        category_id: mergedCategoryId,
        tags: body.tags ?? existing.tags,
        type: mergedType,
        payee: body.payee !== undefined ? body.payee : existing.payee,
        notes: body.notes !== undefined ? body.notes : existing.notes,
        occurred_at: mergedOccurredAt,
        base_amount: baseAmount,
        rate_used: rateUsed,
        to_account_id: mergedToAccountId,
        to_amount: mergedToAmount,
        external_id: body.external_id !== undefined ? body.external_id : existing.external_id,
      })
      const transaction = await getTransactionById(db, id)
      return context.json(transaction)
    } catch (error) {
      console.error('Failed to update transaction:', error)
      return context.json({ error: 'Failed to update transaction' }, 500)
    }
  })

  route.delete('/api/transactions/:id', async (context) => {
    const id = context.req.param('id')
    try {
      const db = resolveDb()
      const existing = await getTransactionById(db, id)
      if (!existing) return context.json({ error: 'Transaction not found' }, 404)
      await deleteTransaction(db, id)
      return context.json({ success: true })
    } catch (error) {
      console.error('Failed to delete transaction:', error)
      return context.json({ error: 'Failed to delete transaction' }, 500)
    }
  })

  return route
}
```

- [ ] **5.12 Run and expect pass:** `pnpm --filter backend test -- test/transactions.test.ts`

- [ ] **5.13 Full verification:** `pnpm --filter backend test` and `pnpm --filter backend typecheck`. Both must be green. If typecheck flags the interim `processEmail`/`webhook` shims, fix the field mapping there (do not touch behavior).

- [ ] **5.14 Commit:** run `commita --no-push` and confirm it created a commit.

---

## Task 6: Server-side filtering, cursor pagination, and totals on GET /api/transactions

Two TDD cycles: (6A) the pure query-builder module with exhaustive unit tests, (6B) rewiring the GET route to the `{ items, next_cursor, totals }` contract. One commit at the end.

**Files:**
- Create: `apps/backend/src/db/transactionFilters.ts`
- Create: `apps/backend/test/transactionFilters.test.ts`
- Modify: `apps/backend/src/routes/transactions.ts` (GET list handler)
- Modify: `apps/backend/test/transactions.test.ts` (GET list tests)
- Modify: `apps/backend/src/db/queries.ts` (delete the now-unused `getTransactions`)
- Modify: `apps/backend/test/queries.test.ts` (delete the `getTransactions` test)

**Interfaces:**
- Consumes:
  - `transactionColumns` from `src/db/queries.ts` (Task 5)
  - `getBaseCurrencyCode(db)` from `src/currency/rates.ts` (section A)
  - `isUuid` from `src/routes/validation.ts` (Task 5)
- Produces (all from `src/db/transactionFilters.ts`):
  - `interface TransactionListFilters { from?: string; to?: string; account_ids?: string[]; category_ids?: string[]; uncategorized?: boolean; tags?: string[]; tag_mode?: 'any' | 'all' | 'none'; amount_min?: number; amount_max?: number; currency?: string; type?: 'expense' | 'income' | 'transfer'; search?: string; sort?: 'occurred_at' | 'amount'; order?: 'asc' | 'desc'; cursor?: string; limit?: number }`
  - `buildTransactionListQuery(filters: TransactionListFilters): { listSql: string; listParams: unknown[]; totalsSql: string; totalsParams: unknown[]; limit: number }` (the contract quartet plus the clamped page size the route needs for slicing)
  - `encodeCursor(cursor: { occurred_at: string; id: string; amount?: number }): string`
  - `decodeCursor(raw: string): { occurred_at: string; id: string; amount?: number } | null`
  - `reduceTotals(rows: TotalsRow[], baseCurrencyCode: string): { count: number; by_currency: { currency: string; sum: number }[]; base: { currency: string; sum: number | null } }` with `interface TotalsRow { currency: string; count: number; sum: number | null; base_sum: number | null; missing_base: boolean }`
  - `GET /api/transactions` returning `{ items, next_cursor, totals }`

Note on the cursor: the API cursor is opaque base64url of JSON. It always carries `occurred_at` and `id`; when the list is sorted by amount it additionally carries `amount` so keyset pagination stays correct. Clients never look inside, so this stays within the locked contract.

### Steps

- [ ] **6.1 (RED, cycle A) Write the builder unit tests.** Create `apps/backend/test/transactionFilters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildTransactionListQuery,
  decodeCursor,
  encodeCursor,
  reduceTotals,
} from '../src/db/transactionFilters.js'

const accountId = '11111111-1111-4111-8111-111111111111'
const otherAccountId = '22222222-2222-4222-8222-222222222222'
const categoryId = '33333333-3333-4333-8333-333333333333'
const rowId = '55555555-5555-4555-8555-555555555555'

describe('cursor encoding', () => {
  it('round-trips occurred_at and id', () => {
    const cursor = { occurred_at: '2026-06-30T10:00:00.000Z', id: rowId }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('round-trips an amount-sort cursor', () => {
    const cursor = { occurred_at: '2026-06-30T10:00:00.000Z', id: rowId, amount: -12.5 }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('returns null for garbage input', () => {
    expect(decodeCursor('not-base64-json')).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(Buffer.from('"just a string"').toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from('{"id":"x"}').toString('base64url'))).toBeNull()
  })
})

describe('buildTransactionListQuery: defaults', () => {
  it('builds an unfiltered query with default sort and limit 50 (+1 probe row)', () => {
    const built = buildTransactionListQuery({})
    expect(built.listSql).not.toMatch(/WHERE/i)
    expect(built.listSql).toMatch(/ORDER BY occurred_at DESC, id DESC/)
    expect(built.listSql).toMatch(/LIMIT \$1/)
    expect(built.listParams).toEqual([51])
    expect(built.limit).toBe(50)
    expect(built.totalsSql).not.toMatch(/WHERE/i)
    expect(built.totalsSql).not.toMatch(/LIMIT/i)
    expect(built.totalsParams).toEqual([])
  })

  it('clamps limit into [1, 200]', () => {
    expect(buildTransactionListQuery({ limit: 500 }).limit).toBe(200)
    expect(buildTransactionListQuery({ limit: 0 }).limit).toBe(1)
    expect(buildTransactionListQuery({ limit: 25 }).listParams).toEqual([26])
  })
})

describe('buildTransactionListQuery: individual filters', () => {
  it('applies an inclusive date range on occurred_at', () => {
    const built = buildTransactionListQuery({ from: '2026-06-01', to: '2026-06-30' })
    expect(built.listSql).toMatch(/occurred_at >= \$1::date/)
    expect(built.listSql).toMatch(/occurred_at < \(\$2::date \+ interval '1 day'\)/)
    expect(built.totalsSql).toMatch(/occurred_at >= \$1::date/)
    expect(built.listParams.slice(0, 2)).toEqual(['2026-06-01', '2026-06-30'])
  })

  it('matches account_ids against source and destination with one param', () => {
    const built = buildTransactionListQuery({ account_ids: [accountId, otherAccountId] })
    expect(built.listSql).toMatch(
      /\(account_id = ANY\(\$1::uuid\[\]\) OR to_account_id = ANY\(\$1::uuid\[\]\)\)/,
    )
    expect(built.listParams[0]).toEqual([accountId, otherAccountId])
  })

  it('filters by category_ids', () => {
    const built = buildTransactionListQuery({ category_ids: [categoryId] })
    expect(built.listSql).toMatch(/category_id = ANY\(\$1::uuid\[\]\)/)
  })

  it('uncategorized wins over category_ids', () => {
    const built = buildTransactionListQuery({ uncategorized: true, category_ids: [categoryId] })
    expect(built.listSql).toMatch(/category_id IS NULL/)
    expect(built.listSql).not.toMatch(/category_id = ANY/)
    expect(built.listParams).toEqual([51])
  })

  it('tag_mode any uses the overlap operator', () => {
    const built = buildTransactionListQuery({ tags: ['food', 'plin'] })
    expect(built.listSql).toMatch(/tags && \$1::text\[\]/)
  })

  it('tag_mode all uses the containment operator', () => {
    const built = buildTransactionListQuery({ tags: ['food'], tag_mode: 'all' })
    expect(built.listSql).toMatch(/tags @> \$1::text\[\]/)
  })

  it('tag_mode none negates the overlap', () => {
    const built = buildTransactionListQuery({ tags: ['food'], tag_mode: 'none' })
    expect(built.listSql).toMatch(/NOT \(tags && \$1::text\[\]\)/)
  })

  it('matches amount bounds on the absolute value', () => {
    const built = buildTransactionListQuery({ amount_min: 10, amount_max: 100 })
    expect(built.listSql).toMatch(/abs\(amount\) >= \$1/)
    expect(built.listSql).toMatch(/abs\(amount\) <= \$2/)
    expect(built.listParams.slice(0, 2)).toEqual([10, 100])
  })

  it('filters by currency and type', () => {
    const built = buildTransactionListQuery({ currency: 'USD', type: 'expense' })
    expect(built.listSql).toMatch(/currency = \$1/)
    expect(built.listSql).toMatch(/type = \$2/)
    expect(built.listParams.slice(0, 2)).toEqual(['USD', 'expense'])
  })

  it('search hits description, payee, notes, and tag elements with one param', () => {
    const built = buildTransactionListQuery({ search: 'cafe' })
    expect(built.listSql).toMatch(/description ILIKE \$1/)
    expect(built.listSql).toMatch(/payee ILIKE \$1/)
    expect(built.listSql).toMatch(/notes ILIKE \$1/)
    expect(built.listSql).toMatch(/unnest\(tags\) AS tag WHERE tag ILIKE \$1/)
    expect(built.listParams[0]).toBe('%cafe%')
  })
})

describe('buildTransactionListQuery: sort, order, cursor', () => {
  it('sorts by amount ascending when asked', () => {
    const built = buildTransactionListQuery({ sort: 'amount', order: 'asc' })
    expect(built.listSql).toMatch(/ORDER BY amount ASC, id ASC/)
  })

  it('adds a keyset condition for a descending occurred_at cursor', () => {
    const cursor = encodeCursor({ occurred_at: '2026-06-30T10:00:00.000Z', id: rowId })
    const built = buildTransactionListQuery({ cursor })
    expect(built.listSql).toMatch(/\(occurred_at, id\) < \(\$1::timestamptz, \$2::uuid\)/)
    expect(built.listParams).toEqual(['2026-06-30T10:00:00.000Z', rowId, 51])
  })

  it('flips the comparator for ascending order', () => {
    const cursor = encodeCursor({ occurred_at: '2026-06-30T10:00:00.000Z', id: rowId })
    const built = buildTransactionListQuery({ cursor, order: 'asc' })
    expect(built.listSql).toMatch(/\(occurred_at, id\) > \(\$1::timestamptz, \$2::uuid\)/)
  })

  it('paginates on (amount, id) for the amount sort', () => {
    const cursor = encodeCursor({ occurred_at: '2026-06-30T10:00:00.000Z', id: rowId, amount: -12.5 })
    const built = buildTransactionListQuery({ cursor, sort: 'amount' })
    expect(built.listSql).toMatch(/\(amount, id\) < \(\$1::numeric, \$2::uuid\)/)
    expect(built.listParams).toEqual([-12.5, rowId, 51])
  })

  it('keeps cursor params out of the totals query', () => {
    const cursor = encodeCursor({ occurred_at: '2026-06-30T10:00:00.000Z', id: rowId })
    const built = buildTransactionListQuery({ currency: 'PEN', cursor })
    expect(built.totalsParams).toEqual(['PEN'])
    expect(built.listParams).toEqual(['PEN', '2026-06-30T10:00:00.000Z', rowId, 51])
    expect(built.totalsSql).not.toMatch(/timestamptz/)
  })
})

describe('buildTransactionListQuery: combinations and totals SQL', () => {
  it('numbers params consistently across many filters', () => {
    const built = buildTransactionListQuery({
      from: '2026-01-01',
      to: '2026-06-30',
      account_ids: [accountId],
      tags: ['food'],
      amount_min: 5,
      currency: 'PEN',
      type: 'expense',
      search: 'lunch',
    })
    expect(built.listParams).toEqual([
      '2026-01-01', '2026-06-30', [accountId], ['food'], 5, 'PEN', 'expense', '%lunch%', 51,
    ])
    expect(built.totalsParams).toEqual([
      '2026-01-01', '2026-06-30', [accountId], ['food'], 5, 'PEN', 'expense', '%lunch%',
    ])
    expect(built.listSql).toMatch(/LIMIT \$9/)
  })

  it('totals exclude transfers from sums but not from the count', () => {
    const built = buildTransactionListQuery({})
    expect(built.totalsSql).toMatch(/count\(\*\)::int AS count/)
    expect(built.totalsSql).toMatch(/CASE WHEN type <> 'transfer' THEN amount END/)
    expect(built.totalsSql).toMatch(/CASE WHEN type <> 'transfer' THEN base_amount END/)
    expect(built.totalsSql).toMatch(/bool_or\(type <> 'transfer' AND base_amount IS NULL\)/)
    expect(built.totalsSql).toMatch(/GROUP BY currency/)
  })
})

describe('reduceTotals', () => {
  it('aggregates counts and per-currency sums', () => {
    const totals = reduceTotals(
      [
        { currency: 'PEN', count: 3, sum: -120.5, base_sum: -120.5, missing_base: false },
        { currency: 'USD', count: 2, sum: -40, base_sum: -149.6, missing_base: false },
      ],
      'PEN',
    )
    expect(totals.count).toBe(5)
    expect(totals.by_currency).toEqual([
      { currency: 'PEN', sum: -120.5 },
      { currency: 'USD', sum: -40 },
    ])
    expect(totals.base).toEqual({ currency: 'PEN', sum: -270.1 })
  })

  it('drops transfer-only currencies from by_currency but keeps their count', () => {
    const totals = reduceTotals(
      [
        { currency: 'PEN', count: 1, sum: -10, base_sum: -10, missing_base: false },
        { currency: 'USD', count: 1, sum: null, base_sum: null, missing_base: false },
      ],
      'PEN',
    )
    expect(totals.count).toBe(2)
    expect(totals.by_currency).toEqual([{ currency: 'PEN', sum: -10 }])
    expect(totals.base.sum).toBe(-10)
  })

  it('nulls the base sum when any row is missing base_amount', () => {
    const totals = reduceTotals(
      [
        { currency: 'PEN', count: 1, sum: -10, base_sum: -10, missing_base: false },
        { currency: 'USD', count: 1, sum: -20, base_sum: null, missing_base: true },
      ],
      'PEN',
    )
    expect(totals.base.sum).toBeNull()
  })

  it('handles the empty set', () => {
    const totals = reduceTotals([], 'PEN')
    expect(totals).toEqual({ count: 0, by_currency: [], base: { currency: 'PEN', sum: 0 } })
  })
})
```

- [ ] **6.2 Run and expect failure:** `pnpm --filter backend test -- test/transactionFilters.test.ts`
  Expected: `Error: Failed to load ... Cannot find module '../src/db/transactionFilters.js'` (the module does not exist yet).

- [ ] **6.3 (GREEN, cycle A) Implement the module.** Create `apps/backend/src/db/transactionFilters.ts`:

```ts
import { transactionColumns } from './queries.js'

export interface TransactionListFilters {
  from?: string
  to?: string
  account_ids?: string[]
  category_ids?: string[]
  uncategorized?: boolean
  tags?: string[]
  tag_mode?: 'any' | 'all' | 'none'
  amount_min?: number
  amount_max?: number
  currency?: string
  type?: 'expense' | 'income' | 'transfer'
  search?: string
  sort?: 'occurred_at' | 'amount'
  order?: 'asc' | 'desc'
  cursor?: string
  limit?: number
}

export interface TransactionCursor {
  occurred_at: string
  id: string
  amount?: number
}

export interface TransactionListQuery {
  listSql: string
  listParams: unknown[]
  totalsSql: string
  totalsParams: unknown[]
  limit: number
}

export interface TotalsRow {
  currency: string
  count: number
  sum: number | null
  base_sum: number | null
  missing_base: boolean
}

export interface TransactionTotals {
  count: number
  by_currency: { currency: string; sum: number }[]
  base: { currency: string; sum: number | null }
}

export function encodeCursor(cursor: TransactionCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string): TransactionCursor | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof decoded !== 'object' || decoded === null) return null
    const candidate = decoded as Record<string, unknown>
    if (typeof candidate.occurred_at !== 'string' || typeof candidate.id !== 'string') return null
    if (candidate.amount !== undefined && typeof candidate.amount !== 'number') return null
    return candidate as unknown as TransactionCursor
  } catch {
    return null
  }
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function buildTransactionListQuery(filters: TransactionListFilters): TransactionListQuery {
  const conditions: string[] = []
  const params: unknown[] = []
  const addParam = (value: unknown): string => {
    params.push(value)
    return `$${params.length}`
  }

  if (filters.from) {
    conditions.push(`occurred_at >= ${addParam(filters.from)}::date`)
  }
  if (filters.to) {
    conditions.push(`occurred_at < (${addParam(filters.to)}::date + interval '1 day')`)
  }
  if (filters.account_ids?.length) {
    const accountsParam = addParam(filters.account_ids)
    conditions.push(
      `(account_id = ANY(${accountsParam}::uuid[]) OR to_account_id = ANY(${accountsParam}::uuid[]))`,
    )
  }
  if (filters.uncategorized) {
    conditions.push('category_id IS NULL')
  } else if (filters.category_ids?.length) {
    conditions.push(`category_id = ANY(${addParam(filters.category_ids)}::uuid[])`)
  }
  if (filters.tags?.length) {
    const tagsParam = addParam(filters.tags)
    const tagMode = filters.tag_mode ?? 'any'
    if (tagMode === 'any') conditions.push(`tags && ${tagsParam}::text[]`)
    else if (tagMode === 'all') conditions.push(`tags @> ${tagsParam}::text[]`)
    else conditions.push(`NOT (tags && ${tagsParam}::text[])`)
  }
  if (filters.amount_min !== undefined) {
    conditions.push(`abs(amount) >= ${addParam(filters.amount_min)}`)
  }
  if (filters.amount_max !== undefined) {
    conditions.push(`abs(amount) <= ${addParam(filters.amount_max)}`)
  }
  if (filters.currency) {
    conditions.push(`currency = ${addParam(filters.currency)}`)
  }
  if (filters.type) {
    conditions.push(`type = ${addParam(filters.type)}`)
  }
  if (filters.search) {
    const searchParam = addParam(`%${filters.search}%`)
    conditions.push(
      `(description ILIKE ${searchParam} OR payee ILIKE ${searchParam} OR notes ILIKE ${searchParam}` +
        ` OR EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE ${searchParam}))`,
    )
  }

  // Totals cover the WHOLE filtered set: snapshot before cursor and limit.
  const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
  const totalsSql =
    `SELECT currency, count(*)::int AS count,` +
    ` SUM(CASE WHEN type <> 'transfer' THEN amount END)::float8 AS sum,` +
    ` SUM(CASE WHEN type <> 'transfer' THEN base_amount END)::float8 AS base_sum,` +
    ` bool_or(type <> 'transfer' AND base_amount IS NULL) AS missing_base` +
    ` FROM transactions${whereClause} GROUP BY currency`
  const totalsParams = [...params]

  const sort = filters.sort ?? 'occurred_at'
  const order = filters.order ?? 'desc'
  const direction = order === 'asc' ? 'ASC' : 'DESC'
  const comparator = order === 'asc' ? '>' : '<'
  const sortColumn = sort === 'amount' ? 'amount' : 'occurred_at'

  const listConditions = [...conditions]
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null
  if (cursor) {
    if (sort === 'amount' && cursor.amount !== undefined) {
      listConditions.push(
        `(amount, id) ${comparator} (${addParam(cursor.amount)}::numeric, ${addParam(cursor.id)}::uuid)`,
      )
    } else if (sort === 'occurred_at') {
      listConditions.push(
        `(occurred_at, id) ${comparator} (${addParam(cursor.occurred_at)}::timestamptz, ${addParam(cursor.id)}::uuid)`,
      )
    }
  }

  const requestedLimit = filters.limit ?? DEFAULT_LIMIT
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_LIMIT)
  const listWhereClause = listConditions.length ? ` WHERE ${listConditions.join(' AND ')}` : ''
  // Fetch one extra row as the has-more probe.
  const listSql =
    `SELECT ${transactionColumns} FROM transactions${listWhereClause}` +
    ` ORDER BY ${sortColumn} ${direction}, id ${direction} LIMIT ${addParam(limit + 1)}`

  return { listSql, listParams: params, totalsSql, totalsParams, limit }
}

export function reduceTotals(rows: TotalsRow[], baseCurrencyCode: string): TransactionTotals {
  const count = rows.reduce((total, row) => total + row.count, 0)
  const by_currency = rows
    .filter((row) => row.sum !== null)
    .map((row) => ({ currency: row.currency, sum: row.sum as number }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
  const missingBase = rows.some((row) => row.missing_base)
  const baseSum = missingBase
    ? null
    : Math.round(rows.reduce((total, row) => total + (row.base_sum ?? 0), 0) * 100) / 100
  return { count, by_currency, base: { currency: baseCurrencyCode, sum: baseSum } }
}
```

- [ ] **6.4 Run and expect pass:** `pnpm --filter backend test -- test/transactionFilters.test.ts`

- [ ] **6.5 (RED, cycle B) Update the route tests for the new list contract.** In `apps/backend/test/transactions.test.ts`:

First extend the db helper. Add to `DbFixtures`:

```ts
interface DbFixtures {
  accounts?: Record<string, unknown>
  categories?: Record<string, unknown>
  transactions?: Record<string, unknown>
  listRows?: unknown[]
  totalsRows?: unknown[]
}
```

Inside `createDb`, insert these two branches immediately BEFORE the `if (/from transactions/i.test(sql) && /where id/i.test(sql))` branch:

```ts
      if (/group by currency/i.test(sql)) {
        return {
          rows:
            fixtures.totalsRows ?? [
              { currency: 'PEN', count: 2, sum: -25, base_sum: -25, missing_base: false },
            ],
        }
      }
      if (/from transactions/i.test(sql) && /order by/i.test(sql)) {
        return { rows: fixtures.listRows ?? Object.values(transactions) }
      }
```

Then replace the `GET /api/transactions returns the list` test with this block, and add the new tests after it (keep the 404/DELETE/500 tests unchanged):

```ts
  it('GET /api/transactions returns items, next_cursor, and totals', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.next_cursor).toBeNull()
    expect(body.totals).toEqual({
      count: 2,
      by_currency: [{ currency: 'PEN', sum: -25 }],
      base: { currency: 'PEN', sum: -25 },
    })
  })

  it('GET /api/transactions pages with a decodable next_cursor', async () => {
    const rowIds = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ]
    const listRows = rowIds.map((rowId, index) => ({
      ...sampleTransaction,
      id: rowId,
      occurred_at: `2026-06-2${index}T10:00:00.000Z`,
    }))
    const db = createDb({ listRows })
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions?limit=2')
    const body = await response.json()
    expect(body.items).toHaveLength(2)
    expect(body.next_cursor).toBeTypeOf('string')
    const decoded = JSON.parse(
      Buffer.from(body.next_cursor as string, 'base64url').toString('utf8'),
    )
    expect(decoded.id).toBe(rowIds[1])
  })

  it('GET /api/transactions passes filters into the SQL', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await route.request('/api/transactions?currency=USD&type=expense&search=cafe')
    const listCall = db.query.mock.calls.find(([sql]) => /order by/i.test(sql as string))
    expect(listCall?.[0]).toMatch(/currency = \$/)
    expect(listCall?.[0]).toMatch(/type = \$/)
    expect(listCall?.[0]).toMatch(/ILIKE/)
    expect(listCall?.[1]).toContain('USD')
    expect(listCall?.[1]).toContain('expense')
    expect(listCall?.[1]).toContain('%cafe%')
  })

  it('GET /api/transactions returns a null base sum when rates are missing', async () => {
    const db = createDb({
      totalsRows: [
        { currency: 'PEN', count: 1, sum: -10, base_sum: -10, missing_base: false },
        { currency: 'USD', count: 1, sum: -20, base_sum: null, missing_base: true },
      ],
    })
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions')
    const body = await response.json()
    expect(body.totals.base.sum).toBeNull()
    expect(body.totals.count).toBe(2)
  })

  it('GET /api/transactions rejects an invalid cursor with 400', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions?cursor=%%%broken')
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('GET /api/transactions rejects an invalid tag_mode with 400', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions?tags=food&tag_mode=some')
    expect(response.status).toBe(400)
  })

  it('GET /api/transactions rejects non-uuid account_ids with 400', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions?account_ids=abc,def')
    expect(response.status).toBe(400)
  })
```

- [ ] **6.6 Run and expect failure:** `pnpm --filter backend test -- test/transactions.test.ts`
  Expected: the new GET tests fail. Typical failures: `expected false to be true` on `Array.isArray(body.items)` (the old handler returns a bare array so `body.items` is undefined), `expected 200 to be 400` on the invalid cursor and tag_mode tests.

- [ ] **6.7 (GREEN, cycle B) Rewire the GET handler.** In `apps/backend/src/routes/transactions.ts`:

Add imports (and remove `getTransactions` from the queries import):

```ts
import type { Transaction } from '../db/types.js'
import {
  buildTransactionListQuery,
  decodeCursor,
  encodeCursor,
  reduceTotals,
  type TotalsRow,
  type TransactionListFilters,
} from '../db/transactionFilters.js'
```

Add a query-string parser above `createTransactionsRoute`:

```ts
type ParsedListFilters =
  | { success: true; filters: TransactionListFilters }
  | { success: false; error: string }

function parseListFilters(query: Record<string, string>): ParsedListFilters {
  const filters: TransactionListFilters = {}
  if (query.from) filters.from = query.from
  if (query.to) filters.to = query.to
  if (query.account_ids) {
    const accountIds = query.account_ids.split(',').filter(Boolean)
    if (accountIds.some((candidateId) => !isUuid(candidateId))) {
      return { success: false, error: 'account_ids must be a comma-separated list of uuids' }
    }
    filters.account_ids = accountIds
  }
  if (query.category_ids) {
    const categoryIds = query.category_ids.split(',').filter(Boolean)
    if (categoryIds.some((candidateId) => !isUuid(candidateId))) {
      return { success: false, error: 'category_ids must be a comma-separated list of uuids' }
    }
    filters.category_ids = categoryIds
  }
  if (query.uncategorized === 'true') filters.uncategorized = true
  if (query.tags) filters.tags = query.tags.split(',').filter(Boolean)
  if (query.tag_mode) {
    if (!['any', 'all', 'none'].includes(query.tag_mode)) {
      return { success: false, error: 'tag_mode must be any, all, or none' }
    }
    filters.tag_mode = query.tag_mode as 'any' | 'all' | 'none'
  }
  if (query.amount_min !== undefined) {
    const amountMin = Number(query.amount_min)
    if (Number.isNaN(amountMin)) return { success: false, error: 'amount_min must be a number' }
    filters.amount_min = amountMin
  }
  if (query.amount_max !== undefined) {
    const amountMax = Number(query.amount_max)
    if (Number.isNaN(amountMax)) return { success: false, error: 'amount_max must be a number' }
    filters.amount_max = amountMax
  }
  if (query.currency) filters.currency = query.currency
  if (query.type) {
    if (!['expense', 'income', 'transfer'].includes(query.type)) {
      return { success: false, error: 'type must be expense, income, or transfer' }
    }
    filters.type = query.type as 'expense' | 'income' | 'transfer'
  }
  if (query.search) filters.search = query.search
  if (query.sort) {
    if (!['occurred_at', 'amount'].includes(query.sort)) {
      return { success: false, error: 'sort must be occurred_at or amount' }
    }
    filters.sort = query.sort as 'occurred_at' | 'amount'
  }
  if (query.order) {
    if (!['asc', 'desc'].includes(query.order)) {
      return { success: false, error: 'order must be asc or desc' }
    }
    filters.order = query.order as 'asc' | 'desc'
  }
  if (query.cursor) {
    if (!decodeCursor(query.cursor)) return { success: false, error: 'Invalid cursor' }
    filters.cursor = query.cursor
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1) {
      return { success: false, error: 'limit must be a positive integer' }
    }
    filters.limit = limit
  }
  return { success: true, filters }
}
```

Replace the `route.get('/api/transactions', ...)` handler with:

```ts
  route.get('/api/transactions', async (context) => {
    const parsedFilters = parseListFilters(context.req.query())
    if (!parsedFilters.success) {
      return context.json({ error: parsedFilters.error }, 400)
    }
    try {
      const db = resolveDb()
      const { listSql, listParams, totalsSql, totalsParams, limit } = buildTransactionListQuery(
        parsedFilters.filters,
      )
      const [listResult, totalsResult, baseCurrencyCode] = await Promise.all([
        db.query(listSql, listParams),
        db.query(totalsSql, totalsParams),
        getBaseCurrencyCode(db),
      ])
      const rows = listResult.rows as Transaction[]
      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const lastItem = items[items.length - 1]
      const sort = parsedFilters.filters.sort ?? 'occurred_at'
      const next_cursor =
        hasMore && lastItem
          ? encodeCursor(
              sort === 'amount'
                ? { occurred_at: lastItem.occurred_at, id: lastItem.id, amount: lastItem.amount }
                : { occurred_at: lastItem.occurred_at, id: lastItem.id },
            )
          : null
      const totals = reduceTotals(totalsResult.rows as TotalsRow[], baseCurrencyCode)
      return context.json({ items, next_cursor, totals })
    } catch (error) {
      console.error('Failed to list transactions:', error)
      return context.json({ error: 'Failed to list transactions' }, 500)
    }
  })
```

Finally remove the dead code: delete `getTransactions` from `apps/backend/src/db/queries.ts` and delete the `getTransactions selects the full row ordered by occurred_at` test (and its import) from `apps/backend/test/queries.test.ts`.

- [ ] **6.8 Run and expect pass:** `pnpm --filter backend test -- test/transactions.test.ts test/transactionFilters.test.ts test/queries.test.ts`

- [ ] **6.9 Full verification:** `pnpm --filter backend test` and `pnpm --filter backend typecheck`. Note for the web app: `GET /api/transactions` now returns an object instead of an array; the web tasks in section C adapt the client. If `pnpm --filter web typecheck` was green before, it stays green (the web change is scoped to its own task).

- [ ] **6.10 Commit:** run `commita --no-push` and confirm it created a commit.

---

## Task 7: Ingestion pipeline upgrade (payee, occurred_at, currency validation, dedupe, conversion)

Three TDD cycles: (7A) new queries (`getTransactionByExternalId`, `getCurrencyByCode`), (7B) extractor schema, (7C) processEmail rewrite plus index wiring. One commit at the end.

**Files:**
- Modify: `apps/backend/src/db/queries.ts` (add `getTransactionByExternalId`, `getCurrencyByCode`)
- Modify: `apps/backend/src/ai/extract.ts` (schema, prompt, return shape)
- Modify: `apps/backend/src/pipeline/processEmail.ts` (full upgrade)
- Modify: `apps/backend/src/index.ts` (pass `messageId` through)
- Tests: `apps/backend/test/queries.test.ts`, `apps/backend/test/extract.test.ts`, `apps/backend/test/processEmail.test.ts`

**Interfaces:**
- Consumes:
  - `convertAmount`, `getBaseCurrencyCode` from `src/currency/rates.ts` (section A)
  - `backfillRate(db, quoteCode, onDate, fetchImpl?): Promise<ExchangeRate | null>` from `src/currency/fetchRates.ts` (section A)
  - `insertTransaction` with the new `NewTransaction` (Task 5)
  - `Currency` type from `src/db/types.ts` (section A)
- Produces:
  - `getTransactionByExternalId(db: Queryable, externalId: string): Promise<Transaction | null>` from `src/db/queries.ts`
  - `getCurrencyByCode(db: Queryable, code: string): Promise<Currency | null>` from `src/db/queries.ts` (if section A already added an equivalent, reuse it and skip the duplicate)
  - `ExtractedTransaction { description: string; amount: number; currency: string; account_id: string; category_id: string; tags: string[]; payee: string | null; occurred_at: string }` from `src/ai/extract.ts`
  - `processEmail(email: { subject: string; text: string; messageId: string }, deps: ProcessDeps): Promise<void>` where `ProcessDeps` gains `convert: typeof convertAmount` and `backfill: typeof backfillRate`

### Steps

- [ ] **7.1 (RED, cycle A) Query tests.** Append to the `describe('queries', ...)` block in `apps/backend/test/queries.test.ts` (add `getTransactionByExternalId` and `getCurrencyByCode` to the import):

```ts
  it('getTransactionByExternalId looks up by external_id', async () => {
    const db = fakeDb([{ id: 'tx1', external_id: 'gmail-123' }])
    const transaction = await getTransactionByExternalId(db, 'gmail-123')
    expect(transaction?.id).toBe('tx1')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/where external_id = \$1/i)
    expect(params).toEqual(['gmail-123'])
  })

  it('getTransactionByExternalId returns null when absent', async () => {
    const db = fakeDb([])
    expect(await getTransactionByExternalId(db, 'gmail-404')).toBeNull()
  })

  it('getCurrencyByCode looks up a currency', async () => {
    const db = fakeDb([{ code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', decimal_places: 2 }])
    const currency = await getCurrencyByCode(db, 'PEN')
    expect(currency?.decimal_places).toBe(2)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/from currencies/i)
    expect(params).toEqual(['PEN'])
  })

  it('getCurrencyByCode returns null for an unknown code', async () => {
    const db = fakeDb([])
    expect(await getCurrencyByCode(db, 'XYZ')).toBeNull()
  })
```

- [ ] **7.2 Run and expect failure:** `pnpm --filter backend test -- test/queries.test.ts`
  Expected: `SyntaxError: The requested module '../src/db/queries.js' does not provide an export named 'getCurrencyByCode'`.

- [ ] **7.3 (GREEN, cycle A) Implement the queries.** Append to `apps/backend/src/db/queries.ts` (add `Currency` to the type import from `./types.js`):

```ts
export async function getTransactionByExternalId(
  db: Queryable,
  externalId: string,
): Promise<Transaction | null> {
  const result = await db.query(
    `SELECT ${transactionColumns}
       FROM transactions
      WHERE external_id = $1`,
    [externalId],
  )
  return result.rows.length ? (result.rows[0] as Transaction) : null
}

export async function getCurrencyByCode(db: Queryable, code: string): Promise<Currency | null> {
  const result = await db.query(
    'SELECT code, name, symbol, decimal_places FROM currencies WHERE code = $1',
    [code],
  )
  return result.rows.length ? (result.rows[0] as Currency) : null
}
```

- [ ] **7.4 Run and expect pass:** `pnpm --filter backend test -- test/queries.test.ts`

- [ ] **7.5 (RED, cycle B) Extractor tests.** In `apps/backend/test/extract.test.ts`, update every `generateObject.mockResolvedValue` object: replace `created_at: '...'` with `occurred_at: '...'` and add `payee`. The first test becomes:

```ts
  it('returns the parsed transaction', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'PLIN-MARISELA CALLE', amount: -35, currency: 'PEN',
        account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
        payee: 'Marisela Calle', occurred_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'Consumo S/ 35.00', ...refs })
    expect(result?.account_id).toBe('a1')
    expect(result?.amount).toBe(-35)
    expect(result?.payee).toBe('Marisela Calle')
    expect(result?.occurred_at).toBe('2026-06-29T20:55:00.000Z')
  })
```

In the three null-returning tests, swap `created_at: '2026-06-29T20:55:00.000Z'` for `payee: null, occurred_at: '2026-06-29T20:55:00.000Z'`. Then add one new test:

```ts
  it('instructs the model to use ISO 4217 codes, payee, and occurred_at', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'x', amount: -1, currency: 'PEN',
        account_id: 'a1', category_id: 'c1', tags: ['a', 'b', 'c'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      },
    })
    await extractTransaction({ text: 'something', ...refs })
    const callOptions = generateObject.mock.calls[0][0] as { system: string }
    expect(callOptions.system).toMatch(/ISO 4217/)
    expect(callOptions.system).toMatch(/payee/)
    expect(callOptions.system).toMatch(/occurred_at/)
  })
```

- [ ] **7.6 Run and expect failure:** `pnpm --filter backend test -- test/extract.test.ts`
  Expected: `AssertionError: expected undefined to be 'Marisela Calle'` on the first test (the old return shape has no `payee`) and the new prompt test fails with `expected '...' to match /ISO 4217/`.

- [ ] **7.7 (GREEN, cycle B) Implement the extractor changes.** Replace `apps/backend/src/ai/extract.ts` with:

```ts
import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './provider.js'
import type { Account, Category } from '../db/types.js'

const schema = z.object({
  description: z.string(),
  amount: z.number(),
  currency: z.string(),
  account_id: z.string().nullable(),
  category_id: z.string().nullable(),
  tags: z.array(z.string()),
  payee: z.string().nullable(),
  occurred_at: z.string(),
})

export interface ExtractedTransaction {
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string
  tags: string[]
  payee: string | null
  occurred_at: string
}

export interface ExtractInput {
  text: string
  categories: Category[]
  accounts: Account[]
  tags: string[]
  now: string
}

function buildSystemPrompt(input: ExtractInput): string {
  return [
    'Tienes la siguiente informacion:',
    '',
    '1. Categorias de consumo o ingreso y sus ID:',
    JSON.stringify(input.categories, null, 2),
    '',
    '2. Lista de posibles tags:',
    JSON.stringify(input.tags, null, 2),
    '',
    '3. Cuentas bancarias o tarjetas y sus ID:',
    JSON.stringify(input.accounts, null, 2),
    '',
    'Analiza el contenido del correo y devuelve los campos de la transaccion.',
    'Incluye el signo (-/+) en el monto: negativo para egresos.',
    'currency: codigo ISO 4217 en mayusculas (PEN, USD, EUR, ...).',
    'payee: nombre del comercio o de la persona que recibe o envia el dinero; null si no se puede determinar.',
    'category_id y account_id son distintos y deben venir de las listas dadas.',
    'Si no hay informacion suficiente para un campo usa null.',
    'tags: minimo 3, en minusculas, una sola palabra por tag.',
    `Fecha y hora actual: ${input.now}. Zona horaria: America/Lima.`,
    'occurred_at: fecha y hora de la transaccion segun el correo, en formato ISO 8601.',
    'Si el correo usa fechas relativas, calcula occurred_at; si no indica fecha, usa la fecha del correo.',
  ].join('\n')
}

export async function extractTransaction(input: ExtractInput): Promise<ExtractedTransaction | null> {
  const { object } = await generateObject({
    model: getModel(),
    schema,
    maxRetries: 2,
    system: buildSystemPrompt(input),
    prompt: `body:\n${input.text}`,
  })

  const account = input.accounts.find((candidate) => candidate.id === object.account_id)
  const category = input.categories.find((candidate) => candidate.id === object.category_id)
  if (!account || !category) {
    return null
  }

  return {
    description: object.description,
    amount: object.amount,
    currency: object.currency,
    account_id: account.id,
    category_id: category.id,
    tags: object.tags,
    payee: object.payee,
    occurred_at: object.occurred_at,
  }
}
```

- [ ] **7.8 Run and expect pass:** `pnpm --filter backend test -- test/extract.test.ts`
  Note: `pnpm --filter backend typecheck` is broken at this point because `processEmail.ts` still reads `extracted.created_at`. Cycle C fixes it; do not commit yet.

- [ ] **7.9 (RED, cycle C) Rewrite the pipeline tests.** Replace `apps/backend/test/processEmail.test.ts` entirely with:

```ts
import { describe, it, expect, vi } from 'vitest'
import { processEmail } from '../src/pipeline/processEmail.js'

interface QueryRows {
  categories: unknown[]
  accounts: unknown[]
  tags: unknown[]
  insert: unknown[]
  currencies: { code: string }[]
  existingByExternalId: unknown[]
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const queryRows: QueryRows = {
    categories: [{ id: 'c1', name: 'Food', type: 'expense' }],
    accounts: [{ id: 'a1', name: 'Debito BCP', type: 'DEBIT', currency: 'PEN' }],
    tags: [{ tag: 'food' }],
    insert: [{ id: 'tx1' }],
    currencies: [
      { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', decimal_places: 2 } as never,
      { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 } as never,
    ],
    existingByExternalId: [],
  }
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/external_id/i.test(sql)) return { rows: queryRows.existingByExternalId }
      if (/from categories/i.test(sql)) return { rows: queryRows.categories }
      if (/from accounts/i.test(sql)) return { rows: queryRows.accounts }
      if (/unnest/i.test(sql)) return { rows: queryRows.tags }
      if (/from currencies/i.test(sql)) {
        const code = String(params?.[0])
        return { rows: queryRows.currencies.filter((currency) => currency.code === code) }
      }
      if (/insert into transactions/i.test(sql)) return { rows: queryRows.insert }
      return { rows: [] }
    }),
  }
  return {
    db,
    queryRows,
    now: () => '2026-06-30T10:00:00.000Z',
    detect: vi.fn().mockResolvedValue(true),
    extract: vi.fn().mockResolvedValue({
      description: 'PLIN', amount: -35, currency: 'PEN',
      account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
      payee: 'Marisela Calle', occurred_at: '2026-06-29T20:55:00.000Z',
    }),
    notify: vi.fn().mockResolvedValue(undefined),
    convert: vi.fn().mockResolvedValue({ convertedAmount: -35, rateUsed: 1 }),
    backfill: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

const email = { subject: 'Consumo', text: 'S/ 35.00', messageId: 'gmail-1' }

function findInsertParams(deps: ReturnType<typeof baseDeps>): unknown[] | undefined {
  const insertCall = deps.db.query.mock.calls.find((call: unknown[]) =>
    /insert into transactions/i.test(call[0] as string))
  return insertCall?.[1] as unknown[] | undefined
}

describe('processEmail', () => {
  it('skips non-transaction email', async () => {
    const deps = baseDeps({ detect: vi.fn().mockResolvedValue(false) })
    await processEmail({ ...email, subject: 'Oferta', text: 'descuento' }, deps as never)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('inserts with type, payee, occurred_at, external_id, and conversion', async () => {
    const deps = baseDeps()
    await processEmail(email, deps as never)
    const params = findInsertParams(deps)
    expect(params).toBeTruthy()
    expect(params?.[1]).toBe(-35)
    expect(params?.[2]).toBe('PEN')
    expect(params?.[6]).toBe('expense')
    expect(params?.[7]).toBe('Marisela Calle')
    expect(params?.[9]).toBe('2026-06-29T20:55:00.000Z')
    expect(params?.[10]).toBe(-35)
    expect(params?.[11]).toBe(1)
    expect(params?.[14]).toBe('gmail-1')
    expect(deps.notify).toHaveBeenCalledOnce()
    expect(deps.notify.mock.calls[0][0] as string).toContain('ID: tx1')
  })

  it('skips silently when the external_id already exists', async () => {
    const deps = baseDeps()
    deps.queryRows.existingByExternalId = [{ id: 'tx-old', external_id: 'gmail-1' }]
    await processEmail(email, deps as never)
    expect(deps.detect).not.toHaveBeenCalled()
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(findInsertParams(deps)).toBeUndefined()
  })

  it('derives income from a positive amount', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'Abono', amount: 1200, currency: 'PEN',
        account_id: 'a1', category_id: 'c1', tags: ['salary', 'bank', 'monthly'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      }),
      convert: vi.fn().mockResolvedValue({ convertedAmount: 1200, rateUsed: 1 }),
    })
    await processEmail(email, deps as never)
    expect(findInsertParams(deps)?.[6]).toBe('income')
  })

  it('normalizes the extracted currency to an uppercase trimmed code', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'PLIN', amount: -35, currency: ' pen ',
        account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      }),
    })
    await processEmail(email, deps as never)
    const currencyLookup = deps.db.query.mock.calls.find((call: unknown[]) =>
      /from currencies/i.test(call[0] as string))
    expect(currencyLookup?.[1]).toEqual(['PEN'])
    expect(findInsertParams(deps)?.[2]).toBe('PEN')
  })

  it('rejects an unknown currency through the telegram error path', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'PLIN', amount: -35, currency: 'XYZ',
        account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      }),
    })
    await processEmail(email, deps as never)
    expect(findInsertParams(deps)).toBeUndefined()
    expect(deps.notify).toHaveBeenCalledOnce()
    expect(deps.notify.mock.calls[0][0] as string).toMatch(/XYZ/)
    expect(deps.notify.mock.calls[0][0] as string).toMatch(/Error/i)
  })

  it('sends an error notification when extraction yields no account', async () => {
    const deps = baseDeps({ extract: vi.fn().mockResolvedValue(null) })
    await processEmail({ ...email, text: 'raro' }, deps as never)
    expect(findInsertParams(deps)).toBeUndefined()
    expect(deps.notify.mock.calls[0][0] as string).toMatch(/Error/i)
  })

  it('backfills the missing rate and retries the conversion', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'Amazon', amount: -35, currency: 'USD',
        account_id: 'a1', category_id: 'c1', tags: ['shopping', 'online', 'usd'],
        payee: 'Amazon', occurred_at: '2026-06-29T20:55:00.000Z',
      }),
      convert: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ convertedAmount: -130.9, rateUsed: 3.74 }),
    })
    await processEmail(email, deps as never)
    expect(deps.backfill).toHaveBeenCalledTimes(1)
    const [, quoteCode, onDate] = deps.backfill.mock.calls[0]
    expect(quoteCode).toBe('PEN')
    expect(onDate).toBe('2026-06-29')
    const params = findInsertParams(deps)
    expect(params?.[10]).toBe(-130.9)
    expect(params?.[11]).toBe(3.74)
  })

  it('stores null base_amount when no rate exists even after backfill', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'Amazon', amount: -35, currency: 'USD',
        account_id: 'a1', category_id: 'c1', tags: ['shopping', 'online', 'usd'],
        payee: 'Amazon', occurred_at: '2026-06-29T20:55:00.000Z',
      }),
      convert: vi.fn().mockResolvedValue(null),
    })
    await processEmail(email, deps as never)
    const params = findInsertParams(deps)
    expect(params?.[10]).toBeNull()
    expect(params?.[11]).toBeNull()
    expect(deps.notify).toHaveBeenCalledOnce()
  })
})
```

- [ ] **7.10 Run and expect failure:** `pnpm --filter backend test -- test/processEmail.test.ts`
  Expected: the suite may fail to run with a TypeScript-free runtime error, or individual tests fail with `expected undefined to be 'gmail-1'` and `expected undefined to be 'expense'` style mismatches (the interim shim from Task 5 stores nulls for payee and external_id, and the module still reads `extracted.created_at` which is now undefined, so `params?.[9]` is undefined).

- [ ] **7.11 (GREEN, cycle C) Rewrite the pipeline.** Replace `apps/backend/src/pipeline/processEmail.ts` with:

```ts
import type { Queryable } from '../db/pool.js'
import {
  getAccounts,
  getCategories,
  getCurrencyByCode,
  getDistinctTags,
  getTransactionByExternalId,
  insertTransaction,
} from '../db/queries.js'
import { detectTransaction } from '../ai/detect.js'
import { extractTransaction } from '../ai/extract.js'
import { convertAmount, getBaseCurrencyCode } from '../currency/rates.js'
import { backfillRate } from '../currency/fetchRates.js'
import { sendMessage } from '../telegram/client.js'
import { formatError, formatNewTransaction } from '../telegram/format.js'

export interface ProcessDeps {
  db: Queryable
  now: () => string
  detect: typeof detectTransaction
  extract: typeof extractTransaction
  notify: typeof sendMessage
  convert: typeof convertAmount
  backfill: typeof backfillRate
}

export const defaultProcessDeps: Omit<ProcessDeps, 'db'> = {
  now: () => new Date().toISOString(),
  detect: detectTransaction,
  extract: extractTransaction,
  notify: sendMessage,
  convert: convertAmount,
  backfill: backfillRate,
}

export async function processEmail(
  email: { subject: string; text: string; messageId: string },
  deps: ProcessDeps,
): Promise<void> {
  // Idempotent ingestion: the Gmail message id is the external id. A repeat
  // (webhook replay, cursor reset) is skipped silently, before any AI call.
  const alreadyIngested = await getTransactionByExternalId(deps.db, email.messageId)
  if (alreadyIngested) return

  const isTransaction = await deps.detect({ subject: email.subject, text: email.text })
  if (!isTransaction) return

  const [categories, accounts, tags] = await Promise.all([
    getCategories(deps.db),
    getAccounts(deps.db),
    getDistinctTags(deps.db),
  ])

  const extracted = await deps.extract({
    text: email.text,
    categories,
    accounts,
    tags,
    now: deps.now(),
  })

  if (!extracted) {
    await deps.notify(formatError(`No se pudo determinar la cuenta para: ${email.subject}`))
    return
  }

  const currencyCode = extracted.currency.trim().toUpperCase()
  const knownCurrency = await getCurrencyByCode(deps.db, currencyCode)
  if (!knownCurrency) {
    await deps.notify(
      formatError(
        `Moneda desconocida "${currencyCode}" en: ${email.subject}. Transaccion no creada.`,
      ),
    )
    return
  }

  const type = extracted.amount < 0 ? 'expense' : 'income'
  const occurredDate = extracted.occurred_at.slice(0, 10)
  const baseCurrencyCode = await getBaseCurrencyCode(deps.db)

  let conversion = await deps.convert(
    deps.db,
    extracted.amount,
    currencyCode,
    baseCurrencyCode,
    occurredDate,
  )
  if (!conversion) {
    // Rates are stored as USD pairs; backfill whichever legs are not USD,
    // then retry once. A still-missing rate stays null, never 1.
    if (currencyCode !== 'USD') await deps.backfill(deps.db, currencyCode, occurredDate)
    if (baseCurrencyCode !== 'USD') await deps.backfill(deps.db, baseCurrencyCode, occurredDate)
    conversion = await deps.convert(
      deps.db,
      extracted.amount,
      currencyCode,
      baseCurrencyCode,
      occurredDate,
    )
  }

  const { id } = await insertTransaction(deps.db, {
    description: extracted.description,
    amount: extracted.amount,
    currency: currencyCode,
    account_id: extracted.account_id,
    category_id: extracted.category_id,
    tags: extracted.tags,
    type,
    payee: extracted.payee,
    notes: null,
    occurred_at: extracted.occurred_at,
    base_amount: conversion?.convertedAmount ?? null,
    rate_used: conversion?.rateUsed ?? null,
    to_account_id: null,
    to_amount: null,
    external_id: email.messageId,
  })

  const account = accounts.find((candidate) => candidate.id === extracted.account_id)
  const category = categories.find((candidate) => candidate.id === extracted.category_id)
  await deps.notify(
    formatNewTransaction({
      id,
      description: extracted.description,
      accountName: account?.name ?? extracted.account_id,
      categoryName: category?.name ?? extracted.category_id,
      tags: extracted.tags,
      currency: currencyCode,
      amount: extracted.amount,
      created_at: extracted.occurred_at,
    }),
  )
}
```

In `apps/backend/src/index.ts`, update the `onEmail` wiring to pass the message id through (the poller already provides it):

```ts
    onEmail: (email) =>
      processEmail(
        { subject: email.subject, text: email.text, messageId: email.messageId },
        { db, ...defaultProcessDeps },
      ).catch((error) => console.error('processEmail failed:', error)),
```

- [ ] **7.12 Run and expect pass:** `pnpm --filter backend test -- test/processEmail.test.ts test/extract.test.ts`

- [ ] **7.13 Full verification:** `pnpm --filter backend test` and `pnpm --filter backend typecheck`.

- [ ] **7.14 Commit:** run `commita --no-push` and confirm it created a commit.

---

## Task 8: Delete guards (409) and uuid validation (400) on accounts, categories, transactions

Two TDD cycles: (8A) referenced-check queries, (8B) route guards across the three resources. One commit at the end.

**Files:**
- Modify: `apps/backend/src/db/queries.ts` (add `accountHasTransactions`, `categoryHasTransactions`)
- Modify: `apps/backend/src/routes/accounts.ts` (uuid guard on `:id` routes, 409 delete guard)
- Modify: `apps/backend/src/routes/categories.ts` (same)
- Modify: `apps/backend/src/routes/transactions.ts` (uuid guard on `:id` routes)
- Tests: `apps/backend/test/queries.test.ts`, `apps/backend/test/accounts.test.ts`, `apps/backend/test/categories.test.ts`, `apps/backend/test/transactions.test.ts`

**Interfaces:**
- Consumes: `isUuid` from `src/routes/validation.ts` (Task 5).
- Produces:
  - `accountHasTransactions(db: Queryable, accountId: string): Promise<boolean>` from `src/db/queries.ts`
  - `categoryHasTransactions(db: Queryable, categoryId: string): Promise<boolean>` from `src/db/queries.ts`
  - 400 `{ error: 'Invalid <resource> id' }` on malformed `:id` for GET/PATCH/DELETE of accounts, categories, and transactions
  - 409 `{ error: 'Account has transactions. Reassign or delete them first.' }` and `{ error: 'Category has transactions. Reassign or delete them first.' }` on referenced deletes

### Steps

- [ ] **8.1 (RED, cycle A) Referenced-check query tests.** Append to `apps/backend/test/queries.test.ts` (add both functions to the import):

```ts
  it('accountHasTransactions checks source and destination references', async () => {
    const db = fakeDb([{ referenced: true }])
    expect(await accountHasTransactions(db, 'a1')).toBe(true)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/select exists/i)
    expect(sql).toMatch(/account_id = \$1 or to_account_id = \$1/i)
    expect(params).toEqual(['a1'])
  })

  it('accountHasTransactions returns false when unreferenced', async () => {
    const db = fakeDb([{ referenced: false }])
    expect(await accountHasTransactions(db, 'a1')).toBe(false)
  })

  it('categoryHasTransactions checks category references', async () => {
    const db = fakeDb([{ referenced: true }])
    expect(await categoryHasTransactions(db, 'c1')).toBe(true)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/select exists/i)
    expect(sql).toMatch(/category_id = \$1/i)
    expect(params).toEqual(['c1'])
  })
```

- [ ] **8.2 Run and expect failure:** `pnpm --filter backend test -- test/queries.test.ts`
  Expected: `SyntaxError: The requested module '../src/db/queries.js' does not provide an export named 'accountHasTransactions'`.

- [ ] **8.3 (GREEN, cycle A) Implement the queries.** Append to `apps/backend/src/db/queries.ts`:

```ts
export async function accountHasTransactions(db: Queryable, accountId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM transactions WHERE account_id = $1 OR to_account_id = $1
     ) AS referenced`,
    [accountId],
  )
  return Boolean(result.rows[0]?.referenced)
}

export async function categoryHasTransactions(db: Queryable, categoryId: string): Promise<boolean> {
  const result = await db.query(
    'SELECT EXISTS (SELECT 1 FROM transactions WHERE category_id = $1) AS referenced',
    [categoryId],
  )
  return Boolean(result.rows[0]?.referenced)
}
```

- [ ] **8.4 Run and expect pass:** `pnpm --filter backend test -- test/queries.test.ts`

- [ ] **8.5 (RED, cycle B) Route guard tests.** Three test files change.

**`apps/backend/test/accounts.test.ts`:** add uuid constants after the import block and update the `:id` tests:

```ts
const accountId = '11111111-1111-4111-8111-111111111111'
const missingId = '99999999-9999-4999-8999-999999999999'

const sampleAccount = { id: accountId, name: 'Cash', type: 'cash', currency: 'PEN' }
```

Replace every `:id` path in existing tests: `'/api/accounts/nope'` becomes `` `/api/accounts/${missingId}` `` (both the GET 404 and DELETE 404 tests) and `'/api/accounts/a1'` becomes `` `/api/accounts/${accountId}` ``. In the PATCH test, the params assertion becomes:

```ts
    expect(updateParams).toEqual([accountId, 'Wallet', 'cash', 'PEN'])
```

Update the `DELETE /api/accounts/:id deletes when present` test to account for the new referenced check between the fetch and the delete:

```ts
  it('DELETE /api/accounts/:id deletes when unreferenced', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleAccount] })
        .mockResolvedValueOnce({ rows: [{ referenced: false }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const route = createAccountsRoute(() => db)
    const response = await route.request(`/api/accounts/${accountId}`, { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })
```

Append the new tests:

```ts
  it('DELETE /api/accounts/:id returns 409 when transactions reference the account', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleAccount] })
        .mockResolvedValueOnce({ rows: [{ referenced: true }] }),
    }
    const route = createAccountsRoute(() => db)
    const response = await route.request(`/api/accounts/${accountId}`, { method: 'DELETE' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Account has transactions. Reassign or delete them first.',
    })
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it.each(['GET', 'PATCH', 'DELETE'])('%s /api/accounts/:id returns 400 on a malformed id', async (method) => {
    const db = { query: vi.fn() }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts/not-a-uuid', {
      method,
      ...(method === 'PATCH'
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) }
        : {}),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid account id' })
    expect(db.query).not.toHaveBeenCalled()
  })
```

**`apps/backend/test/categories.test.ts`:** mirror the same changes with:

```ts
const categoryId = '33333333-3333-4333-8333-333333333333'
const missingId = '99999999-9999-4999-8999-999999999999'

const sampleCategory = { id: categoryId, name: 'Food', type: 'expense' }
```

Path replacements: `'/api/categories/nope'` becomes `` `/api/categories/${missingId}` ``, `'/api/categories/c1'` becomes `` `/api/categories/${categoryId}` ``. PATCH params assertion becomes `[categoryId, 'Groceries', 'expense']`. The delete-present test gains the middle `{ rows: [{ referenced: false }] }` mock exactly like accounts. New tests:

```ts
  it('DELETE /api/categories/:id returns 409 when transactions reference the category', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleCategory] })
        .mockResolvedValueOnce({ rows: [{ referenced: true }] }),
    }
    const route = createCategoriesRoute(() => db)
    const response = await route.request(`/api/categories/${categoryId}`, { method: 'DELETE' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Category has transactions. Reassign or delete them first.',
    })
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it.each(['GET', 'PATCH', 'DELETE'])('%s /api/categories/:id returns 400 on a malformed id', async (method) => {
    const db = { query: vi.fn() }
    const route = createCategoriesRoute(() => db)
    const response = await route.request('/api/categories/not-a-uuid', {
      method,
      ...(method === 'PATCH'
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) }
        : {}),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid category id' })
    expect(db.query).not.toHaveBeenCalled()
  })
```

**`apps/backend/test/transactions.test.ts`:** append to the `transactions route: read and delete` describe block (the Task 5 rewrite already uses uuid ids everywhere else, so nothing else changes):

```ts
  it.each(['GET', 'PATCH', 'DELETE'])('%s /api/transactions/:id returns 400 on a malformed id', async (method) => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/not-a-uuid', {
      method,
      ...(method === 'PATCH'
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ description: 'Tea' }),
          }
        : {}),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid transaction id' })
    expect(db.query).not.toHaveBeenCalled()
  })
```

- [ ] **8.6 Run and expect failure:** `pnpm --filter backend test -- test/accounts.test.ts test/categories.test.ts test/transactions.test.ts`
  Expected: the new 400 tests fail with `expected 404 to be 400` (the old handlers treat a malformed id as a missing row) or `expected 200 to be 400`; the 409 tests fail with `expected 200 to be 409`; the reworked delete-present tests fail because the extra mocked EXISTS response shifts the call sequence (`expected { rows: [ { referenced: false } ] } ...` style mismatches).

- [ ] **8.7 (GREEN, cycle B) Implement the guards.**

**`apps/backend/src/routes/accounts.ts`:** add `accountHasTransactions` to the queries import and `isUuid` to the validation import. Add this guard as the first statement of the GET `:id`, PATCH, and DELETE handlers (in the GET handler, hoist `const id = context.req.param('id')` above the `try`):

```ts
    const id = context.req.param('id')
    if (!isUuid(id)) return context.json({ error: 'Invalid account id' }, 400)
```

(In the GET handler, change `getAccountById(resolveDb(), context.req.param('id'))` to use the hoisted `id`.) Then insert the referenced check into the DELETE handler between the 404 check and the delete:

```ts
      if (await accountHasTransactions(db, id)) {
        return context.json(
          { error: 'Account has transactions. Reassign or delete them first.' },
          409,
        )
      }
```

**`apps/backend/src/routes/categories.ts`:** same pattern with `categoryHasTransactions`, error strings `'Invalid category id'` and `'Category has transactions. Reassign or delete them first.'`.

**`apps/backend/src/routes/transactions.ts`:** add the guard to the GET `:id`, PATCH, and DELETE handlers (hoisting `id` in the GET handler as above):

```ts
    if (!isUuid(id)) return context.json({ error: 'Invalid transaction id' }, 400)
```

- [ ] **8.8 Run and expect pass:** `pnpm --filter backend test -- test/accounts.test.ts test/categories.test.ts test/transactions.test.ts test/queries.test.ts`

- [ ] **8.9 Full verification:** `pnpm --filter backend test` and `pnpm --filter backend typecheck`. Also run the repo-wide gate the plan requires between sections: `pnpm -r typecheck && pnpm -r test`.

- [ ] **8.10 Commit:** run `commita --no-push` and confirm it created a commit.

Context for the executor:

- All paths are relative to the repo root `/home/misaelabanto/code/openlinks/spend-tracker` unless written absolute.
- The web app lives in `apps/web`. Path alias `@` resolves to `apps/web/src`. Router is `react-router` v8 (import `useSearchParams`, `MemoryRouter`, etc. from `'react-router'`). Data layer is `@tanstack/react-query` v5.
- Every web test mocks `fetch`, so no backend or database is needed to run these tasks. The backend tasks (1 to 8, other plan sections) define the API contract these tasks code against; the shapes are restated in each task's Interfaces block.
- Run a single web test file with: `pnpm --filter web test -- <path relative to apps/web>`.
- Commits: every commit step is exactly `commita --no-push`. Never `git add` or `git commit`.
- Style: no em dashes anywhere, meaningful variable names always (no single-letter domain bindings).

---

## Task 9: Web test infrastructure, upgraded types, filterParams module, hooks rework

**Files:**
- Modify: `apps/web/package.json` (devDependencies + `test` script)
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/test/factories.ts`
- Create: `apps/web/src/test/apiStub.ts`
- Create: `apps/web/src/test/render.tsx`
- Modify: `apps/web/src/types.ts` (full rewrite)
- Create: `apps/web/src/lib/filterParams.ts`
- Create: `apps/web/src/lib/filterParams.test.ts`
- Modify: `apps/web/src/lib/api.ts` (list-page function, currencies api, settings api, list bridge)
- Modify: `apps/web/src/hooks/useTransactions.ts` (add `useTransactionsInfinite`)
- Create: `apps/web/src/hooks/useCurrencies.ts`
- Create: `apps/web/src/hooks/useSettings.ts`
- Create: `apps/web/src/hooks/useTransactionsInfinite.test.tsx`
- Modify (compile shims only, replaced in later tasks): `apps/web/src/components/transactions/TransactionFormDialog.tsx`, `apps/web/src/pages/TransactionsPage.tsx`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/components/SpendingByCategory.tsx`

**Interfaces:**

Consumes (backend contract from Tasks 4 to 6 of the backend sections; mocked in tests):
- `GET /api/transactions?...` -> `{ items: Transaction[], next_cursor: string | null, totals: { count, by_currency: { currency, sum }[], base: { currency, sum: number | null } } }`, query params `from, to, account_ids, category_ids, uncategorized, tags, tag_mode, amount_min, amount_max, currency, type, search, sort, order, cursor, limit`
- `GET /api/currencies` -> `Currency[]`
- `GET /api/settings` -> `Settings`; `PUT /api/settings` body `{ base_currency_code: string }` -> `Settings`

Produces (consumed by Tasks 10 to 13):
- `@/types`: `TransactionType`, `Transaction` (new row shape), `NewTransaction`, `TransactionUpdate`, `Currency`, `Settings`, `TransactionFilters`, `TransactionTotals`, `TransactionListResponse`
- `@/lib/filterParams`: `filtersToSearchParams(filters: TransactionFilters): URLSearchParams`, `searchParamsToFilters(params: URLSearchParams): TransactionFilters`, `filtersToApiSearchParams(filters: TransactionFilters): URLSearchParams`
- `@/lib/api`: `listTransactionsPage(filters: TransactionFilters, cursor: string | null): Promise<TransactionListResponse>`, `currenciesApi.list(): Promise<Currency[]>`, `settingsApi.get(): Promise<Settings>`, `settingsApi.update(payload: { base_currency_code: string }): Promise<Settings>`
- `@/hooks/useTransactions`: `useTransactionsInfinite(filters: TransactionFilters)` (an `useInfiniteQuery` result)
- `@/hooks/useCurrencies`: `useCurrencies()`
- `@/hooks/useSettings`: `useSettings()`, `useUpdateSettings()`
- `@/test/factories`: `makeTransaction(overrides?: Partial<Transaction>): Transaction`
- `@/test/apiStub`: `jsonResponse(data: unknown): Response`, `stubApiFetch(routes: { match: string; data: unknown | ((url: string) => unknown) }[]): { fetchMock, requestedUrls(): string[] }`
- `@/test/render`: `renderWithClient(ui: ReactElement)`, `createQueryWrapper()`

### Steps

- [ ] **9.1 Install test dependencies**

  ```bash
  pnpm --filter web add -D vitest jsdom @testing-library/react @testing-library/user-event
  ```

  Then edit `apps/web/package.json` scripts, adding a `test` script (keep the existing scripts untouched):

  ```json
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "preview": "vite preview"
  }
  ```

- [ ] **9.2 Create the vitest config and test setup**

  Create `apps/web/vitest.config.ts` (shares the `@` alias with `vite.config.ts`; skips the tailwind plugin, which tests do not need):

  ```ts
  import { fileURLToPath, URL } from 'node:url'
  import react from '@vitejs/plugin-react'
  import { defineConfig } from 'vitest/config'

  export default defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test/setup.ts'],
    },
  })
  ```

  Create `apps/web/src/test/setup.ts` (jsdom polyfills that Radix UI primitives need):

  ```ts
  // jsdom lacks several DOM APIs that Radix UI (Select, Popover, Dialog) relies on.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
  }

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
  ```

- [ ] **9.3 Write the failing filterParams test**

  Create `apps/web/src/lib/filterParams.test.ts` with the complete test file:

  ```ts
  import { describe, expect, it } from 'vitest'
  import {
    filtersToApiSearchParams,
    filtersToSearchParams,
    searchParamsToFilters,
  } from '@/lib/filterParams'
  import type { TransactionFilters } from '@/types'

  describe('filtersToSearchParams', () => {
    it('returns empty params for empty filters', () => {
      expect(filtersToSearchParams({}).toString()).toBe('')
    })

    it('omits default values (tag_mode any, sort occurred_at, order desc)', () => {
      const params = filtersToSearchParams({
        tags: ['food'],
        tagMode: 'any',
        sort: 'occurred_at',
        order: 'desc',
      })
      expect(params.get('tags')).toBe('food')
      expect(params.has('tag_mode')).toBe(false)
      expect(params.has('sort')).toBe(false)
      expect(params.has('order')).toBe(false)
    })

    it('serializes every filter under the URL contract names', () => {
      const params = filtersToSearchParams({
        from: '2026-07-01',
        to: '2026-07-31',
        accountIds: ['acc-1', 'acc-2'],
        categoryIds: ['cat-1'],
        uncategorized: true,
        tags: ['food', 'travel'],
        tagMode: 'none',
        amountMin: 10,
        amountMax: 500.5,
        currency: 'USD',
        type: 'expense',
        search: 'uber',
        sort: 'amount',
        order: 'asc',
      })
      expect(params.get('from')).toBe('2026-07-01')
      expect(params.get('to')).toBe('2026-07-31')
      expect(params.get('accounts')).toBe('acc-1,acc-2')
      expect(params.get('categories')).toBe('cat-1')
      expect(params.get('uncategorized')).toBe('true')
      expect(params.get('tags')).toBe('food,travel')
      expect(params.get('tag_mode')).toBe('none')
      expect(params.get('amount_min')).toBe('10')
      expect(params.get('amount_max')).toBe('500.5')
      expect(params.get('currency')).toBe('USD')
      expect(params.get('type')).toBe('expense')
      expect(params.get('search')).toBe('uber')
      expect(params.get('sort')).toBe('amount')
      expect(params.get('order')).toBe('asc')
    })
  })

  describe('searchParamsToFilters', () => {
    it('round-trips a full filter set', () => {
      const filters: TransactionFilters = {
        from: '2026-07-01',
        to: '2026-07-31',
        accountIds: ['acc-1', 'acc-2'],
        categoryIds: ['cat-1'],
        uncategorized: true,
        tags: ['food', 'travel'],
        tagMode: 'none',
        amountMin: 10,
        amountMax: 500.5,
        currency: 'USD',
        type: 'expense',
        search: 'uber',
        sort: 'amount',
        order: 'asc',
      }
      expect(searchParamsToFilters(filtersToSearchParams(filters))).toEqual(filters)
    })

    it('drops unknown params and unparseable numbers', () => {
      const filters = searchParamsToFilters(
        new URLSearchParams('bogus=1&amount_min=abc&type=nonsense&tag_mode=sometimes'),
      )
      expect(filters).toEqual({})
    })

    it('parses an empty string as no filters', () => {
      expect(searchParamsToFilters(new URLSearchParams(''))).toEqual({})
    })
  })

  describe('filtersToApiSearchParams', () => {
    it('uses the backend param names for account and category lists', () => {
      const params = filtersToApiSearchParams({
        accountIds: ['acc-1', 'acc-2'],
        categoryIds: ['cat-1'],
        type: 'income',
      })
      expect(params.get('account_ids')).toBe('acc-1,acc-2')
      expect(params.get('category_ids')).toBe('cat-1')
      expect(params.get('type')).toBe('income')
      expect(params.has('accounts')).toBe(false)
      expect(params.has('categories')).toBe(false)
    })
  })
  ```

- [ ] **9.4 Run the test, expect failure**

  ```bash
  pnpm --filter web test -- src/lib/filterParams.test.ts
  ```

  Expected failure: `Failed to resolve import "@/lib/filterParams"` (the module does not exist yet).

- [ ] **9.5 Rewrite `apps/web/src/types.ts`**

  Replace the whole file with:

  ```ts
  export interface Category {
    id: string
    name: string
    type: string
  }

  export interface NewCategory {
    name: string
    type: string
  }

  export interface CategoryUpdate {
    name?: string
    type?: string
  }

  export interface Account {
    id: string
    name: string
    type: string
    currency: string
  }

  export interface NewAccount {
    name: string
    type: string
    currency: string
  }

  export interface AccountUpdate {
    name?: string
    type?: string
    currency?: string
  }

  export type TransactionType = 'expense' | 'income' | 'transfer'

  // Mirrors the backend transactions row (apps/backend/src/db/types.ts).
  export interface Transaction {
    id: string
    description: string
    amount: number
    currency: string
    account_id: string
    category_id: string | null
    tags: string[]
    type: TransactionType
    payee: string | null
    notes: string | null
    occurred_at: string
    base_amount: number | null
    rate_used: number | null
    to_account_id: string | null
    to_amount: number | null
    external_id: string | null
    created_at: string
    updated_at: string | null
  }

  // POST /api/transactions body. Amount is always positive; the server derives
  // the stored sign from `type`.
  export interface NewTransaction {
    description: string
    amount: number
    currency: string
    account_id: string
    category_id?: string | null
    tags?: string[]
    type: TransactionType
    payee?: string | null
    notes?: string | null
    occurred_at?: string
    base_amount?: number | null
    rate_used?: number | null
    to_account_id?: string | null
    to_amount?: number | null
    external_id?: string
  }

  export interface TransactionUpdate {
    description?: string
    amount?: number
    currency?: string
    account_id?: string
    category_id?: string | null
    tags?: string[]
    type?: TransactionType
    payee?: string | null
    notes?: string | null
    occurred_at?: string
    base_amount?: number | null
    rate_used?: number | null
    to_account_id?: string | null
    to_amount?: number | null
  }

  export interface Currency {
    code: string
    name: string
    symbol: string
    decimal_places: number
  }

  export interface Settings {
    id: number
    base_currency_code: string
  }

  export interface TransactionFilters {
    from?: string
    to?: string
    accountIds?: string[]
    categoryIds?: string[]
    uncategorized?: boolean
    tags?: string[]
    tagMode?: 'any' | 'all' | 'none'
    amountMin?: number
    amountMax?: number
    currency?: string
    type?: TransactionType
    search?: string
    sort?: 'occurred_at' | 'amount'
    order?: 'desc' | 'asc'
  }

  export interface TransactionTotals {
    count: number
    by_currency: { currency: string; sum: number }[]
    base: { currency: string; sum: number | null }
  }

  export interface TransactionListResponse {
    items: Transaction[]
    next_cursor: string | null
    totals: TransactionTotals
  }
  ```

- [ ] **9.6 Implement `apps/web/src/lib/filterParams.ts`**

  ```ts
  import type { TransactionFilters, TransactionType } from '@/types'

  const tagModes = ['any', 'all', 'none'] as const
  const transactionTypes = ['expense', 'income', 'transfer'] as const
  const sortFields = ['occurred_at', 'amount'] as const
  const sortOrders = ['desc', 'asc'] as const

  function parseList(value: string | null): string[] | undefined {
    if (!value) return undefined
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    return items.length > 0 ? items : undefined
  }

  function parseNumber(value: string | null): number | undefined {
    if (value === null || value === '') return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  function parseOneOf<Option extends string>(
    value: string | null,
    options: readonly Option[],
  ): Option | undefined {
    return options.includes(value as Option) ? (value as Option) : undefined
  }

  function appendFilterParams(
    params: URLSearchParams,
    filters: TransactionFilters,
    accountsKey: string,
    categoriesKey: string,
  ): URLSearchParams {
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.accountIds && filters.accountIds.length > 0)
      params.set(accountsKey, filters.accountIds.join(','))
    if (filters.categoryIds && filters.categoryIds.length > 0)
      params.set(categoriesKey, filters.categoryIds.join(','))
    if (filters.uncategorized) params.set('uncategorized', 'true')
    if (filters.tags && filters.tags.length > 0) params.set('tags', filters.tags.join(','))
    if (filters.tagMode && filters.tagMode !== 'any') params.set('tag_mode', filters.tagMode)
    if (filters.amountMin !== undefined) params.set('amount_min', String(filters.amountMin))
    if (filters.amountMax !== undefined) params.set('amount_max', String(filters.amountMax))
    if (filters.currency) params.set('currency', filters.currency)
    if (filters.type) params.set('type', filters.type)
    if (filters.search) params.set('search', filters.search)
    if (filters.sort && filters.sort !== 'occurred_at') params.set('sort', filters.sort)
    if (filters.order && filters.order !== 'desc') params.set('order', filters.order)
    return params
  }

  // URL contract for the transactions page (accounts/categories are the
  // human-facing names in the address bar).
  export function filtersToSearchParams(filters: TransactionFilters): URLSearchParams {
    return appendFilterParams(new URLSearchParams(), filters, 'accounts', 'categories')
  }

  // Same serialization, but with the backend's account_ids/category_ids names.
  export function filtersToApiSearchParams(filters: TransactionFilters): URLSearchParams {
    return appendFilterParams(new URLSearchParams(), filters, 'account_ids', 'category_ids')
  }

  export function searchParamsToFilters(params: URLSearchParams): TransactionFilters {
    const filters: TransactionFilters = {}
    const from = params.get('from')
    if (from) filters.from = from
    const to = params.get('to')
    if (to) filters.to = to
    const accountIds = parseList(params.get('accounts'))
    if (accountIds) filters.accountIds = accountIds
    const categoryIds = parseList(params.get('categories'))
    if (categoryIds) filters.categoryIds = categoryIds
    if (params.get('uncategorized') === 'true') filters.uncategorized = true
    const tags = parseList(params.get('tags'))
    if (tags) filters.tags = tags
    const tagMode = parseOneOf(params.get('tag_mode'), tagModes)
    if (tagMode && tagMode !== 'any') filters.tagMode = tagMode
    const amountMin = parseNumber(params.get('amount_min'))
    if (amountMin !== undefined) filters.amountMin = amountMin
    const amountMax = parseNumber(params.get('amount_max'))
    if (amountMax !== undefined) filters.amountMax = amountMax
    const currency = params.get('currency')
    if (currency) filters.currency = currency
    const type = parseOneOf<TransactionType>(params.get('type'), transactionTypes)
    if (type) filters.type = type
    const search = params.get('search')
    if (search) filters.search = search
    const sort = parseOneOf(params.get('sort'), sortFields)
    if (sort && sort !== 'occurred_at') filters.sort = sort
    const order = parseOneOf(params.get('order'), sortOrders)
    if (order && order !== 'desc') filters.order = order
    return filters
  }
  ```

- [ ] **9.7 Run the filterParams test, expect pass**

  ```bash
  pnpm --filter web test -- src/lib/filterParams.test.ts
  ```

  All tests pass.

- [ ] **9.8 Apply compile shims so the type upgrade keeps the app building**

  These are temporary bridges. Tasks 10 to 13 replace them with the real redesign.

  In `apps/web/src/components/transactions/TransactionFormDialog.tsx`:

  1. Extend the type import: `import type { Account, Category, NewTransaction, Transaction, TransactionType, TransactionUpdate } from '@/types'`
  2. In the `useEffect` that seeds edit state, replace

     ```ts
     categoryId: transaction.category_id,
     ```

     with

     ```ts
     categoryId: transaction.category_id ?? '',
     ```

     and replace

     ```ts
     date: toDatetimeLocalValue(transaction.created_at),
     ```

     with

     ```ts
     date: toDatetimeLocalValue(transaction.occurred_at),
     ```

  3. Replace the whole `handleSubmit` function with (bridge: derives type from the signed amount the old form still collects; Task 10 replaces this form entirely):

     ```ts
     function handleSubmit(event: FormEvent<HTMLFormElement>) {
       event.preventDefault()
       const occurredAt = formState.date ? new Date(formState.date).toISOString() : undefined
       const signedAmount = Number(formState.amount)
       const bridgeType: TransactionType = signedAmount >= 0 ? 'income' : 'expense'
       const payload = {
         description: formState.description,
         amount: Math.abs(signedAmount),
         currency: formState.currency,
         account_id: formState.accountId,
         category_id: formState.categoryId,
         tags: parseTags(formState.tags),
         type: bridgeType,
         occurred_at: occurredAt,
       }
       if (isEditing && transaction) {
         onUpdate(transaction.id, payload)
         return
       }
       onCreate(payload)
     }
     ```

  In `apps/web/src/pages/TransactionsPage.tsx`, replace the `categoryName` prop expression

  ```tsx
  categoryName={
    categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
  }
  ```

  with

  ```tsx
  categoryName={
    transaction.category_id
      ? categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
      : 'Uncategorized'
  }
  ```

  In `apps/web/src/pages/DashboardPage.tsx`, apply the same `categoryName` replacement (identical old and new code as above).

  In `apps/web/src/components/SpendingByCategory.tsx`, replace both occurrences of

  ```ts
  const categoryName = categoryNameById.get(expense.category_id) ?? 'Uncategorized'
  ```

  with

  ```ts
  const categoryName = categoryNameById.get(expense.category_id ?? '') ?? 'Uncategorized'
  ```

- [ ] **9.9 Create the shared test utilities**

  Create `apps/web/src/test/factories.ts`:

  ```ts
  import type { Transaction } from '@/types'

  let transactionCounter = 0

  export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
    transactionCounter += 1
    return {
      id: `00000000-0000-4000-8000-${String(transactionCounter).padStart(12, '0')}`,
      description: 'Coffee',
      amount: -10,
      currency: 'PEN',
      account_id: 'acc-1',
      category_id: 'cat-1',
      tags: [],
      type: 'expense',
      payee: null,
      notes: null,
      occurred_at: '2026-07-10T12:00:00.000Z',
      base_amount: -10,
      rate_used: 1,
      to_account_id: null,
      to_amount: null,
      external_id: null,
      created_at: '2026-07-10T12:00:00.000Z',
      updated_at: null,
      ...overrides,
    }
  }
  ```

  Create `apps/web/src/test/apiStub.ts`:

  ```ts
  import { vi } from 'vitest'

  export function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  interface ApiRoute {
    match: string
    data: unknown | ((url: string) => unknown)
  }

  export interface ApiStub {
    fetchMock: ReturnType<typeof vi.fn>
    requestedUrls: () => string[]
  }

  // Replaces global fetch with a router over substring matches. First match wins,
  // so list more specific routes first.
  export function stubApiFetch(routes: ApiRoute[]): ApiStub {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      for (const route of routes) {
        if (url.includes(route.match)) {
          const data =
            typeof route.data === 'function'
              ? (route.data as (requestUrl: string) => unknown)(url)
              : route.data
          return jsonResponse(data)
        }
      }
      return new Response(JSON.stringify({ error: `Unmatched request: ${url}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    return {
      fetchMock,
      requestedUrls: () => fetchMock.mock.calls.map((call) => String(call[0])),
    }
  }
  ```

  Create `apps/web/src/test/render.tsx`:

  ```tsx
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import { render } from '@testing-library/react'
  import type { ReactElement, ReactNode } from 'react'

  function makeQueryClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
  }

  export function renderWithClient(ui: ReactElement) {
    const queryClient = makeQueryClient()
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  }

  export function createQueryWrapper() {
    const queryClient = makeQueryClient()
    return function QueryWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
  }
  ```

- [ ] **9.10 Write the failing hook test**

  Create `apps/web/src/hooks/useTransactionsInfinite.test.tsx`:

  ```tsx
  import { renderHook, waitFor } from '@testing-library/react'
  import { afterEach, describe, expect, it, vi } from 'vitest'
  import { useTransactionsInfinite } from '@/hooks/useTransactions'
  import { stubApiFetch } from '@/test/apiStub'
  import { makeTransaction } from '@/test/factories'
  import { createQueryWrapper } from '@/test/render'
  import type { TransactionTotals } from '@/types'

  const totals: TransactionTotals = {
    count: 2,
    by_currency: [{ currency: 'PEN', sum: -20 }],
    base: { currency: 'PEN', sum: -20 },
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('useTransactionsInfinite', () => {
    it('requests mapped filter params and follows next_cursor', async () => {
      const firstPage = { items: [makeTransaction()], next_cursor: 'CURSOR1', totals }
      const secondPage = { items: [makeTransaction()], next_cursor: null, totals }
      const apiStub = stubApiFetch([
        {
          match: '/transactions',
          data: (url: string) => (url.includes('cursor=CURSOR1') ? secondPage : firstPage),
        },
      ])

      const { result } = renderHook(
        () => useTransactionsInfinite({ type: 'expense', accountIds: ['acc-1', 'acc-2'] }),
        { wrapper: createQueryWrapper() },
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      const firstUrl = apiStub.requestedUrls()[0]
      expect(firstUrl).toContain('type=expense')
      expect(firstUrl).toContain(`account_ids=${encodeURIComponent('acc-1,acc-2')}`)

      await result.current.fetchNextPage()
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
      expect(apiStub.requestedUrls()[1]).toContain('cursor=CURSOR1')
      expect(result.current.hasNextPage).toBe(false)
    })
  })
  ```

- [ ] **9.11 Run the hook test, expect failure**

  ```bash
  pnpm --filter web test -- src/hooks/useTransactionsInfinite.test.tsx
  ```

  Expected failure: `useTransactionsInfinite` is not exported from `@/hooks/useTransactions` (SyntaxError about a missing export, or a TypeError calling undefined).

- [ ] **9.12 Implement the api additions and hooks**

  In `apps/web/src/lib/api.ts`:

  1. Extend the imports at the top:

     ```ts
     import { filtersToApiSearchParams } from '@/lib/filterParams'
     import type {
       Account,
       AccountUpdate,
       Category,
       CategoryUpdate,
       Currency,
       NewAccount,
       NewCategory,
       NewTransaction,
       Settings,
       Transaction,
       TransactionFilters,
       TransactionListResponse,
       TransactionUpdate,
     } from '@/types'
     ```

  2. Replace the line

     ```ts
     export const transactionsApi = createResourceApi<Transaction, NewTransaction, TransactionUpdate>(
       'transactions',
     )
     ```

     with

     ```ts
     const transactionsResource = createResourceApi<Transaction, NewTransaction, TransactionUpdate>(
       'transactions',
     )

     // Bridge: GET /api/transactions now returns a paginated envelope. Old pages
     // still consume a flat array until they move to useTransactionsInfinite
     // (Tasks 11 to 13), so list() unwraps the first page.
     export const transactionsApi = {
       ...transactionsResource,
       list: () =>
         request<TransactionListResponse>('/transactions?limit=200').then((page) => page.items),
     }

     export function listTransactionsPage(
       filters: TransactionFilters,
       cursor: string | null,
     ): Promise<TransactionListResponse> {
       const params = filtersToApiSearchParams(filters)
       if (cursor) params.set('cursor', cursor)
       const query = params.toString()
       return request<TransactionListResponse>(`/transactions${query ? `?${query}` : ''}`)
     }

     export const currenciesApi = {
       list: () => request<Currency[]>('/currencies'),
     }

     export const settingsApi = {
       get: () => request<Settings>('/settings'),
       update: (payload: { base_currency_code: string }) =>
         request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
     }
     ```

  Replace `apps/web/src/hooks/useTransactions.ts` with:

  ```ts
  import { useInfiniteQuery } from '@tanstack/react-query'
  import { listTransactionsPage, transactionsApi } from '@/lib/api'
  import type { NewTransaction, Transaction, TransactionFilters, TransactionUpdate } from '@/types'
  import { createResourceHooks } from './createResourceHooks'

  const transactionHooks = createResourceHooks<Transaction, NewTransaction, TransactionUpdate>(
    'transactions',
    transactionsApi,
  )

  export const useTransactions = transactionHooks.useList
  export const useCreateTransaction = transactionHooks.useCreate
  export const useUpdateTransaction = transactionHooks.useUpdate
  export const useDeleteTransaction = transactionHooks.useRemove

  // Cursor-paginated ledger. The key starts with 'transactions' so the CRUD
  // mutations above invalidate these pages too.
  export function useTransactionsInfinite(filters: TransactionFilters) {
    return useInfiniteQuery({
      queryKey: ['transactions', 'infinite', filters],
      queryFn: ({ pageParam }) => listTransactionsPage(filters, pageParam),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.next_cursor,
    })
  }
  ```

  Create `apps/web/src/hooks/useCurrencies.ts`:

  ```ts
  import { useQuery } from '@tanstack/react-query'
  import { currenciesApi } from '@/lib/api'

  const currenciesKey = ['currencies'] as const

  // The ISO 4217 list never changes within a session.
  export function useCurrencies() {
    return useQuery({
      queryKey: currenciesKey,
      queryFn: currenciesApi.list,
      staleTime: Infinity,
    })
  }
  ```

  Create `apps/web/src/hooks/useSettings.ts`:

  ```ts
  import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
  import { settingsApi } from '@/lib/api'

  const settingsKey = ['settings'] as const

  export function useSettings() {
    return useQuery({
      queryKey: settingsKey,
      queryFn: settingsApi.get,
      staleTime: 5 * 60 * 1000,
    })
  }

  export function useUpdateSettings() {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: settingsApi.update,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKey }),
    })
  }
  ```

- [ ] **9.13 Run all web tests and the typecheck, expect pass**

  ```bash
  pnpm --filter web test
  pnpm --filter web typecheck
  ```

  Both commands succeed (the shims from step 9.8 keep the old pages compiling).

- [ ] **9.14 Commit**

  Run `commita --no-push` and confirm it created a commit.

---

## Task 10: TransactionFormDialog redesign (type control, positive amount, currency, payee, transfers, base override)

**Files:**
- Modify: `apps/web/src/components/transactions/TransactionFormDialog.tsx` (full rewrite, replacing the Task 9 shim)
- Modify: `apps/web/src/pages/TransactionsPage.tsx` (derive `existingPayees` and `payeeCategoryHistory`, pass them to the dialog)
- Create: `apps/web/src/components/transactions/TransactionFormDialog.test.tsx`

**Interfaces:**

Consumes:
- `@/hooks/useCurrencies`: `useCurrencies()` -> query of `Currency[]` (Task 9)
- `@/hooks/useSettings`: `useSettings()` -> query of `Settings` (Task 9)
- `@/types`: `Account`, `Category`, `Currency`, `NewTransaction`, `Transaction`, `TransactionType`, `TransactionUpdate` (Task 9)
- `@/lib/utils`: `toDatetimeLocalValue` (existing)

Produces (consumed by Task 11's page rewrite):
- `TransactionFormDialog` component with props:
  ```ts
  interface TransactionFormDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    accounts: Account[]
    categories: Category[]
    existingPayees: string[]
    payeeCategoryHistory: Record<string, string>
    transaction: Transaction | null
    isSubmitting: boolean
    errorMessage: string | null
    onCreate: (payload: NewTransaction) => void
    onUpdate: (transactionId: string, payload: TransactionUpdate) => void
  }
  ```
  The dialog itself calls `useCurrencies()` and `useSettings()`, so any test or page that renders it must provide a `QueryClientProvider` and stub `/api/currencies` and `/api/settings`.
  `payeeCategoryHistory` maps a payee name to the category id of the most recent transaction recorded for that payee. When the payee field's value exactly matches a key in this map, the category select is pre-filled with the matching category id, unless the type is transfer (transfers have no category field).

### Steps

- [ ] **10.1 Write the failing component test**

  Create `apps/web/src/components/transactions/TransactionFormDialog.test.tsx`:

  ```tsx
  import { screen, waitFor, within } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { afterEach, describe, expect, it, vi } from 'vitest'
  import { TransactionFormDialog } from '@/components/transactions/TransactionFormDialog'
  import { stubApiFetch } from '@/test/apiStub'
  import { renderWithClient } from '@/test/render'
  import type { Account, Category } from '@/types'

  const accounts: Account[] = [
    { id: 'acc-pen', name: 'Cash', type: 'cash', currency: 'PEN' },
    { id: 'acc-usd', name: 'BCP USD', type: 'checking', currency: 'USD' },
  ]

  const categories: Category[] = [
    { id: 'cat-food', name: 'Food', type: 'expense' },
    { id: 'cat-salary', name: 'Salary', type: 'income' },
  ]

  function stubReferenceData() {
    return stubApiFetch([
      {
        match: '/currencies',
        data: [
          { code: 'PEN', name: 'Sol', symbol: 'S/', decimal_places: 2 },
          { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 },
        ],
      },
      { match: '/settings', data: { id: 1, base_currency_code: 'PEN' } },
    ])
  }

  function renderDialog(overrides: Partial<Parameters<typeof TransactionFormDialog>[0]> = {}) {
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    renderWithClient(
      <TransactionFormDialog
        open
        onOpenChange={() => {}}
        accounts={accounts}
        categories={categories}
        existingPayees={['Uber', 'Wong']}
        payeeCategoryHistory={{}}
        transaction={null}
        isSubmitting={false}
        errorMessage={null}
        onCreate={onCreate}
        onUpdate={onUpdate}
        {...overrides}
      />,
    )
    return { onCreate, onUpdate }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('TransactionFormDialog', () => {
    it('carries the sign in the type and swaps category for a destination account', async () => {
      const user = userEvent.setup()
      stubReferenceData()
      const { onCreate } = renderDialog()

      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('PEN'),
      )
      await user.type(screen.getByLabelText('Description'), 'Lunch')
      await user.type(screen.getByLabelText('Amount'), '12.5')
      await user.click(screen.getByRole('button', { name: 'Create transaction' }))

      expect(onCreate).toHaveBeenCalledTimes(1)
      expect(onCreate.mock.calls[0][0]).toMatchObject({
        type: 'expense',
        amount: 12.5,
        category_id: 'cat-food',
      })

      await user.click(screen.getByRole('button', { name: 'Income' }))
      await user.click(screen.getByRole('button', { name: 'Create transaction' }))
      expect(onCreate.mock.calls[1][0]).toMatchObject({
        type: 'income',
        amount: 12.5,
        category_id: 'cat-salary',
      })

      await user.click(screen.getByRole('button', { name: 'Transfer' }))
      expect(screen.queryByRole('combobox', { name: 'Category' })).toBeNull()
      expect(screen.getByRole('combobox', { name: 'Destination account' })).toBeInTheDocument()
    })

    it('follows the selected account currency', async () => {
      const user = userEvent.setup()
      stubReferenceData()
      renderDialog()

      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('PEN'),
      )
      await user.click(screen.getByRole('combobox', { name: 'Account' }))
      await user.click(await screen.findByRole('option', { name: 'BCP USD' }))

      expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('USD')
    })

    it('requires a destination account and amount for transfers', async () => {
      const user = userEvent.setup()
      stubReferenceData()
      const { onCreate } = renderDialog()

      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('PEN'),
      )
      await user.type(screen.getByLabelText('Description'), 'Move money')
      await user.type(screen.getByLabelText('Amount'), '100')
      await user.click(screen.getByRole('button', { name: 'Transfer' }))

      const submit = screen.getByRole('button', { name: 'Create transaction' })
      expect(submit).toBeDisabled()

      await user.click(screen.getByRole('combobox', { name: 'Destination account' }))
      await user.click(await screen.findByRole('option', { name: 'BCP USD' }))
      const destinationAmount = screen.getByLabelText('Destination amount')
      await user.clear(destinationAmount)
      await user.type(destinationAmount, '26.7')

      expect(submit).toBeEnabled()
      await user.click(submit)
      expect(onCreate).toHaveBeenCalledTimes(1)
      expect(onCreate.mock.calls[0][0]).toMatchObject({
        type: 'transfer',
        amount: 100,
        to_account_id: 'acc-usd',
        to_amount: 26.7,
        category_id: null,
      })
      const [payload] = onCreate.mock.calls[0]
      expect(within(document.body).queryByText('Category')).toBeNull()
      expect(payload.account_id).toBe('acc-pen')
    })

    it('pre-fills the last category used for a known payee', async () => {
      const user = userEvent.setup()
      stubReferenceData()
      const { onCreate } = renderDialog({ payeeCategoryHistory: { Wong: 'cat-food' } })

      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('PEN'),
      )
      await user.type(screen.getByLabelText('Payee'), 'Wong')
      expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Food')

      await user.type(screen.getByLabelText('Description'), 'Groceries')
      await user.type(screen.getByLabelText('Amount'), '25')
      await user.click(screen.getByRole('button', { name: 'Create transaction' }))

      expect(onCreate.mock.calls[0][0]).toMatchObject({ payee: 'Wong', category_id: 'cat-food' })
    })
  })
  ```

- [ ] **10.2 Run the test, expect failure**

  ```bash
  pnpm --filter web test -- src/components/transactions/TransactionFormDialog.test.tsx
  ```

  Expected failure: the current shim form has no `Transfer` button and no `Destination account` combobox, so `getByRole('button', { name: 'Transfer' })` throws "Unable to find an accessible element".

- [ ] **10.3 Rewrite `apps/web/src/components/transactions/TransactionFormDialog.tsx`**

  Replace the whole file with:

  ```tsx
  import { useEffect, useMemo, useState, type FormEvent } from 'react'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '@/components/ui/dialog'
  import { Button } from '@/components/ui/button'
  import { DateTimePicker } from '@/components/ui/date-time-picker'
  import { Input } from '@/components/ui/input'
  import { Label } from '@/components/ui/label'
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '@/components/ui/select'
  import { useCurrencies } from '@/hooks/useCurrencies'
  import { useSettings } from '@/hooks/useSettings'
  import { cn, toDatetimeLocalValue } from '@/lib/utils'
  import type {
    Account,
    Category,
    NewTransaction,
    Transaction,
    TransactionType,
    TransactionUpdate,
  } from '@/types'

  interface TransactionFormDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    accounts: Account[]
    categories: Category[]
    existingPayees: string[]
    payeeCategoryHistory: Record<string, string>
    transaction: Transaction | null
    isSubmitting: boolean
    errorMessage: string | null
    onCreate: (payload: NewTransaction) => void
    onUpdate: (transactionId: string, payload: TransactionUpdate) => void
  }

  interface TransactionFormState {
    type: TransactionType
    description: string
    amount: string
    currency: string
    accountId: string
    categoryId: string
    toAccountId: string
    toAmount: string
    payee: string
    notes: string
    baseAmount: string
    tags: string
    date: string
  }

  const typeOptions: { value: TransactionType; label: string }[] = [
    { value: 'expense', label: 'Expense' },
    { value: 'income', label: 'Income' },
    { value: 'transfer', label: 'Transfer' },
  ]

  const textareaClassName =
    'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

  function parseTags(rawTags: string): string[] {
    return rawTags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
  }

  function firstCategoryIdForType(categories: Category[], type: TransactionType): string {
    return categories.find((category) => category.type === type)?.id ?? ''
  }

  export function TransactionFormDialog({
    open,
    onOpenChange,
    accounts,
    categories,
    existingPayees,
    payeeCategoryHistory,
    transaction,
    isSubmitting,
    errorMessage,
    onCreate,
    onUpdate,
  }: TransactionFormDialogProps) {
    const isEditing = transaction !== null
    const currenciesQuery = useCurrencies()
    const settingsQuery = useSettings()
    const currencies = currenciesQuery.data ?? []
    const baseCurrencyCode = settingsQuery.data?.base_currency_code ?? 'PEN'

    const [formState, setFormState] = useState<TransactionFormState>(() => ({
      type: 'expense',
      description: '',
      amount: '',
      currency: 'PEN',
      accountId: '',
      categoryId: '',
      toAccountId: '',
      toAmount: '',
      payee: '',
      notes: '',
      baseAmount: '',
      tags: '',
      date: '',
    }))

    useEffect(() => {
      if (!open) return
      if (transaction) {
        setFormState({
          type: transaction.type,
          description: transaction.description,
          amount: String(Math.abs(transaction.amount ?? 0)),
          currency: transaction.currency,
          accountId: transaction.account_id,
          categoryId: transaction.category_id ?? '',
          toAccountId: transaction.to_account_id ?? '',
          toAmount: transaction.to_amount !== null ? String(Math.abs(transaction.to_amount)) : '',
          payee: transaction.payee ?? '',
          notes: transaction.notes ?? '',
          baseAmount:
            transaction.base_amount !== null ? String(Math.abs(transaction.base_amount)) : '',
          tags: transaction.tags.join(', '),
          date: toDatetimeLocalValue(transaction.occurred_at),
        })
      } else {
        const firstAccount = accounts[0]
        setFormState({
          type: 'expense',
          description: '',
          amount: '',
          currency: firstAccount?.currency ?? 'PEN',
          accountId: firstAccount?.id ?? '',
          categoryId: firstCategoryIdForType(categories, 'expense'),
          toAccountId: '',
          toAmount: '',
          payee: '',
          notes: '',
          baseAmount: '',
          tags: '',
          date: toDatetimeLocalValue(new Date()),
        })
      }
    }, [open, transaction, accounts, categories])

    const categoriesForType = useMemo(
      () => categories.filter((category) => category.type === formState.type),
      [categories, formState.type],
    )

    const destinationAccounts = useMemo(
      () => accounts.filter((account) => account.id !== formState.accountId),
      [accounts, formState.accountId],
    )

    const isTransfer = formState.type === 'transfer'
    const isForeign = formState.currency !== baseCurrencyCode

    function handleTypeChange(nextType: TransactionType) {
      setFormState((current) => ({
        ...current,
        type: nextType,
        categoryId:
          nextType === 'transfer' ? '' : firstCategoryIdForType(categories, nextType),
        toAccountId: nextType === 'transfer' ? current.toAccountId : '',
        toAmount: nextType === 'transfer' ? current.toAmount : '',
      }))
    }

    function handleAccountChange(nextAccountId: string) {
      const nextAccount = accounts.find((account) => account.id === nextAccountId)
      setFormState((current) => ({
        ...current,
        accountId: nextAccountId,
        currency: nextAccount?.currency ?? current.currency,
        toAccountId: current.toAccountId === nextAccountId ? '' : current.toAccountId,
      }))
    }

    function handleDestinationAccountChange(nextAccountId: string) {
      const destination = accounts.find((account) => account.id === nextAccountId)
      setFormState((current) => ({
        ...current,
        toAccountId: nextAccountId,
        // Same-currency transfers just repeat the amount, per the transfer contract.
        toAmount:
          destination && destination.currency === current.currency && current.amount
            ? current.amount
            : current.toAmount,
      }))
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      const occurredAt = formState.date ? new Date(formState.date).toISOString() : undefined
      const amount = Math.abs(Number(formState.amount))
      const baseAmountOverride =
        isForeign && formState.baseAmount.trim() !== ''
          ? Math.abs(Number(formState.baseAmount))
          : undefined
      const common = {
        description: formState.description,
        amount,
        currency: formState.currency,
        account_id: formState.accountId,
        type: formState.type,
        tags: parseTags(formState.tags),
        payee: formState.payee.trim() || null,
        notes: formState.notes.trim() || null,
        occurred_at: occurredAt,
        base_amount: baseAmountOverride,
      }
      const payload: NewTransaction = isTransfer
        ? {
            ...common,
            category_id: null,
            to_account_id: formState.toAccountId,
            to_amount: Math.abs(Number(formState.toAmount)),
          }
        : { ...common, category_id: formState.categoryId }

      if (isEditing && transaction) {
        onUpdate(transaction.id, payload)
        return
      }
      onCreate(payload)
    }

    const missingDestination =
      isTransfer && (!formState.toAccountId || !formState.toAmount)
    const missingCategory = !isTransfer && !formState.categoryId
    const submitDisabled = !formState.accountId || missingDestination || missingCategory

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit transaction' : 'New transaction'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update any detail of this transaction.'
                : 'Record an expense, income, or transfer.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-1 rounded-md border p-1" role="group" aria-label="Transaction type">
              {typeOptions.map((typeOption) => (
                <Button
                  key={typeOption.value}
                  type="button"
                  variant={formState.type === typeOption.value ? 'default' : 'ghost'}
                  size="sm"
                  className="flex-1"
                  aria-pressed={formState.type === typeOption.value}
                  onClick={() => handleTypeChange(typeOption.value)}
                >
                  {typeOption.label}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="transaction-description">Description</Label>
              <Input
                id="transaction-description"
                value={formState.description}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, description: event.target.value }))
                }
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="transaction-amount">Amount</Label>
                <Input
                  id="transaction-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.amount}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, amount: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="transaction-currency">Currency</Label>
                <Select
                  value={formState.currency}
                  onValueChange={(value) =>
                    setFormState((current) => ({ ...current, currency: value }))
                  }
                >
                  <SelectTrigger id="transaction-currency" aria-label="Currency">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((currency) => (
                      <SelectItem key={currency.code} value={currency.code}>
                        {currency.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transaction-account">Account</Label>
              <Select value={formState.accountId} onValueChange={handleAccountChange}>
                <SelectTrigger id="transaction-account" aria-label="Account">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isTransfer ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="transaction-destination-account">Destination account</Label>
                  <Select
                    value={formState.toAccountId}
                    onValueChange={handleDestinationAccountChange}
                  >
                    <SelectTrigger
                      id="transaction-destination-account"
                      aria-label="Destination account"
                    >
                      <SelectValue placeholder="Select an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {destinationAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transaction-destination-amount">Destination amount</Label>
                  <Input
                    id="transaction-destination-amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formState.toAmount}
                    onChange={(event) =>
                      setFormState((current) => ({ ...current, toAmount: event.target.value }))
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="transaction-category">Category</Label>
                <Select
                  value={formState.categoryId}
                  onValueChange={(value) =>
                    setFormState((current) => ({ ...current, categoryId: value }))
                  }
                >
                  <SelectTrigger id="transaction-category" aria-label="Category">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriesForType.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="transaction-payee">Payee</Label>
              <Input
                id="transaction-payee"
                list="transaction-payee-options"
                value={formState.payee}
                onChange={(event) => {
                  const nextPayee = event.target.value
                  setFormState((current) => {
                    // Pre-fill the last category used for this payee when the
                    // typed or selected value exactly matches a known payee.
                    // Transfers have no category field, so leave those alone.
                    const lastCategoryId = payeeCategoryHistory[nextPayee]
                    return {
                      ...current,
                      payee: nextPayee,
                      categoryId:
                        current.type !== 'transfer' && lastCategoryId
                          ? lastCategoryId
                          : current.categoryId,
                    }
                  })
                }}
                placeholder="Merchant name"
              />
              <datalist id="transaction-payee-options">
                {existingPayees.map((payee) => (
                  <option key={payee} value={payee} />
                ))}
              </datalist>
            </div>

            {isForeign ? (
              <div className="space-y-2">
                <Label htmlFor="transaction-base-amount">
                  Amount in {baseCurrencyCode} (override)
                </Label>
                <Input
                  id="transaction-base-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.baseAmount}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, baseAmount: event.target.value }))
                  }
                  placeholder="Leave blank to convert automatically"
                />
                {isEditing &&
                transaction &&
                transaction.base_amount !== null &&
                transaction.currency !== baseCurrencyCode ? (
                  <p className="text-xs text-muted-foreground">
                    {baseCurrencyCode} {Math.abs(transaction.base_amount).toFixed(2)} at{' '}
                    {transaction.rate_used}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="transaction-date">Date</Label>
              <DateTimePicker
                id="transaction-date"
                value={formState.date}
                onChange={(date) => setFormState((current) => ({ ...current, date }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="transaction-tags">Tags</Label>
              <Input
                id="transaction-tags"
                value={formState.tags}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, tags: event.target.value }))
                }
                placeholder="Comma separated, for example: groceries, monthly"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="transaction-notes">Notes</Label>
              <textarea
                id="transaction-notes"
                className={cn(textareaClassName)}
                value={formState.notes}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>

            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={submitDisabled}>
                {isEditing ? 'Save changes' : 'Create transaction'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    )
  }
  ```

- [ ] **10.4 Wire `existingPayees` and `payeeCategoryHistory` into `apps/web/src/pages/TransactionsPage.tsx`**

  This is an interim edit; Task 11 rewrites the page. Add the payee derivations and pass them to the dialog.

  1. After the `const categoryNameById = useMemo(...)` line, add:

     ```tsx
     const existingPayees = useMemo(() => {
       const seen = new Set<string>()
       for (const transaction of transactions) {
         if (transaction.payee) seen.add(transaction.payee)
       }
       return Array.from(seen).sort()
     }, [transactions])

     // Most recent transaction per payee wins: transactions are already
     // ordered newest first, so the first category_id seen for a payee is
     // kept and later, older duplicates are skipped.
     const payeeCategoryHistory = useMemo(() => {
       const history: Record<string, string> = {}
       for (const transaction of transactions) {
         if (transaction.payee && transaction.category_id && !(transaction.payee in history)) {
           history[transaction.payee] = transaction.category_id
         }
       }
       return history
     }, [transactions])
     ```

  2. In the `<TransactionFormDialog ... />` JSX, add the props right after `categories={categories}`:

     ```tsx
     existingPayees={existingPayees}
     payeeCategoryHistory={payeeCategoryHistory}
     ```

- [ ] **10.5 Run the component test, expect pass**

  ```bash
  pnpm --filter web test -- src/components/transactions/TransactionFormDialog.test.tsx
  ```

  All four tests pass. If a Radix Select interaction hangs, confirm the `src/test/setup.ts` pointer-capture stubs from Task 9 are present.

- [ ] **10.6 Run the full web suite and typecheck, expect pass**

  ```bash
  pnpm --filter web test
  pnpm --filter web typecheck
  ```

  Both succeed.

- [ ] **10.7 Commit**

  Run `commita --no-push` and confirm it created a commit.

---

## Task 11: FilterBar with URL persistence, date presets, totals bar

**Files:**
- Create: `apps/web/src/lib/datePresets.ts`
- Create: `apps/web/src/lib/datePresets.test.ts`
- Create: `apps/web/src/components/transactions/FilterBar.tsx`
- Create: `apps/web/src/components/transactions/FilterBar.test.tsx`
- Create: `apps/web/src/components/transactions/TransactionTotalsBar.tsx`
- Modify: `apps/web/src/pages/TransactionsPage.tsx` (full rewrite: URL-driven filters, infinite query, FilterBar, totals bar)
- Create: `apps/web/src/pages/TransactionsPage.test.tsx`

**Interfaces:**

Consumes:
- `@/lib/filterParams`: `filtersToSearchParams`, `searchParamsToFilters` (Task 9)
- `@/hooks/useTransactions`: `useTransactionsInfinite` (Task 9)
- `@/hooks/useCurrencies`: `useCurrencies` (Task 9); `@/hooks/useSettings`: `useSettings` (Task 9)
- `@/hooks/useAccounts`, `@/hooks/useCategories` (existing)
- `@/types`: `Account`, `Category`, `Currency`, `TransactionFilters`, `TransactionTotals`, `TransactionType`
- `react-router`: `useSearchParams`

Produces (consumed by Task 12's page rework):
- `@/lib/datePresets`: `presetRange(preset: DatePreset, now?: Date): DateRange`, `detectPreset(range: DateRange, now?: Date): DatePreset`, types `DatePreset = 'this-month' | 'last-month' | 'this-year' | 'all-time' | 'custom'` and `DateRange = { from?: string; to?: string }`
- `@/components/transactions/FilterBar`: `FilterBar` component with props `{ filters: TransactionFilters; onChange: (filters: TransactionFilters) => void; accounts: Account[]; categories: Category[]; currencies: Currency[] }`
- `@/components/transactions/TransactionTotalsBar`: `TransactionTotalsBar` component with props `{ totals: TransactionTotals | null; baseCurrencyCode: string }`

### Steps

- [ ] **11.1 Write the failing datePresets test**

  Create `apps/web/src/lib/datePresets.test.ts`:

  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
  import { detectPreset, presetRange } from '@/lib/datePresets'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('presetRange', () => {
    it('computes this-month bounds', () => {
      expect(presetRange('this-month')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    })

    it('computes last-month bounds', () => {
      expect(presetRange('last-month')).toEqual({ from: '2026-06-01', to: '2026-06-30' })
    })

    it('computes this-year bounds', () => {
      expect(presetRange('this-year')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    })

    it('returns an empty range for all-time', () => {
      expect(presetRange('all-time')).toEqual({})
    })

    it('returns an empty range for custom', () => {
      expect(presetRange('custom')).toEqual({})
    })
  })

  describe('detectPreset', () => {
    it('recognizes the this-month range', () => {
      expect(detectPreset({ from: '2026-07-01', to: '2026-07-31' })).toBe('this-month')
    })

    it('treats an empty range as all-time', () => {
      expect(detectPreset({})).toBe('all-time')
    })

    it('falls back to custom for a partial or unmatched range', () => {
      expect(detectPreset({ from: '2026-07-05' })).toBe('custom')
      expect(detectPreset({ from: '2026-07-01', to: '2026-07-15' })).toBe('custom')
    })
  })
  ```

- [ ] **11.2 Run the test, expect failure**

  ```bash
  pnpm --filter web test -- src/lib/datePresets.test.ts
  ```

  Expected failure: `Failed to resolve import "@/lib/datePresets"`.

- [ ] **11.3 Implement `apps/web/src/lib/datePresets.ts`**

  ```ts
  export type DatePreset = 'this-month' | 'last-month' | 'this-year' | 'all-time' | 'custom'

  export interface DateRange {
    from?: string
    to?: string
  }

  export const datePresetOptions: { value: Exclude<DatePreset, 'custom'> | 'custom'; label: string }[] =
    [
      { value: 'this-month', label: 'This month' },
      { value: 'last-month', label: 'Last month' },
      { value: 'this-year', label: 'This year' },
      { value: 'all-time', label: 'All time' },
      { value: 'custom', label: 'Custom range' },
    ]

  // Local-date "YYYY-MM-DD" string, matching the occurred_at date filter contract.
  function toDateOnly(date: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  export function presetRange(preset: DatePreset, now: Date = new Date()): DateRange {
    switch (preset) {
      case 'this-month':
        return {
          from: toDateOnly(new Date(now.getFullYear(), now.getMonth(), 1)),
          to: toDateOnly(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
        }
      case 'last-month':
        return {
          from: toDateOnly(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
          to: toDateOnly(new Date(now.getFullYear(), now.getMonth(), 0)),
        }
      case 'this-year':
        return {
          from: toDateOnly(new Date(now.getFullYear(), 0, 1)),
          to: toDateOnly(new Date(now.getFullYear(), 11, 31)),
        }
      case 'all-time':
      case 'custom':
        return {}
    }
  }

  export function detectPreset(range: DateRange, now: Date = new Date()): DatePreset {
    if (!range.from && !range.to) return 'all-time'
    const candidates: Exclude<DatePreset, 'all-time' | 'custom'>[] = [
      'this-month',
      'last-month',
      'this-year',
    ]
    for (const candidate of candidates) {
      const candidateRange = presetRange(candidate, now)
      if (candidateRange.from === range.from && candidateRange.to === range.to) {
        return candidate
      }
    }
    return 'custom'
  }
  ```

- [ ] **11.4 Run the datePresets test, expect pass**

  ```bash
  pnpm --filter web test -- src/lib/datePresets.test.ts
  ```

  All tests pass.

- [ ] **11.5 Create `apps/web/src/components/transactions/TransactionTotalsBar.tsx`**

  ```tsx
  import { formatCurrency } from '@/lib/utils'
  import type { TransactionTotals } from '@/types'

  interface TransactionTotalsBarProps {
    totals: TransactionTotals | null
    baseCurrencyCode: string
  }

  export function TransactionTotalsBar({ totals, baseCurrencyCode }: TransactionTotalsBarProps) {
    if (!totals) return null
    const transactionsLabel = totals.count === 1 ? '1 transaction' : `${totals.count} transactions`
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/40 px-4 py-2 text-sm">
        <span className="font-medium">{transactionsLabel}</span>
        {totals.by_currency.map((currencySum) => (
          <span key={currencySum.currency} className="tabular-nums text-muted-foreground">
            {formatCurrency(currencySum.sum, currencySum.currency)}
          </span>
        ))}
        <span className="ml-auto font-medium tabular-nums">
          {totals.base.sum === null
            ? `${baseCurrencyCode} total unavailable: missing rates`
            : formatCurrency(totals.base.sum, baseCurrencyCode)}
        </span>
      </div>
    )
  }
  ```

- [ ] **11.6 Write the failing FilterBar test**

  Create `apps/web/src/components/transactions/FilterBar.test.tsx`:

  ```tsx
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { describe, expect, it, vi } from 'vitest'
  import { FilterBar } from '@/components/transactions/FilterBar'
  import type { Account, Category, Currency, TransactionFilters } from '@/types'

  const accounts: Account[] = [
    { id: 'acc-pen', name: 'Cash', type: 'cash', currency: 'PEN' },
    { id: 'acc-usd', name: 'BCP USD', type: 'checking', currency: 'USD' },
  ]
  const categories: Category[] = [{ id: 'cat-food', name: 'Food', type: 'expense' }]
  const currencies: Currency[] = [
    { code: 'PEN', name: 'Sol', symbol: 'S/', decimal_places: 2 },
    { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 },
  ]

  function renderFilterBar(filters: TransactionFilters) {
    const onChange = vi.fn()
    render(
      <FilterBar
        filters={filters}
        onChange={onChange}
        accounts={accounts}
        categories={categories}
        currencies={currencies}
      />,
    )
    return { onChange }
  }

  describe('FilterBar', () => {
    it('renders a chip for each active filter', () => {
      renderFilterBar({ type: 'expense', search: 'coffee', accountIds: ['acc-pen'] })
      expect(screen.getByText('Type: expense')).toBeInTheDocument()
      expect(screen.getByText('Search: coffee')).toBeInTheDocument()
      expect(screen.getByText('1 account')).toBeInTheDocument()
    })

    it('removes a single filter when its chip x is clicked', async () => {
      const user = userEvent.setup()
      const { onChange } = renderFilterBar({ type: 'expense', search: 'coffee' })
      await user.click(screen.getByRole('button', { name: 'Remove Type: expense' }))
      expect(onChange).toHaveBeenCalledWith({ search: 'coffee' })
    })

    it('clears every filter with Clear all', async () => {
      const user = userEvent.setup()
      const { onChange } = renderFilterBar({ type: 'expense', search: 'coffee' })
      await user.click(screen.getByRole('button', { name: 'Clear all' }))
      expect(onChange).toHaveBeenCalledWith({})
    })
  })
  ```

- [ ] **11.7 Run the FilterBar test, expect failure**

  ```bash
  pnpm --filter web test -- src/components/transactions/FilterBar.test.tsx
  ```

  Expected failure: `Failed to resolve import "@/components/transactions/FilterBar"`.

- [ ] **11.8 Implement `apps/web/src/components/transactions/FilterBar.tsx`**

  ```tsx
  import { useEffect, useMemo, useRef, useState } from 'react'
  import { IconX } from '@tabler/icons-react'
  import { Button } from '@/components/ui/button'
  import { Input } from '@/components/ui/input'
  import { Label } from '@/components/ui/label'
  import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '@/components/ui/select'
  import {
    datePresetOptions,
    detectPreset,
    presetRange,
    type DatePreset,
  } from '@/lib/datePresets'
  import type { Account, Category, Currency, TransactionFilters, TransactionType } from '@/types'

  interface FilterBarProps {
    filters: TransactionFilters
    onChange: (filters: TransactionFilters) => void
    accounts: Account[]
    categories: Category[]
    currencies: Currency[]
  }

  const typeSelectOptions: { value: TransactionType | 'all'; label: string }[] = [
    { value: 'all', label: 'All types' },
    { value: 'expense', label: 'Expense' },
    { value: 'income', label: 'Income' },
    { value: 'transfer', label: 'Transfer' },
  ]

  const tagModeOptions: { value: 'any' | 'all' | 'none'; label: string }[] = [
    { value: 'any', label: 'Any tag' },
    { value: 'all', label: 'All tags' },
    { value: 'none', label: 'No tags' },
  ]

  interface FilterMultiSelectProps {
    label: string
    options: { value: string; label: string }[]
    selected: string[]
    onChange: (selected: string[]) => void
  }

  function FilterMultiSelect({ label, options, selected, onChange }: FilterMultiSelectProps) {
    const [open, setOpen] = useState(false)
    const summary = selected.length === 0 ? `All ${label.toLowerCase()}` : `${selected.length} selected`

    function toggle(optionValue: string) {
      onChange(
        selected.includes(optionValue)
          ? selected.filter((value) => value !== optionValue)
          : [...selected, optionValue],
      )
    }

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" aria-label={label}>
            {summary}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <div className="max-h-64 space-y-1 overflow-auto">
            {options.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  interface FilterChip {
    key: string
    label: string
    onRemove: () => void
  }

  export function FilterBar({ filters, onChange, accounts, categories, currencies }: FilterBarProps) {
    const patch = (next: Partial<TransactionFilters>) => onChange({ ...filters, ...next })
    const clearKeys = (keys: (keyof TransactionFilters)[]) => {
      const next = { ...filters }
      for (const key of keys) delete next[key]
      onChange(next)
    }

    const currentPreset = detectPreset({ from: filters.from, to: filters.to })
    const accountNameById = useMemo(
      () => new Map(accounts.map((account) => [account.id, account.name])),
      [accounts],
    )
    const categoryNameById = useMemo(
      () => new Map(categories.map((category) => [category.id, category.name])),
      [categories],
    )

    // Debounced free-text search (300ms) so keystrokes do not spam the query.
    const [searchDraft, setSearchDraft] = useState(filters.search ?? '')
    const filtersRef = useRef(filters)
    filtersRef.current = filters
    useEffect(() => {
      setSearchDraft(filters.search ?? '')
    }, [filters.search])
    useEffect(() => {
      const handle = setTimeout(() => {
        const trimmed = searchDraft.trim()
        if ((filtersRef.current.search ?? '') === trimmed) return
        onChange({ ...filtersRef.current, search: trimmed || undefined })
      }, 300)
      return () => clearTimeout(handle)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchDraft])

    function handlePresetChange(nextPreset: DatePreset) {
      if (nextPreset === 'custom') {
        patch({ from: filters.from, to: filters.to })
        return
      }
      const range = presetRange(nextPreset)
      patch({ from: range.from, to: range.to })
    }

    const chips: FilterChip[] = []
    if (currentPreset !== 'all-time') {
      const presetLabel =
        currentPreset === 'custom'
          ? `${filters.from ?? '...'} to ${filters.to ?? '...'}`
          : datePresetOptions.find((option) => option.value === currentPreset)?.label ?? 'Custom'
      chips.push({ key: 'date', label: presetLabel, onRemove: () => clearKeys(['from', 'to']) })
    }
    if (filters.accountIds && filters.accountIds.length > 0) {
      const count = filters.accountIds.length
      const label =
        count === 1 ? `1 account` : `${count} accounts`
      chips.push({
        key: 'accounts',
        label:
          count === 1
            ? accountNameById.get(filters.accountIds[0]) ?? label
            : label,
        onRemove: () => clearKeys(['accountIds']),
      })
    }
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      const count = filters.categoryIds.length
      chips.push({
        key: 'categories',
        label:
          count === 1
            ? categoryNameById.get(filters.categoryIds[0]) ?? '1 category'
            : `${count} categories`,
        onRemove: () => clearKeys(['categoryIds']),
      })
    }
    if (filters.uncategorized) {
      chips.push({
        key: 'uncategorized',
        label: 'Uncategorized',
        onRemove: () => clearKeys(['uncategorized']),
      })
    }
    if (filters.tags && filters.tags.length > 0) {
      chips.push({
        key: 'tags',
        label: `${filters.tags.length} tags (${filters.tagMode ?? 'any'})`,
        onRemove: () => clearKeys(['tags', 'tagMode']),
      })
    }
    if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
      chips.push({
        key: 'amount',
        label: `Amount ${filters.amountMin ?? '0'} to ${filters.amountMax ?? '∞'}`,
        onRemove: () => clearKeys(['amountMin', 'amountMax']),
      })
    }
    if (filters.currency) {
      chips.push({
        key: 'currency',
        label: `Currency: ${filters.currency}`,
        onRemove: () => clearKeys(['currency']),
      })
    }
    if (filters.type) {
      chips.push({
        key: 'type',
        label: `Type: ${filters.type}`,
        onRemove: () => clearKeys(['type']),
      })
    }
    if (filters.search) {
      chips.push({
        key: 'search',
        label: `Search: ${filters.search}`,
        onRemove: () => clearKeys(['search']),
      })
    }

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Select value={currentPreset} onValueChange={(value) => handlePresetChange(value as DatePreset)}>
              <SelectTrigger className="w-40" aria-label="Date range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {datePresetOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {currentPreset === 'custom' ? (
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="filter-from" className="text-xs text-muted-foreground">
                  From
                </Label>
                <Input
                  id="filter-from"
                  type="date"
                  className="w-40"
                  value={filters.from ?? ''}
                  onChange={(event) => patch({ from: event.target.value || undefined })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="filter-to" className="text-xs text-muted-foreground">
                  To
                </Label>
                <Input
                  id="filter-to"
                  type="date"
                  className="w-40"
                  value={filters.to ?? ''}
                  onChange={(event) => patch({ to: event.target.value || undefined })}
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Accounts</Label>
            <FilterMultiSelect
              label="Accounts"
              options={accounts.map((account) => ({ value: account.id, label: account.name }))}
              selected={filters.accountIds ?? []}
              onChange={(accountIds) =>
                patch({ accountIds: accountIds.length > 0 ? accountIds : undefined })
              }
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Categories</Label>
            <FilterMultiSelect
              label="Categories"
              options={categories.map((category) => ({ value: category.id, label: category.name }))}
              selected={filters.categoryIds ?? []}
              onChange={(categoryIds) =>
                patch({ categoryIds: categoryIds.length > 0 ? categoryIds : undefined })
              }
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filters.uncategorized ?? false}
              onChange={(event) => patch({ uncategorized: event.target.checked || undefined })}
            />
            Uncategorized only
          </label>

          <div className="space-y-1">
            <Label htmlFor="filter-tags" className="text-xs text-muted-foreground">
              Tags
            </Label>
            <Input
              id="filter-tags"
              className="w-44"
              placeholder="Comma separated"
              value={(filters.tags ?? []).join(', ')}
              onChange={(event) => {
                const tags = event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter((tag) => tag.length > 0)
                patch({ tags: tags.length > 0 ? tags : undefined })
              }}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Tag mode</Label>
            <Select
              value={filters.tagMode ?? 'any'}
              onValueChange={(value) =>
                patch({ tagMode: value === 'any' ? undefined : (value as 'all' | 'none') })
              }
            >
              <SelectTrigger className="w-32" aria-label="Tag mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tagModeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="filter-amount-min" className="text-xs text-muted-foreground">
              Amount
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="filter-amount-min"
                type="number"
                className="w-24"
                placeholder="Min"
                value={filters.amountMin ?? ''}
                onChange={(event) =>
                  patch({
                    amountMin: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              />
              <Input
                type="number"
                className="w-24"
                placeholder="Max"
                aria-label="Amount max"
                value={filters.amountMax ?? ''}
                onChange={(event) =>
                  patch({
                    amountMax: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Currency</Label>
            <Select
              value={filters.currency ?? 'all'}
              onValueChange={(value) => patch({ currency: value === 'all' ? undefined : value })}
            >
              <SelectTrigger className="w-28" aria-label="Currency filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {currencies.map((currency) => (
                  <SelectItem key={currency.code} value={currency.code}>
                    {currency.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select
              value={filters.type ?? 'all'}
              onValueChange={(value) =>
                patch({ type: value === 'all' ? undefined : (value as TransactionType) })
              }
            >
              <SelectTrigger className="w-32" aria-label="Type filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeSelectOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="filter-search" className="text-xs text-muted-foreground">
              Search
            </Label>
            <Input
              id="filter-search"
              className="w-52"
              placeholder="Description, payee, notes, tags"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>
        </div>

        {chips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-xs"
              >
                {chip.label}
                <button
                  type="button"
                  aria-label={`Remove ${chip.label}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={chip.onRemove}
                >
                  <IconX className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
              Clear all
            </Button>
          </div>
        ) : null}
      </div>
    )
  }
  ```

- [ ] **11.9 Run the FilterBar test, expect pass**

  ```bash
  pnpm --filter web test -- src/components/transactions/FilterBar.test.tsx
  ```

  All tests pass.

- [ ] **11.10 Rewrite `apps/web/src/pages/TransactionsPage.tsx`**

  This wires the URL to filters, drives the infinite query, and mounts the FilterBar and totals bar. Day grouping and the list item stay interim (Task 12 replaces them). Replace the whole file with:

  ```tsx
  import { useMemo, useState } from 'react'
  import { useSearchParams } from 'react-router'
  import { IconPlus } from '@tabler/icons-react'
  import { Button } from '@/components/ui/button'
  import { Card, CardContent } from '@/components/ui/card'
  import { ConfirmDialog } from '@/components/ConfirmDialog'
  import { FilterBar } from '@/components/transactions/FilterBar'
  import { TransactionFormDialog } from '@/components/transactions/TransactionFormDialog'
  import { TransactionListItem } from '@/components/transactions/TransactionListItem'
  import { TransactionTotalsBar } from '@/components/transactions/TransactionTotalsBar'
  import {
    useCreateTransaction,
    useDeleteTransaction,
    useTransactionsInfinite,
    useUpdateTransaction,
  } from '@/hooks/useTransactions'
  import { useAccounts } from '@/hooks/useAccounts'
  import { useCategories } from '@/hooks/useCategories'
  import { useCurrencies } from '@/hooks/useCurrencies'
  import { useSettings } from '@/hooks/useSettings'
  import { filtersToSearchParams, searchParamsToFilters } from '@/lib/filterParams'
  import { formatDayLabel, toDayKey, toNameById } from '@/lib/utils'
  import { toErrorMessage } from '@/lib/api'
  import type { NewTransaction, Transaction, TransactionFilters, TransactionUpdate } from '@/types'

  export function TransactionsPage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const filters = useMemo(() => searchParamsToFilters(searchParams), [searchParams])

    function applyFilters(nextFilters: TransactionFilters) {
      setSearchParams(filtersToSearchParams(nextFilters), { replace: true })
    }

    const transactionsQuery = useTransactionsInfinite(filters)
    const accountsQuery = useAccounts()
    const categoriesQuery = useCategories()
    const currenciesQuery = useCurrencies()
    const settingsQuery = useSettings()

    const createTransaction = useCreateTransaction()
    const updateTransaction = useUpdateTransaction()
    const deleteTransaction = useDeleteTransaction()

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
    const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null)
    const [deleteError, setDeleteError] = useState<string | null>(null)
    const [formError, setFormError] = useState<string | null>(null)

    const accounts = accountsQuery.data ?? []
    const categories = categoriesQuery.data ?? []
    const currencies = currenciesQuery.data ?? []
    const baseCurrencyCode = settingsQuery.data?.base_currency_code ?? 'PEN'

    const items = useMemo(
      () => transactionsQuery.data?.pages.flatMap((page) => page.items) ?? [],
      [transactionsQuery.data],
    )
    const totals = transactionsQuery.data?.pages[0]?.totals ?? null

    const accountNameById = useMemo(() => toNameById(accounts), [accounts])
    const categoryNameById = useMemo(() => toNameById(categories), [categories])

    const existingPayees = useMemo(() => {
      const seen = new Set<string>()
      for (const transaction of items) {
        if (transaction.payee) seen.add(transaction.payee)
      }
      return Array.from(seen).sort()
    }, [items])

    // Most recent transaction per payee wins: items are already ordered
    // newest first (occurred_at desc), so the first category_id seen for a
    // payee is kept and later, older duplicates are skipped.
    const payeeCategoryHistory = useMemo(() => {
      const history: Record<string, string> = {}
      for (const transaction of items) {
        if (transaction.payee && transaction.category_id && !(transaction.payee in history)) {
          history[transaction.payee] = transaction.category_id
        }
      }
      return history
    }, [items])

    // Interim grouping on occurred_at; Task 12 extracts and tests a pure module.
    const dayGroups = useMemo(() => {
      const groups: { dayKey: string; dayLabel: string; transactions: Transaction[] }[] = []
      for (const transaction of items) {
        const dayKey = toDayKey(transaction.occurred_at)
        let group = groups[groups.length - 1]
        if (!group || group.dayKey !== dayKey) {
          group = { dayKey, dayLabel: formatDayLabel(transaction.occurred_at), transactions: [] }
          groups.push(group)
        }
        group.transactions.push(transaction)
      }
      return groups
    }, [items])

    function openCreateDialog() {
      setEditingTransaction(null)
      setFormError(null)
      setIsDialogOpen(true)
    }

    function openEditDialog(transaction: Transaction) {
      setEditingTransaction(transaction)
      setFormError(null)
      setIsDialogOpen(true)
    }

    function handleCreate(payload: NewTransaction) {
      setFormError(null)
      createTransaction.mutate(payload, {
        onSuccess: () => setIsDialogOpen(false),
        onError: (error) => setFormError(toErrorMessage(error)),
      })
    }

    function handleUpdate(transactionId: string, payload: TransactionUpdate) {
      setFormError(null)
      updateTransaction.mutate(
        { id: transactionId, payload },
        {
          onSuccess: () => setIsDialogOpen(false),
          onError: (error) => setFormError(toErrorMessage(error)),
        },
      )
    }

    function openDeleteDialog(transaction: Transaction) {
      setDeleteError(null)
      setDeletingTransaction(transaction)
    }

    function handleConfirmDelete() {
      if (!deletingTransaction) return
      setDeleteError(null)
      deleteTransaction.mutate(deletingTransaction.id, {
        onSuccess: () => setDeletingTransaction(null),
        onError: (error) => setDeleteError(toErrorMessage(error)),
      })
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
            <p className="text-sm text-muted-foreground">Create, edit, and remove transactions</p>
          </div>
          <Button onClick={openCreateDialog} disabled={accounts.length === 0}>
            <IconPlus className="h-4 w-4" />
            New transaction
          </Button>
        </div>

        <FilterBar
          filters={filters}
          onChange={applyFilters}
          accounts={accounts}
          categories={categories}
          currencies={currencies}
        />

        <TransactionTotalsBar totals={totals} baseCurrencyCode={baseCurrencyCode} />

        <Card>
          <CardContent className="p-0">
            {transactionsQuery.isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Loading transactions...</p>
            ) : transactionsQuery.isError ? (
              <p className="p-6 text-sm text-destructive">
                {toErrorMessage(transactionsQuery.error)}
              </p>
            ) : items.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No transactions match these filters.</p>
            ) : (
              <div>
                {dayGroups.map((dayGroup) => (
                  <section key={dayGroup.dayKey} className="border-b last:border-b-0">
                    <header className="border-b bg-muted/40 px-6 py-2">
                      <h2 className="text-sm font-medium">{dayGroup.dayLabel}</h2>
                    </header>
                    <ul className="divide-y">
                      {dayGroup.transactions.map((transaction) => (
                        <TransactionListItem
                          key={transaction.id}
                          transaction={transaction}
                          accountName={
                            accountNameById.get(transaction.account_id) ?? transaction.account_id
                          }
                          categoryName={
                            transaction.category_id
                              ? categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
                              : 'Uncategorized'
                          }
                          onEdit={openEditDialog}
                          onDelete={openDeleteDialog}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <ConfirmDialog
          open={deletingTransaction !== null}
          onOpenChange={(open) => {
            if (!open) setDeletingTransaction(null)
          }}
          title="Delete transaction?"
          description={
            deletingTransaction
              ? `"${deletingTransaction.description}" will be permanently removed.`
              : ''
          }
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          isPending={deleteTransaction.isPending}
          errorMessage={deleteError}
        />

        <TransactionFormDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          accounts={accounts}
          categories={categories}
          existingPayees={existingPayees}
          payeeCategoryHistory={payeeCategoryHistory}
          transaction={editingTransaction}
          isSubmitting={createTransaction.isPending || updateTransaction.isPending}
          errorMessage={formError}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      </div>
    )
  }
  ```

- [ ] **11.11 Write the page-level URL round-trip test**

  Create `apps/web/src/pages/TransactionsPage.test.tsx`:

  ```tsx
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import { render, screen, waitFor } from '@testing-library/react'
  import { MemoryRouter, Route, Routes } from 'react-router'
  import { afterEach, describe, expect, it, vi } from 'vitest'
  import { TransactionsPage } from '@/pages/TransactionsPage'
  import { stubApiFetch } from '@/test/apiStub'
  import { makeTransaction } from '@/test/factories'
  import type { TransactionTotals } from '@/types'

  const totals: TransactionTotals = {
    count: 1,
    by_currency: [{ currency: 'PEN', sum: -10 }],
    base: { currency: 'PEN', sum: -10 },
  }

  function renderPage(initialUrl: string) {
    const apiStub = stubApiFetch([
      {
        match: '/transactions',
        data: { items: [makeTransaction({ payee: 'Wong' })], next_cursor: null, totals },
      },
      { match: '/accounts', data: [{ id: 'acc-1', name: 'Cash', type: 'cash', currency: 'PEN' }] },
      { match: '/categories', data: [{ id: 'cat-1', name: 'Food', type: 'expense' }] },
      {
        match: '/currencies',
        data: [{ code: 'PEN', name: 'Sol', symbol: 'S/', decimal_places: 2 }],
      },
      { match: '/settings', data: { id: 1, base_currency_code: 'PEN' } },
    ])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/transactions" element={<TransactionsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return apiStub
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('TransactionsPage URL filters', () => {
    it('reads filters from the URL, maps them to the API call, and shows chips', async () => {
      const apiStub = renderPage('/transactions?type=expense&search=coffee')

      await waitFor(() => {
        const transactionsCall = apiStub
          .requestedUrls()
          .find((url) => url.includes('/transactions') && url.includes('type=expense'))
        expect(transactionsCall).toBeDefined()
        expect(transactionsCall).toContain('search=coffee')
      })

      expect(screen.getByText('Type: expense')).toBeInTheDocument()
      expect(screen.getByText('Search: coffee')).toBeInTheDocument()
    })
  })
  ```

- [ ] **11.12 Run the page test, expect pass**

  ```bash
  pnpm --filter web test -- src/pages/TransactionsPage.test.tsx
  ```

  Passes. The page reads `?type=expense&search=coffee`, `useTransactionsInfinite` maps it to `account`-free API params via `filtersToApiSearchParams`, and the chips render.

- [ ] **11.13 Run the full web suite and typecheck, expect pass**

  ```bash
  pnpm --filter web test
  pnpm --filter web typecheck
  ```

  Both succeed.

- [ ] **11.14 Commit**

  Run `commita --no-push` and confirm it created a commit.

---

## Task 12: Transactions list rework (Load more, occurred_at grouping, converted display, transfer rows)

**Files:**
- Create: `apps/web/src/lib/groupTransactions.ts`
- Create: `apps/web/src/lib/groupTransactions.test.ts`
- Create: `apps/web/src/lib/transactionAmount.ts`
- Create: `apps/web/src/lib/transactionAmount.test.ts`
- Modify: `apps/web/src/components/transactions/TransactionListItem.tsx` (converted display, transfer rows, occurred_at)
- Modify: `apps/web/src/pages/TransactionsPage.tsx` (use grouping module, Load more, pass base currency + destination account name)

**Interfaces:**

Consumes:
- `@/lib/utils`: `formatCurrency`, `formatDate`, `formatTime`, `formatDayLabel`, `toDayKey` (existing)
- `@/hooks/useTransactions`: `useTransactionsInfinite` result exposes `fetchNextPage`, `hasNextPage`, `isFetchingNextPage` (Task 9)
- `@/types`: `Transaction`

Produces (consumed by the page and Task 13 conceptually):
- `@/lib/groupTransactions`: `groupTransactionsByDay(transactions: Transaction[]): TransactionDayGroup[]` where `TransactionDayGroup = { dayKey: string; dayLabel: string; transactions: Transaction[] }`
- `@/lib/transactionAmount`: `formatTransactionAmount(amount: number, currency: string, baseAmount: number | null, baseCurrencyCode: string): string`, `formatTransferRoute(fromAccountName: string, toAccountName: string): string`
- `TransactionListItem` gains props `baseCurrencyCode: string` and `toAccountName?: string`

### Steps

- [ ] **12.1 Write the failing grouping and amount-format tests**

  Create `apps/web/src/lib/groupTransactions.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest'
  import { groupTransactionsByDay } from '@/lib/groupTransactions'
  import { makeTransaction } from '@/test/factories'

  describe('groupTransactionsByDay', () => {
    it('groups consecutive transactions by their occurred_at calendar day', () => {
      const transactions = [
        makeTransaction({ id: 'a', occurred_at: '2026-07-10T18:00:00.000Z' }),
        makeTransaction({ id: 'b', occurred_at: '2026-07-10T09:00:00.000Z' }),
        makeTransaction({ id: 'c', occurred_at: '2026-07-09T22:00:00.000Z' }),
      ]
      const groups = groupTransactionsByDay(transactions)
      expect(groups).toHaveLength(2)
      expect(groups[0].transactions.map((transaction) => transaction.id)).toEqual(['a', 'b'])
      expect(groups[1].transactions.map((transaction) => transaction.id)).toEqual(['c'])
    })

    it('returns no groups for an empty list', () => {
      expect(groupTransactionsByDay([])).toEqual([])
    })
  })
  ```

  Create `apps/web/src/lib/transactionAmount.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest'
  import { formatTransactionAmount, formatTransferRoute } from '@/lib/transactionAmount'

  describe('formatTransactionAmount', () => {
    it('shows only the native amount when the currency is the base currency', () => {
      expect(formatTransactionAmount(-10, 'PEN', -10, 'PEN')).toBe('PEN 10.00')
    })

    it('appends the converted base amount for foreign-currency rows', () => {
      expect(formatTransactionAmount(-20, 'USD', -74.8, 'PEN')).toBe('USD 20.00 (PEN 74.80)')
    })

    it('omits the conversion when the base amount is missing', () => {
      expect(formatTransactionAmount(-20, 'USD', null, 'PEN')).toBe('USD 20.00')
    })
  })

  describe('formatTransferRoute', () => {
    it('renders both legs with an arrow', () => {
      expect(formatTransferRoute('Cash', 'BCP USD')).toBe('Cash -> BCP USD')
    })
  })
  ```

  Note: `formatCurrency` uses `Intl.NumberFormat('en-US', { style: 'currency', currency })`, which renders `PEN` and `USD` as the ISO code followed by the amount (`PEN 10.00`, `USD 20.00`) in the Node/jsdom ICU build, so the expected strings above hold. If a local ICU build renders a symbol instead, adjust the expectations to the observed output rather than changing the helper.

- [ ] **12.2 Run the tests, expect failure**

  ```bash
  pnpm --filter web test -- src/lib/groupTransactions.test.ts
  pnpm --filter web test -- src/lib/transactionAmount.test.ts
  ```

  Both fail to resolve their imports (`@/lib/groupTransactions`, `@/lib/transactionAmount`).

- [ ] **12.3 Implement the two pure modules**

  Create `apps/web/src/lib/groupTransactions.ts`:

  ```ts
  import { formatDayLabel, toDayKey } from '@/lib/utils'
  import type { Transaction } from '@/types'

  export interface TransactionDayGroup {
    dayKey: string
    dayLabel: string
    transactions: Transaction[]
  }

  // Groups an already-ordered list (server returns occurred_at DESC) into
  // consecutive calendar-day buckets keyed on occurred_at.
  export function groupTransactionsByDay(transactions: Transaction[]): TransactionDayGroup[] {
    const groups: TransactionDayGroup[] = []
    for (const transaction of transactions) {
      const dayKey = toDayKey(transaction.occurred_at)
      let group = groups[groups.length - 1]
      if (!group || group.dayKey !== dayKey) {
        group = { dayKey, dayLabel: formatDayLabel(transaction.occurred_at), transactions: [] }
        groups.push(group)
      }
      group.transactions.push(transaction)
    }
    return groups
  }
  ```

  Create `apps/web/src/lib/transactionAmount.ts`:

  ```ts
  import { formatCurrency } from '@/lib/utils'

  // Native amount, with the frozen base-currency conversion in parentheses for
  // foreign-currency rows: "USD 20.00 (PEN 74.80)".
  export function formatTransactionAmount(
    amount: number,
    currency: string,
    baseAmount: number | null,
    baseCurrencyCode: string,
  ): string {
    const primary = formatCurrency(Math.abs(amount), currency)
    if (currency === baseCurrencyCode || baseAmount === null) return primary
    return `${primary} (${formatCurrency(Math.abs(baseAmount), baseCurrencyCode)})`
  }

  export function formatTransferRoute(fromAccountName: string, toAccountName: string): string {
    return `${fromAccountName} -> ${toAccountName}`
  }
  ```

- [ ] **12.4 Run the two tests, expect pass**

  ```bash
  pnpm --filter web test -- src/lib/groupTransactions.test.ts
  pnpm --filter web test -- src/lib/transactionAmount.test.ts
  ```

  Both pass.

- [ ] **12.5 Rewrite `apps/web/src/components/transactions/TransactionListItem.tsx`**

  Replace the whole file with (transfers render neutral with a two-arrow icon and both accounts; foreign rows show the converted amount):

  ```tsx
  import { IconArrowsExchange, IconPencil, IconTrash } from '@tabler/icons-react'
  import { Button } from '@/components/ui/button'
  import { cn, formatDate, formatTime } from '@/lib/utils'
  import { formatTransactionAmount, formatTransferRoute } from '@/lib/transactionAmount'
  import type { Transaction } from '@/types'

  interface TransactionListItemProps {
    transaction: Transaction
    accountName: string
    categoryName: string
    baseCurrencyCode: string
    /** Destination account name, used only for transfer rows. */
    toAccountName?: string
    /** Show the calendar date instead of the time of day (for ungrouped lists). */
    showDate?: boolean
    onEdit?: (transaction: Transaction) => void
    onDelete?: (transaction: Transaction) => void
  }

  export function TransactionListItem({
    transaction,
    accountName,
    categoryName,
    baseCurrencyCode,
    toAccountName,
    showDate = false,
    onEdit,
    onDelete,
  }: TransactionListItemProps) {
    const isTransfer = transaction.type === 'transfer'
    const isIncome = transaction.type === 'income'
    const whenLabel = showDate
      ? formatDate(transaction.occurred_at)
      : formatTime(transaction.occurred_at)
    const hasActions = Boolean(onEdit || onDelete)

    const detailLine = isTransfer
      ? formatTransferRoute(accountName, toAccountName ?? transaction.to_account_id ?? '')
      : `${categoryName} · ${accountName}`

    const amountLabel = formatTransactionAmount(
      transaction.amount,
      transaction.currency,
      transaction.base_amount,
      baseCurrencyCode,
    )

    return (
      <li className="flex items-start justify-between gap-4 px-6 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            {isTransfer ? <IconArrowsExchange className="h-4 w-4 text-muted-foreground" /> : null}
            {transaction.description}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {whenLabel} · {detailLine}
          </p>
          {transaction.payee ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{transaction.payee}</p>
          ) : null}
          {transaction.tags.length > 0 ? (
            <p className="mt-1 truncate text-xs text-muted-foreground/80">
              {transaction.tags.map((tag) => `#${tag}`).join(' ')}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              'text-sm font-medium tabular-nums',
              isTransfer && 'text-muted-foreground',
              isIncome && 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {isTransfer ? '' : isIncome ? '+' : '-'}
            {amountLabel}
          </span>
          {hasActions ? (
            <div className="-mr-2 flex gap-0.5">
              {onEdit ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => onEdit(transaction)}
                  aria-label="Edit transaction"
                >
                  <IconPencil className="h-4 w-4" />
                </Button>
              ) : null}
              {onDelete ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => onDelete(transaction)}
                  aria-label="Delete transaction"
                >
                  <IconTrash className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </li>
    )
  }
  ```

- [ ] **12.6 Update `apps/web/src/pages/TransactionsPage.tsx` to use the module, Load more, and the new item props**

  1. Replace the utils import line

     ```tsx
     import { formatDayLabel, toDayKey, toNameById } from '@/lib/utils'
     ```

     with

     ```tsx
     import { toNameById } from '@/lib/utils'
     import { groupTransactionsByDay } from '@/lib/groupTransactions'
     ```

  2. Replace the interim `dayGroups` memo (the whole `const dayGroups = useMemo(() => { ... }, [items])` block) with:

     ```tsx
     const dayGroups = useMemo(() => groupTransactionsByDay(items), [items])
     ```

  3. In the `<TransactionListItem ... />` usage, add these two props after `categoryName={...}`:

     ```tsx
     baseCurrencyCode={baseCurrencyCode}
     toAccountName={
       transaction.to_account_id
         ? accountNameById.get(transaction.to_account_id) ?? transaction.to_account_id
         : undefined
     }
     ```

  4. Immediately after the closing `</div>` of the day-groups container (the `<div>` that wraps `dayGroups.map(...)`), and before the `)}` that closes the `items.length === 0 ? ... :` branch, add a Load more control. Concretely, change the tail of that branch from:

     ```tsx
                 ))}
               </div>
             )}
           </CardContent>
         </Card>
     ```

     to:

     ```tsx
                 ))}
                 {transactionsQuery.hasNextPage ? (
                   <div className="flex justify-center p-4">
                     <Button
                       type="button"
                       variant="outline"
                       loading={transactionsQuery.isFetchingNextPage}
                       onClick={() => transactionsQuery.fetchNextPage()}
                     >
                       Load more
                     </Button>
                   </div>
                 ) : null}
               </div>
             )}
           </CardContent>
         </Card>
     ```

- [ ] **12.7 Run the transactions page and list tests, expect pass**

  ```bash
  pnpm --filter web test -- src/pages/TransactionsPage.test.tsx
  pnpm --filter web test -- src/lib/groupTransactions.test.ts
  pnpm --filter web test -- src/lib/transactionAmount.test.ts
  ```

  All pass. The page test from Task 11 still holds because the rendered rows keep the same text content.

- [ ] **12.8 Run the full web suite and typecheck, expect pass**

  ```bash
  pnpm --filter web test
  pnpm --filter web typecheck
  ```

  Both succeed. Note the `DashboardPage` still renders `TransactionListItem`; add the required `baseCurrencyCode` prop there in Task 13. If the typecheck flags the missing prop before Task 13 runs, pass `baseCurrencyCode="PEN"` on the Dashboard's `TransactionListItem` as an interim value, which Task 13 replaces with the real settings value.

- [ ] **12.9 Commit**

  Run `commita --no-push` and confirm it created a commit.

---

## Task 13: Dashboard conversion (PEN totals from base_amount, per-currency detail, incomplete-rate notice)

**Files:**
- Create: `apps/web/src/lib/dashboardSummary.ts`
- Create: `apps/web/src/lib/dashboardSummary.test.ts`
- Modify: `apps/web/src/pages/DashboardPage.tsx` (PEN base totals, per-currency detail, incomplete-rate notice, base currency wiring)
- Modify: `apps/web/src/components/SpendingByCategory.tsx` (aggregate base_amount over occurred_at, base currency display)

**Interfaces:**

Consumes:
- `@/hooks/useTransactions`: `useTransactions` (flat list bridge, up to 200 rows, from Task 9)
- `@/hooks/useSettings`: `useSettings` (Task 9)
- `@/lib/utils`: `formatCurrency`, `toNameById`
- `@/types`: `Transaction`

Produces:
- `@/lib/dashboardSummary`:
  ```ts
  interface CurrencyBreakdown { currency: string; netBalance: number; totalSpend: number }
  interface DashboardSummary {
    baseCurrencyCode: string
    baseNetBalance: number
    baseTotalSpend: number
    hasIncompleteRates: boolean
    byCurrency: CurrencyBreakdown[]
  }
  summarizeTransactions(transactions: Transaction[], baseCurrencyCode: string): DashboardSummary
  summarizeCategorySpend(
    transactions: Transaction[],
    categoryNameById: Map<string, string>,
    range: { start: Date | null; end: Date | null },
  ): { categoryName: string; total: number }[]
  ```

### Steps

- [ ] **13.1 Write the failing summary test**

  Create `apps/web/src/lib/dashboardSummary.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest'
  import { summarizeCategorySpend, summarizeTransactions } from '@/lib/dashboardSummary'
  import { makeTransaction } from '@/test/factories'

  describe('summarizeTransactions', () => {
    it('sums base_amount excluding transfers and reports per-currency detail', () => {
      const transactions = [
        makeTransaction({ type: 'expense', amount: -20, currency: 'USD', base_amount: -74.8 }),
        makeTransaction({ type: 'income', amount: 500, currency: 'PEN', base_amount: 500 }),
        makeTransaction({
          type: 'transfer',
          amount: -100,
          currency: 'PEN',
          base_amount: -100,
          category_id: null,
          to_account_id: 'acc-2',
          to_amount: 100,
        }),
      ]
      const summary = summarizeTransactions(transactions, 'PEN')
      expect(summary.baseNetBalance).toBeCloseTo(425.2)
      expect(summary.baseTotalSpend).toBeCloseTo(74.8)
      expect(summary.hasIncompleteRates).toBe(false)
      const usd = summary.byCurrency.find((row) => row.currency === 'USD')
      expect(usd?.totalSpend).toBeCloseTo(20)
      const pen = summary.byCurrency.find((row) => row.currency === 'PEN')
      expect(pen?.netBalance).toBeCloseTo(500)
    })

    it('flags incomplete rates when a non-transfer row has no base_amount', () => {
      const transactions = [
        makeTransaction({ type: 'expense', amount: -20, currency: 'USD', base_amount: null }),
      ]
      const summary = summarizeTransactions(transactions, 'PEN')
      expect(summary.hasIncompleteRates).toBe(true)
      expect(summary.baseTotalSpend).toBeCloseTo(0)
    })
  })

  describe('summarizeCategorySpend', () => {
    it('aggregates absolute base_amount per category for expenses in range', () => {
      const categoryNameById = new Map([
        ['cat-food', 'Food'],
        ['cat-transport', 'Transport'],
      ])
      const transactions = [
        makeTransaction({
          type: 'expense',
          category_id: 'cat-food',
          base_amount: -30,
          occurred_at: '2026-07-05T12:00:00.000Z',
        }),
        makeTransaction({
          type: 'expense',
          category_id: 'cat-food',
          base_amount: -10,
          occurred_at: '2026-07-06T12:00:00.000Z',
        }),
        makeTransaction({
          type: 'expense',
          category_id: 'cat-transport',
          base_amount: -25,
          occurred_at: '2026-06-01T12:00:00.000Z',
        }),
      ]
      const spends = summarizeCategorySpend(transactions, categoryNameById, {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: null,
      })
      expect(spends).toEqual([{ categoryName: 'Food', total: 40 }])
    })
  })
  ```

- [ ] **13.2 Run the test, expect failure**

  ```bash
  pnpm --filter web test -- src/lib/dashboardSummary.test.ts
  ```

  Expected failure: `Failed to resolve import "@/lib/dashboardSummary"`.

- [ ] **13.3 Implement `apps/web/src/lib/dashboardSummary.ts`**

  ```ts
  import type { Transaction } from '@/types'

  export interface CurrencyBreakdown {
    currency: string
    netBalance: number
    totalSpend: number
  }

  export interface DashboardSummary {
    baseCurrencyCode: string
    baseNetBalance: number
    baseTotalSpend: number
    hasIncompleteRates: boolean
    byCurrency: CurrencyBreakdown[]
  }

  // Transfers move money between own accounts, so they are excluded from both the
  // base totals and the per-currency income/expense breakdown.
  export function summarizeTransactions(
    transactions: Transaction[],
    baseCurrencyCode: string,
  ): DashboardSummary {
    let baseNetBalance = 0
    let baseTotalSpend = 0
    let hasIncompleteRates = false
    const byCurrency = new Map<string, CurrencyBreakdown>()

    for (const transaction of transactions) {
      if (transaction.type === 'transfer') continue

      if (transaction.base_amount === null) {
        hasIncompleteRates = true
      } else {
        baseNetBalance += transaction.base_amount
        if (transaction.type === 'expense') {
          baseTotalSpend += Math.abs(transaction.base_amount)
        }
      }

      const currency = transaction.currency || baseCurrencyCode
      const breakdown = byCurrency.get(currency) ?? { currency, netBalance: 0, totalSpend: 0 }
      breakdown.netBalance += transaction.amount
      if (transaction.type === 'expense') {
        breakdown.totalSpend += Math.abs(transaction.amount)
      }
      byCurrency.set(currency, breakdown)
    }

    return {
      baseCurrencyCode,
      baseNetBalance,
      baseTotalSpend,
      hasIncompleteRates,
      byCurrency: Array.from(byCurrency.values()).sort(
        (first, second) => second.totalSpend - first.totalSpend,
      ),
    }
  }

  export function summarizeCategorySpend(
    transactions: Transaction[],
    categoryNameById: Map<string, string>,
    range: { start: Date | null; end: Date | null },
  ): { categoryName: string; total: number }[] {
    const totals = new Map<string, number>()
    for (const transaction of transactions) {
      if (transaction.type !== 'expense' || transaction.base_amount === null) continue
      const occurredAt = new Date(transaction.occurred_at)
      if (range.start && occurredAt < range.start) continue
      if (range.end && occurredAt >= range.end) continue
      const categoryName = categoryNameById.get(transaction.category_id ?? '') ?? 'Uncategorized'
      totals.set(categoryName, (totals.get(categoryName) ?? 0) + Math.abs(transaction.base_amount))
    }
    return Array.from(totals.entries())
      .map(([categoryName, total]) => ({ categoryName, total }))
      .sort((first, second) => second.total - first.total)
  }
  ```

- [ ] **13.4 Run the summary test, expect pass**

  ```bash
  pnpm --filter web test -- src/lib/dashboardSummary.test.ts
  ```

  All pass.

- [ ] **13.5 Rewrite `apps/web/src/pages/DashboardPage.tsx`**

  Replace the whole file with (PEN totals from `base_amount`, per-currency secondary lines, incomplete-rate notice, base currency passed through):

  ```tsx
  import { lazy, Suspense, useMemo } from 'react'
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
  import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
  import { TransactionListItem } from '@/components/transactions/TransactionListItem'
  import { useTransactions } from '@/hooks/useTransactions'
  import { useAccounts } from '@/hooks/useAccounts'
  import { useCategories } from '@/hooks/useCategories'
  import { useSettings } from '@/hooks/useSettings'
  import { summarizeTransactions } from '@/lib/dashboardSummary'
  import { formatCurrency, toNameById } from '@/lib/utils'

  // echarts is heavy; load it only when the categories tab first renders.
  const SpendingByCategory = lazy(() =>
    import('@/components/SpendingByCategory').then((module) => ({
      default: module.SpendingByCategory,
    })),
  )

  export function DashboardPage() {
    const transactionsQuery = useTransactions()
    const accountsQuery = useAccounts()
    const categoriesQuery = useCategories()
    const settingsQuery = useSettings()

    const transactions = useMemo(() => transactionsQuery.data ?? [], [transactionsQuery.data])
    const baseCurrencyCode = settingsQuery.data?.base_currency_code ?? 'PEN'

    const accountNameById = useMemo(() => toNameById(accountsQuery.data), [accountsQuery.data])
    const categoryNameById = useMemo(() => toNameById(categoriesQuery.data), [categoriesQuery.data])

    const summary = useMemo(
      () => summarizeTransactions(transactions, baseCurrencyCode),
      [transactions, baseCurrencyCode],
    )

    const recentTransactions = useMemo(() => transactions.slice(0, 8), [transactions])

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your accounts and spending</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Net balance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl font-semibold tabular-nums">
                {formatCurrency(summary.baseNetBalance, baseCurrencyCode)}
              </div>
              {summary.byCurrency.map((breakdown) => (
                <div key={breakdown.currency} className="text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(breakdown.netBalance, breakdown.currency)}
                </div>
              ))}
              {summary.hasIncompleteRates ? (
                <p className="text-xs text-muted-foreground">
                  {baseCurrencyCode} total is partial: some rows are missing rates.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total spend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl font-semibold tabular-nums">
                {formatCurrency(summary.baseTotalSpend, baseCurrencyCode)}
              </div>
              {summary.byCurrency.map((breakdown) => (
                <div key={breakdown.currency} className="text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(breakdown.totalSpend, breakdown.currency)}
                </div>
              ))}
              {summary.hasIncompleteRates ? (
                <p className="text-xs text-muted-foreground">
                  {baseCurrencyCode} total is partial: some rows are missing rates.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="recent">
              <TabsList>
                <TabsTrigger value="recent">Recent transactions</TabsTrigger>
                <TabsTrigger value="categories">Spending by category</TabsTrigger>
              </TabsList>
              <TabsContent value="recent">
                {transactionsQuery.isLoading ? (
                  <p className="py-6 text-sm text-muted-foreground">Loading transactions...</p>
                ) : recentTransactions.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">No transactions yet.</p>
                ) : (
                  <ul className="-mx-6 divide-y">
                    {recentTransactions.map((transaction) => (
                      <TransactionListItem
                        key={transaction.id}
                        transaction={transaction}
                        accountName={
                          accountNameById.get(transaction.account_id) ?? transaction.account_id
                        }
                        categoryName={
                          transaction.category_id
                            ? categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
                            : 'Uncategorized'
                        }
                        baseCurrencyCode={baseCurrencyCode}
                        toAccountName={
                          transaction.to_account_id
                            ? accountNameById.get(transaction.to_account_id) ??
                              transaction.to_account_id
                            : undefined
                        }
                        showDate
                      />
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="categories">
                {transactions.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">No spending recorded yet.</p>
                ) : (
                  <Suspense
                    fallback={
                      <p className="py-6 text-sm text-muted-foreground">Loading charts...</p>
                    }
                  >
                    <SpendingByCategory
                      transactions={transactions}
                      categoryNameById={categoryNameById}
                      baseCurrencyCode={baseCurrencyCode}
                    />
                  </Suspense>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    )
  }
  ```

- [ ] **13.6 Rewrite `apps/web/src/components/SpendingByCategory.tsx`**

  The chart now aggregates the frozen `base_amount` (base currency) over `occurred_at`, so the per-transaction currency selector is removed and every total renders in the base currency. Replace the whole file with:

  ```tsx
  import { useMemo, useState } from 'react'
  import { EChart } from '@/components/EChart'
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '@/components/ui/select'
  import { summarizeCategorySpend } from '@/lib/dashboardSummary'
  import { formatCurrency } from '@/lib/utils'
  import type { EChartsCoreOption } from 'echarts/core'
  import type { Transaction } from '@/types'

  // Validated categorical palette from the dataviz reference (light mode, 8 slots).
  const categoricalPalette = [
    '#2a78d6',
    '#1baf7a',
    '#eda100',
    '#008300',
    '#4a3aa7',
    '#e34948',
    '#e87ba4',
    '#eb6834',
  ]
  const overflowSliceColor = '#9aa1ac'
  const chartInk = 'hsl(222.2 84% 4.9%)'

  const periodOptions = [
    { value: 'this-month', label: 'This month' },
    { value: 'last-month', label: 'Last month' },
    { value: 'last-3-months', label: 'Last 3 months' },
    { value: 'this-year', label: 'This year' },
    { value: 'all', label: 'All time' },
  ] as const

  type Period = (typeof periodOptions)[number]['value']

  interface SpendingByCategoryProps {
    transactions: Transaction[]
    categoryNameById: Map<string, string>
    baseCurrencyCode: string
  }

  function getPeriodRange(period: Period): { start: Date | null; end: Date | null } {
    const now = new Date()
    switch (period) {
      case 'this-month':
        return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null }
      case 'last-month':
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          end: new Date(now.getFullYear(), now.getMonth(), 1),
        }
      case 'last-3-months':
        return { start: new Date(now.getFullYear(), now.getMonth() - 2, 1), end: null }
      case 'this-year':
        return { start: new Date(now.getFullYear(), 0, 1), end: null }
      case 'all':
        return { start: null, end: null }
    }
  }

  export function SpendingByCategory({
    transactions,
    categoryNameById,
    baseCurrencyCode,
  }: SpendingByCategoryProps) {
    const [period, setPeriod] = useState<Period>('this-month')

    // Colors follow the category across every period change, ranked by all-time
    // base spend so a category never gets repainted when the period shrinks the set.
    const colorByCategory = useMemo(() => {
      const ranked = summarizeCategorySpend(transactions, categoryNameById, {
        start: null,
        end: null,
      })
      const colors = new Map<string, string>()
      ranked.forEach((categorySpend, index) => {
        colors.set(categorySpend.categoryName, categoricalPalette[index] ?? overflowSliceColor)
      })
      return colors
    }, [transactions, categoryNameById])

    const categorySpends = useMemo(
      () => summarizeCategorySpend(transactions, categoryNameById, getPeriodRange(period)),
      [transactions, categoryNameById, period],
    )

    const hasIncompleteRates = useMemo(
      () =>
        transactions.some(
          (transaction) => transaction.type === 'expense' && transaction.base_amount === null,
        ),
      [transactions],
    )

    const chartOption = useMemo<EChartsCoreOption>(() => {
      const topCategories = categorySpends.slice(0, categoricalPalette.length)
      const overflowTotal = categorySpends
        .slice(categoricalPalette.length)
        .reduce((sum, categorySpend) => sum + categorySpend.total, 0)
      const slices = topCategories.map((categorySpend) => ({
        name: categorySpend.categoryName,
        value: Number(categorySpend.total.toFixed(2)),
        itemStyle: { color: colorByCategory.get(categorySpend.categoryName) ?? overflowSliceColor },
      }))
      if (overflowTotal > 0) {
        slices.push({
          name: 'Other',
          value: Number(overflowTotal.toFixed(2)),
          itemStyle: { color: overflowSliceColor },
        })
      }
      const periodTotal = categorySpends.reduce((sum, categorySpend) => sum + categorySpend.total, 0)
      return {
        tooltip: {
          trigger: 'item',
          valueFormatter: (value: unknown) => formatCurrency(Number(value), baseCurrencyCode),
        },
        title: {
          text: formatCurrency(periodTotal, baseCurrencyCode),
          subtext: 'total spend',
          left: 'center',
          top: '42%',
          textStyle: { fontSize: 18, color: chartInk },
          subtextStyle: { fontSize: 12 },
        },
        series: [
          {
            type: 'pie',
            radius: ['45%', '68%'],
            itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 4 },
            label: { formatter: '{b}  {d}%', color: chartInk },
            data: slices,
          },
        ],
      }
    }, [categorySpends, colorByCategory, baseCurrencyCode])

    return (
      <div className="space-y-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
            <SelectTrigger className="w-40" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((periodOption) => (
                <SelectItem key={periodOption.value} value={periodOption.value}>
                  {periodOption.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasIncompleteRates ? (
            <span className="text-xs text-muted-foreground">
              Some expenses are missing rates and are excluded from these totals.
            </span>
          ) : null}
        </div>
        {categorySpends.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No spending in {baseCurrencyCode} for this period.</p>
        ) : (
          <EChart option={chartOption} height={420} />
        )}
      </div>
    )
  }
  ```

- [ ] **13.7 Run the full web suite and typecheck, expect pass**

  ```bash
  pnpm --filter web test
  pnpm --filter web typecheck
  ```

  Both succeed. The `SpendingByCategory` shim edit from Task 9 (step 9.8) is superseded by this rewrite, and the `DashboardPage` interim `baseCurrencyCode="PEN"` from Task 12 (step 12.8), if it was added, is superseded here.

- [ ] **13.8 Commit**

  Run `commita --no-push` and confirm it created a commit.

- [ ] **13.9 Final full-repo verification**

  ```bash
  pnpm -r typecheck
  pnpm -r test
  ```

  Both succeed across every package, confirming section C integrates with the backend sections.

---

## Section C summary of produced and consumed signatures

Produced by this section (available to the Android/other sections only through the HTTP API; these are web-internal):
- Task 9: `@/types` upgrade; `@/lib/filterParams` (`filtersToSearchParams`, `searchParamsToFilters`, `filtersToApiSearchParams`); `@/lib/api` (`listTransactionsPage`, `currenciesApi`, `settingsApi`, bridged `transactionsApi.list`); `@/hooks` (`useTransactionsInfinite`, `useCurrencies`, `useSettings`, `useUpdateSettings`); `@/test` helpers.
- Task 10: redesigned `TransactionFormDialog` (adds `existingPayees` and `payeeCategoryHistory` props, the latter pre-filling the category from the payee's last used category; consumes `useCurrencies`, `useSettings`).
- Task 11: `@/lib/datePresets` (`presetRange`, `detectPreset`, `datePresetOptions`); `FilterBar`; `TransactionTotalsBar`; URL-driven `TransactionsPage`.
- Task 12: `@/lib/groupTransactions` (`groupTransactionsByDay`); `@/lib/transactionAmount` (`formatTransactionAmount`, `formatTransferRoute`); reworked `TransactionListItem` (adds `baseCurrencyCode`, `toAccountName`).
- Task 13: `@/lib/dashboardSummary` (`summarizeTransactions`, `summarizeCategorySpend`); converted `DashboardPage`; base-currency `SpendingByCategory`.

Consumed from other plan sections (backend, mocked in every web test):
- `GET /api/transactions` paginated envelope with `items`, `next_cursor`, `totals` and the full filter query-param contract.
- `GET /api/currencies`, `GET /api/settings` (and `PUT /api/settings`).
- Existing `GET /api/accounts`, `GET /api/categories`, `GET /api/tags` and the transactions CRUD verbs.

