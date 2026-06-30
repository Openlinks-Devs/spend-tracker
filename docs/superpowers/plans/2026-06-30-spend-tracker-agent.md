# SpendTracker Autonomous Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Hono.js + Node service that polls Gmail, detects bank transaction emails, extracts spend data with the Vercel AI SDK, records each transaction in the existing Postgres DB, and notifies + accepts edits over Telegram.

**Architecture:** A single Node process. Hono (via `@hono/node-server`) exposes health, Google OAuth callback, and a Telegram webhook. A timer-driven Gmail poller pushes new emails through a deterministic pipeline: detect -> fetch reference data -> extract -> validate -> insert -> notify. LLMs (AI SDK `generateObject` + Zod) do only detect / extract / reclassify; all routing and persistence is plain code over raw SQL.

**Tech Stack:** TypeScript (ESM), Hono, `@hono/node-server`, `ai` + `@ai-sdk/openai`, `googleapis`, `pg`, `zod`, Vitest, Docker.

## Global Constraints

- Runtime: Node 20+, TypeScript ESM (`"type": "module"`).
- LLM model: `gpt-5-mini`, read from `OPENAI_MODEL` (default `gpt-5-mini`).
- Database: existing Postgres. Schema is fixed: `categories(id uuid, name, type)`, `accounts(id uuid, name, type, currency)`, `transactions(id uuid, description, amount numeric, currency, account_id uuid, category_id uuid, tags text[], created_at timestamptz, updated_at timestamptz)`. Do not alter existing tables. The only new object is `agent_state(key text primary key, value text)`.
- Timezone for date reasoning: `America/Lima`.
- Variable naming: descriptive domain names always (`account`, `category`, `transaction`), never single letters except numeric loop counters.
- No em dashes anywhere (code, comments, docs, commit messages, UI copy).
- Telegram messages use HTML parse mode.
- Commits: use `commita --no-push` at the end of each task (the user's commita tool). Do not use raw `git commit`. The final task pushes.
- Tests use Vitest and must not hit the network or a real DB. Mock `pg`, the AI SDK, `googleapis`, and Telegram HTTP.

---

### Task 1: Project scaffold + health endpoint

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.dockerignore`, `.env.example`
- Create: `src/index.ts`, `src/app.ts`, `src/routes/health.ts`
- Test: `test/health.test.ts`

**Interfaces:**
- Produces: `buildApp(): Hono` in `src/app.ts` returning the configured Hono app (used by all later HTTP tasks and by `index.ts`).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "spend-tracker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-sdk/openai": "^2.0.0",
    "@hono/node-server": "^1.13.0",
    "ai": "^5.0.0",
    "googleapis": "^144.0.0",
    "hono": "^4.6.0",
    "pg": "^8.13.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Then run `npm install`. (If `ai` / `@ai-sdk/openai` resolve to a newer major, keep it and adjust the `generateObject` calls in later tasks to the installed API; verify against `node_modules/ai/docs/`.)

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`, `.gitignore`, `.dockerignore`, `.env.example`**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
```

`.gitignore`:
```
node_modules
dist
.env
coverage
```

`.dockerignore`:
```
node_modules
dist
.git
.env
coverage
docs
test
```

`.env.example`:
```
DATABASE_URL=postgres://user:pass@host:5432/spendtracker
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback
GOOGLE_REFRESH_TOKEN=
GMAIL_POLL_INTERVAL_MS=60000
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_WEBHOOK_URL=
PORT=3000
TZ=America/Lima
```

- [ ] **Step 4: Write the failing test** in `test/health.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app.js'

describe('health route', () => {
  it('returns ok', async () => {
    const app = buildApp()
    const response = await app.request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -- test/health.test.ts`
Expected: FAIL, cannot find `../src/app.js`.

- [ ] **Step 6: Implement `src/routes/health.ts` and `src/app.ts`**

`src/routes/health.ts`:
```ts
import { Hono } from 'hono'

export const healthRoute = new Hono()

healthRoute.get('/health', (context) => context.json({ status: 'ok' }))
```

`src/app.ts`:
```ts
import { Hono } from 'hono'
import { healthRoute } from './routes/health.js'

export function buildApp(): Hono {
  const app = new Hono()
  app.route('/', healthRoute)
  return app
}
```

- [ ] **Step 7: Implement `src/index.ts`** (bootstrap; later tasks extend it)

```ts
import { serve } from '@hono/node-server'
import { buildApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)
const app = buildApp()

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SpendTracker listening on :${info.port}`)
})
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- test/health.test.ts` then `npm run typecheck`
Expected: test PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
commita --no-push
```

---

### Task 2: Environment config

**Files:**
- Create: `src/config/env.ts`
- Test: `test/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(source?: Record<string, string | undefined>): Env` and the `Env` type with fields `DATABASE_URL, OPENAI_API_KEY, OPENAI_MODEL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN, GMAIL_POLL_INTERVAL_MS (number), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_URL, PORT (number)`. All later tasks import `loadEnv`.

- [ ] **Step 1: Write the failing test** in `test/env.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { loadEnv } from '../src/config/env.js'

const complete = {
  DATABASE_URL: 'postgres://localhost/db',
  OPENAI_API_KEY: 'sk-test',
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REDIRECT_URI: 'http://localhost/cb',
  GOOGLE_REFRESH_TOKEN: 'refresh',
  TELEGRAM_BOT_TOKEN: 'bot',
  TELEGRAM_CHAT_ID: '123',
  TELEGRAM_WEBHOOK_SECRET: 'whsecret',
  TELEGRAM_WEBHOOK_URL: 'https://example.com/telegram/webhook',
}

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    const env = loadEnv(complete)
    expect(env.OPENAI_MODEL).toBe('gpt-5-mini')
    expect(env.GMAIL_POLL_INTERVAL_MS).toBe(60000)
    expect(env.PORT).toBe(3000)
  })

  it('throws when a required value is missing', () => {
    const { DATABASE_URL, ...incomplete } = complete
    expect(() => loadEnv(incomplete)).toThrow(/DATABASE_URL/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/env.test.ts`
Expected: FAIL, cannot find `../src/config/env.js`.

- [ ] **Step 3: Implement `src/config/env.ts`**

```ts
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-5-mini'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().min(1),
  GOOGLE_REFRESH_TOKEN: z.string().min(1),
  GMAIL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_WEBHOOK_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new Error(`Invalid or missing environment variables: ${missing}`)
  }
  return parsed.data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/env.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
commita --no-push
```

---

### Task 3: Database layer (pool + queries)

**Files:**
- Create: `src/db/pool.ts`, `src/db/queries.ts`, `src/db/types.ts`
- Test: `test/queries.test.ts`

**Interfaces:**
- Consumes: `loadEnv` (Task 2).
- Produces:
  - Types in `src/db/types.ts`: `Category { id: string; name: string; type: string }`, `Account { id: string; name: string; type: string; currency: string }`, `NewTransaction { description: string; amount: number; currency: string; account_id: string; category_id: string; tags: string[]; created_at: string }`, `TransactionUpdate { id: string; description: string; category_id: string; tags: string[] }`.
  - `src/db/pool.ts`: `getPool(): Pool` (lazy singleton) and `type Queryable = { query: Pool['query'] }`.
  - `src/db/queries.ts` functions, each taking a `Queryable` as first argument so tests can pass a fake: `getCategories(db)`, `getAccounts(db)`, `getDistinctTags(db): Promise<string[]>`, `insertTransaction(db, tx: NewTransaction): Promise<{ id: string }>`, `updateTransaction(db, update: TransactionUpdate): Promise<void>`, `deleteTransaction(db, id: string): Promise<void>`, `getState(db, key): Promise<string | null>`, `setState(db, key, value): Promise<void>`, `ensureStateTable(db): Promise<void>`.

- [ ] **Step 1: Write the failing test** in `test/queries.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  getCategories,
  getDistinctTags,
  insertTransaction,
  deleteTransaction,
  setState,
} from '../src/db/queries.js'

function fakeDb(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('queries', () => {
  it('getCategories returns rows', async () => {
    const db = fakeDb([{ id: 'c1', name: 'Food', type: 'expense' }])
    const categories = await getCategories(db)
    expect(categories[0].name).toBe('Food')
    expect(db.query.mock.calls[0][0]).toMatch(/from categories/i)
  })

  it('getDistinctTags flattens to strings', async () => {
    const db = fakeDb([{ tag: 'food' }, { tag: 'delivery' }])
    const tags = await getDistinctTags(db)
    expect(tags).toEqual(['food', 'delivery'])
  })

  it('insertTransaction passes params and returns id', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'tx1' }] }) }
    const result = await insertTransaction(db, {
      description: 'PLIN', amount: -35, currency: 'PEN',
      account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
      created_at: '2026-06-30T10:00:00.000Z',
    })
    expect(result.id).toBe('tx1')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/insert into transactions/i)
    expect(params).toContain('PLIN')
    expect(params).toContain(-35)
  })

  it('deleteTransaction issues a delete with the id', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await deleteTransaction(db, 'tx1')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/delete from transactions/i)
    expect(params).toEqual(['tx1'])
  })

  it('setState upserts', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await setState(db, 'gmail_history_id', '42')
    expect(db.query.mock.calls[0][0]).toMatch(/on conflict/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/queries.test.ts`
Expected: FAIL, cannot find `../src/db/queries.js`.

- [ ] **Step 3: Implement `src/db/types.ts`**

```ts
export interface Category {
  id: string
  name: string
  type: string
}

export interface Account {
  id: string
  name: string
  type: string
  currency: string
}

export interface NewTransaction {
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string
  tags: string[]
  created_at: string
}

export interface TransactionUpdate {
  id: string
  description: string
  category_id: string
  tags: string[]
}
```

- [ ] **Step 4: Implement `src/db/pool.ts`**

```ts
import pg from 'pg'
import { loadEnv } from '../config/env.js'

export type Queryable = Pick<pg.Pool, 'query'>

let pool: pg.Pool | undefined

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: loadEnv().DATABASE_URL })
  }
  return pool
}
```

- [ ] **Step 5: Implement `src/db/queries.ts`**

```ts
import type { Queryable } from './pool.js'
import type { Account, Category, NewTransaction, TransactionUpdate } from './types.js'

export async function getCategories(db: Queryable): Promise<Category[]> {
  const result = await db.query('SELECT id, name, type FROM categories')
  return result.rows as Category[]
}

export async function getAccounts(db: Queryable): Promise<Account[]> {
  const result = await db.query('SELECT id, name, type, currency FROM accounts')
  return result.rows as Account[]
}

export async function getDistinctTags(db: Queryable): Promise<string[]> {
  const result = await db.query('SELECT DISTINCT unnest(tags) AS tag FROM transactions')
  return result.rows.map((row: { tag: string }) => row.tag)
}

export async function insertTransaction(
  db: Queryable,
  transaction: NewTransaction,
): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO transactions
       (description, amount, currency, account_id, category_id, tags, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      transaction.description,
      transaction.amount,
      transaction.currency,
      transaction.account_id,
      transaction.category_id,
      transaction.tags,
      transaction.created_at,
    ],
  )
  return { id: result.rows[0].id as string }
}

export async function updateTransaction(db: Queryable, update: TransactionUpdate): Promise<void> {
  await db.query(
    `UPDATE transactions
       SET description = $2, category_id = $3, tags = $4, updated_at = now()
     WHERE id = $1`,
    [update.id, update.description, update.category_id, update.tags],
  )
}

export async function deleteTransaction(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM transactions WHERE id = $1', [id])
}

export async function ensureStateTable(db: Queryable): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS agent_state (key text PRIMARY KEY, value text)')
}

export async function getState(db: Queryable, key: string): Promise<string | null> {
  const result = await db.query('SELECT value FROM agent_state WHERE key = $1', [key])
  return result.rows.length ? (result.rows[0].value as string) : null
}

export async function setState(db: Queryable, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO agent_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- test/queries.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
commita --no-push
```

---

### Task 4: AI provider + transaction detector

**Files:**
- Create: `src/ai/provider.ts`, `src/ai/detect.ts`
- Test: `test/detect.test.ts`

**Interfaces:**
- Consumes: `loadEnv` (Task 2).
- Produces:
  - `src/ai/provider.ts`: `getModel()` returning an AI SDK `LanguageModel` for `OPENAI_MODEL`.
  - `src/ai/detect.ts`: `detectTransaction(input: { subject: string; text: string }): Promise<boolean>`.

- [ ] **Step 1: Write the failing test** in `test/detect.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'

const generateObject = vi.fn()
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }))
vi.mock('../src/ai/provider.js', () => ({ getModel: () => 'mock-model' }))

import { detectTransaction } from '../src/ai/detect.js'

describe('detectTransaction', () => {
  it('returns true when the model flags a transaction', async () => {
    generateObject.mockResolvedValue({ object: { is_transaction_email: true } })
    const result = await detectTransaction({ subject: 'Consumo BCP', text: 'S/ 35.00' })
    expect(result).toBe(true)
  })

  it('returns false for promotional mail', async () => {
    generateObject.mockResolvedValue({ object: { is_transaction_email: false } })
    const result = await detectTransaction({ subject: 'Oferta', text: 'descuento' })
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/detect.test.ts`
Expected: FAIL, cannot find `../src/ai/detect.js`.

- [ ] **Step 3: Implement `src/ai/provider.ts`**

```ts
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { loadEnv } from '../config/env.js'

export function getModel(): LanguageModel {
  const env = loadEnv()
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY })
  return openai(env.OPENAI_MODEL)
}
```

- [ ] **Step 4: Implement `src/ai/detect.ts`**

```ts
import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './provider.js'

const schema = z.object({ is_transaction_email: z.boolean() })

const systemPrompt =
  'Eres un experto clasificando textos. Devuelve is_transaction_email=true si y solo si ' +
  'el correo describe una transaccion monetaria, consumo con tarjeta, movimiento o ' +
  'transferencia bancaria. Los textos promocionales, publicitarios o de marketing son false.'

export async function detectTransaction(input: { subject: string; text: string }): Promise<boolean> {
  const { object } = await generateObject({
    model: getModel(),
    schema,
    maxRetries: 2,
    system: systemPrompt,
    prompt: `Subject: ${input.subject}\n\nBody: ${input.text}`,
  })
  return object.is_transaction_email
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/detect.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean. (If `generateObject`'s options differ in the installed `ai` version, check `node_modules/ai/docs/` and adjust `system`/`prompt`/`maxRetries` names.)

- [ ] **Step 6: Commit**

```bash
commita --no-push
```

---

### Task 5: Transaction extractor

**Files:**
- Create: `src/ai/extract.ts`
- Test: `test/extract.test.ts`

**Interfaces:**
- Consumes: `getModel` (Task 4), `Category`/`Account` types (Task 3).
- Produces: `extractTransaction(input: { text: string; categories: Category[]; accounts: Account[]; tags: string[]; now: string }): Promise<ExtractedTransaction | null>` where `ExtractedTransaction = { description: string; amount: number; currency: string; account_id: string; category_id: string; tags: string[]; created_at: string }`. Returns `null` when the model cannot resolve `account_id` (the n8n "no account" branch).

- [ ] **Step 1: Write the failing test** in `test/extract.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'

const generateObject = vi.fn()
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }))
vi.mock('../src/ai/provider.js', () => ({ getModel: () => 'mock-model' }))

import { extractTransaction } from '../src/ai/extract.js'

const refs = {
  categories: [{ id: 'c1', name: 'Food', type: 'expense' }],
  accounts: [{ id: 'a1', name: 'Debito BCP', type: 'DEBIT', currency: 'PEN' }],
  tags: ['food'],
  now: '2026-06-30T10:00:00.000Z',
}

describe('extractTransaction', () => {
  it('returns the parsed transaction', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'PLIN-MARISELA CALLE', amount: -35, currency: 'PEN',
        account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
        created_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'Consumo S/ 35.00', ...refs })
    expect(result?.account_id).toBe('a1')
    expect(result?.amount).toBe(-35)
  })

  it('returns null when account_id is missing', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'x', amount: -1, currency: 'PEN',
        account_id: null, category_id: 'c1', tags: ['a', 'b', 'c'],
        created_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'something', ...refs })
    expect(result).toBeNull()
  })

  it('returns null when account_id is not a known account', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'x', amount: -1, currency: 'PEN',
        account_id: 'unknown', category_id: 'c1', tags: ['a', 'b', 'c'],
        created_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'something', ...refs })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/extract.test.ts`
Expected: FAIL, cannot find `../src/ai/extract.js`.

- [ ] **Step 3: Implement `src/ai/extract.ts`**

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
  created_at: z.string(),
})

export interface ExtractedTransaction {
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string
  tags: string[]
  created_at: string
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
    'category_id y account_id son distintos y deben venir de las listas dadas.',
    'Si no hay informacion suficiente para un campo usa null.',
    'tags: minimo 3, en minusculas, una sola palabra por tag.',
    `Fecha y hora actual: ${input.now}. Zona horaria: America/Lima.`,
    'Si el correo usa fechas relativas, calcula created_at en formato ISO 8601.',
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
    created_at: object.created_at,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/extract.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
commita --no-push
```

---

### Task 6: Edit reclassifier

**Files:**
- Create: `src/ai/classify.ts`
- Test: `test/classify.test.ts`

**Interfaces:**
- Consumes: `getModel` (Task 4), `Category` type (Task 3).
- Produces: `classifyEdit(input: { description: string; categories: Category[]; tags: string[] }): Promise<{ category_id: string; tags: string[] }>`.

- [ ] **Step 1: Write the failing test** in `test/classify.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'

const generateObject = vi.fn()
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }))
vi.mock('../src/ai/provider.js', () => ({ getModel: () => 'mock-model' }))

import { classifyEdit } from '../src/ai/classify.js'

describe('classifyEdit', () => {
  it('returns the best category and tags', async () => {
    generateObject.mockResolvedValue({ object: { category_id: 'c2', tags: ['transport', 'taxi'] } })
    const result = await classifyEdit({
      description: 'Taxi a casa',
      categories: [{ id: 'c2', name: 'Transport', type: 'expense' }],
      tags: ['transport'],
    })
    expect(result.category_id).toBe('c2')
    expect(result.tags).toContain('taxi')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/classify.test.ts`
Expected: FAIL, cannot find `../src/ai/classify.js`.

- [ ] **Step 3: Implement `src/ai/classify.ts`**

```ts
import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './provider.js'
import type { Category } from '../db/types.js'

const schema = z.object({
  category_id: z.string(),
  tags: z.array(z.string()),
})

export interface ClassifyInput {
  description: string
  categories: Category[]
  tags: string[]
}

export async function classifyEdit(input: ClassifyInput): Promise<{ category_id: string; tags: string[] }> {
  const system = [
    'Eres experto clasificando descripciones de transacciones monetarias.',
    'Devuelve el category_id que mejor calza y una lista de tags relevantes.',
    'Categorias de referencia:',
    JSON.stringify(input.categories, null, 2),
    'Tags de referencia:',
    JSON.stringify(input.tags, null, 2),
    'tags: en minusculas, una sola palabra por tag.',
  ].join('\n')

  const { object } = await generateObject({
    model: getModel(),
    schema,
    maxRetries: 2,
    system,
    prompt: `Descripcion: ${input.description}`,
  })
  return object
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/classify.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
commita --no-push
```

---

### Task 7: Gmail message parsing

**Files:**
- Create: `src/gmail/parse.ts`
- Test: `test/parse.test.ts`

**Interfaces:**
- Produces: `parseMessage(message: GmailMessage): { subject: string; text: string }` where `GmailMessage` is the `gmail_v1.Schema$Message` shape. Decodes the plain-text body (base64url) and reads the `Subject` header; collapses repeated newlines to single spaces (matching the n8n "Edit Fields" replace).

- [ ] **Step 1: Write the failing test** in `test/parse.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseMessage } from '../src/gmail/parse.js'

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

describe('parseMessage', () => {
  it('reads subject and decodes a simple text body', () => {
    const result = parseMessage({
      payload: {
        headers: [{ name: 'Subject', value: 'Consumo BCP' }],
        mimeType: 'text/plain',
        body: { data: encode('Realizaste un consumo\n\nde S/ 35.00') },
      },
    })
    expect(result.subject).toBe('Consumo BCP')
    expect(result.text).toBe('Realizaste un consumo de S/ 35.00')
  })

  it('finds the text/plain part in a multipart message', () => {
    const result = parseMessage({
      payload: {
        headers: [{ name: 'Subject', value: 'Multi' }],
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: encode('<p>hi</p>') } },
          { mimeType: 'text/plain', body: { data: encode('plain body') } },
        ],
      },
    })
    expect(result.text).toBe('plain body')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/parse.test.ts`
Expected: FAIL, cannot find `../src/gmail/parse.js`.

- [ ] **Step 3: Implement `src/gmail/parse.ts`**

```ts
import type { gmail_v1 } from 'googleapis'

export type GmailMessage = gmail_v1.Schema$Message

function decode(data: string | null | undefined): string {
  if (!data) return ''
  return Buffer.from(data, 'base64url').toString('utf8')
}

function findTextPart(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decode(part.body.data)
  }
  for (const child of part.parts ?? []) {
    const found = findTextPart(child)
    if (found) return found
  }
  if (part.body?.data) return decode(part.body.data)
  return ''
}

export function parseMessage(message: GmailMessage): { subject: string; text: string } {
  const headers = message.payload?.headers ?? []
  const subjectHeader = headers.find((header) => header.name?.toLowerCase() === 'subject')
  const rawText = findTextPart(message.payload ?? undefined)
  const text = rawText.replace(/\s*\n+\s*/g, ' ').trim()
  return { subject: subjectHeader?.value ?? '', text }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/parse.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
commita --no-push
```

---

### Task 8: Gmail client + poller

**Files:**
- Create: `src/gmail/client.ts`, `src/gmail/poller.ts`
- Test: `test/poller.test.ts`

**Interfaces:**
- Consumes: `loadEnv` (Task 2), `parseMessage` (Task 7), `getState`/`setState`/`ensureStateTable` (Task 3).
- Produces:
  - `src/gmail/client.ts`: `createGmailClient(): gmail_v1.Gmail` (OAuth2 with refresh token). `fetchNewMessageIds(gmail, startHistoryId): Promise<{ messageIds: string[]; newHistoryId: string }>`. `getCurrentHistoryId(gmail): Promise<string>`. `fetchMessage(gmail, id): Promise<GmailMessage>`.
  - `src/gmail/poller.ts`: `pollOnce(deps: { gmail; db; onEmail: (email: { subject: string; text: string; messageId: string }) => Promise<void> }): Promise<void>` and `startPolling(deps, intervalMs): () => void` (returns a stop function). `pollOnce` handles first-run cursor seeding via `agent_state` key `gmail_history_id`.

- [ ] **Step 1: Write the failing test** in `test/poller.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { pollOnce } from '../src/gmail/poller.js'

vi.mock('../src/gmail/client.js', () => ({
  getCurrentHistoryId: vi.fn().mockResolvedValue('100'),
  fetchNewMessageIds: vi.fn().mockResolvedValue({ messageIds: ['m1'], newHistoryId: '101' }),
  fetchMessage: vi.fn().mockResolvedValue({
    payload: { headers: [{ name: 'Subject', value: 'S' }], mimeType: 'text/plain',
      body: { data: Buffer.from('hello').toString('base64url') } },
  }),
}))

function fakeDb(initial: Record<string, string> = {}) {
  const store = { ...initial }
  return {
    store,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/create table/i.test(sql)) return { rows: [] }
      if (/select value/i.test(sql)) {
        const key = params![0] as string
        return { rows: key in store ? [{ value: store[key] }] : [] }
      }
      if (/insert into agent_state/i.test(sql)) {
        store[params![0] as string] = params![1] as string
        return { rows: [] }
      }
      return { rows: [] }
    }),
  }
}

describe('pollOnce', () => {
  it('seeds the cursor on first run and does not emit emails', async () => {
    const db = fakeDb()
    const onEmail = vi.fn()
    await pollOnce({ gmail: {} as never, db, onEmail })
    expect(onEmail).not.toHaveBeenCalled()
    expect(db.store['gmail_history_id']).toBe('100')
  })

  it('emits parsed emails and advances the cursor on later runs', async () => {
    const db = fakeDb({ gmail_history_id: '100' })
    const onEmail = vi.fn()
    await pollOnce({ gmail: {} as never, db, onEmail })
    expect(onEmail).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', subject: 'S', text: 'hello' }),
    )
    expect(db.store['gmail_history_id']).toBe('101')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/poller.test.ts`
Expected: FAIL, cannot find `../src/gmail/poller.js`.

- [ ] **Step 3: Implement `src/gmail/client.ts`**

```ts
import { google, type gmail_v1 } from 'googleapis'
import { loadEnv } from '../config/env.js'
import type { GmailMessage } from './parse.js'

export function createGmailClient(): gmail_v1.Gmail {
  const env = loadEnv()
  const auth = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  )
  auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

export async function getCurrentHistoryId(gmail: gmail_v1.Gmail): Promise<string> {
  const profile = await gmail.users.getProfile({ userId: 'me' })
  return String(profile.data.historyId)
}

export async function fetchNewMessageIds(
  gmail: gmail_v1.Gmail,
  startHistoryId: string,
): Promise<{ messageIds: string[]; newHistoryId: string }> {
  const messageIds: string[] = []
  let pageToken: string | undefined
  let newHistoryId = startHistoryId
  do {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      pageToken,
    })
    if (response.data.historyId) newHistoryId = String(response.data.historyId)
    for (const history of response.data.history ?? []) {
      for (const added of history.messagesAdded ?? []) {
        if (added.message?.id) messageIds.push(added.message.id)
      }
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)
  return { messageIds: [...new Set(messageIds)], newHistoryId }
}

export async function fetchMessage(gmail: gmail_v1.Gmail, id: string): Promise<GmailMessage> {
  const response = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
  return response.data
}
```

- [ ] **Step 4: Implement `src/gmail/poller.ts`**

```ts
import type { gmail_v1 } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import { ensureStateTable, getState, setState } from '../db/queries.js'
import { fetchMessage, fetchNewMessageIds, getCurrentHistoryId } from './client.js'
import { parseMessage } from './parse.js'

const HISTORY_KEY = 'gmail_history_id'

export interface PollDeps {
  gmail: gmail_v1.Gmail
  db: Queryable
  onEmail: (email: { subject: string; text: string; messageId: string }) => Promise<void>
}

export async function pollOnce(deps: PollDeps): Promise<void> {
  await ensureStateTable(deps.db)
  const cursor = await getState(deps.db, HISTORY_KEY)

  if (!cursor) {
    const current = await getCurrentHistoryId(deps.gmail)
    await setState(deps.db, HISTORY_KEY, current)
    return
  }

  const { messageIds, newHistoryId } = await fetchNewMessageIds(deps.gmail, cursor)
  for (const messageId of messageIds) {
    const message = await fetchMessage(deps.gmail, messageId)
    const parsed = parseMessage(message)
    await deps.onEmail({ ...parsed, messageId })
  }
  await setState(deps.db, HISTORY_KEY, newHistoryId)
}

export function startPolling(deps: PollDeps, intervalMs: number): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      await pollOnce(deps)
    } catch (error) {
      console.error('Gmail poll failed:', error)
    }
    if (!stopped) setTimeout(tick, intervalMs)
  }
  void tick()
  return () => {
    stopped = true
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/poller.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
commita --no-push
```

---

### Task 9: Telegram client + message formatting

**Files:**
- Create: `src/telegram/client.ts`, `src/telegram/format.ts`
- Test: `test/telegram-format.test.ts`, `test/telegram-client.test.ts`

**Interfaces:**
- Consumes: `loadEnv` (Task 2), DB types (Task 3).
- Produces:
  - `src/telegram/format.ts`: `formatNewTransaction(input)`, `formatUpdatedTransaction(input)`, `formatDeleted()`, `formatError(detail)` returning HTML strings. `formatNewTransaction` input: `{ id, description, accountName, categoryName, tags, currency, amount, created_at }`. `formatUpdatedTransaction` input: `{ id, description, categoryName, tags }`.
  - `src/telegram/client.ts`: `sendMessage(text, options?: { replyToMessageId?: number }): Promise<void>` (posts to Telegram Bot API using `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, HTML parse mode, `globalThis.fetch`).

- [ ] **Step 1: Write the failing tests**

`test/telegram-format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { formatNewTransaction, formatDeleted } from '../src/telegram/format.js'

describe('telegram format', () => {
  it('includes the id and amount in a new-transaction message', () => {
    const message = formatNewTransaction({
      id: 'tx1', description: 'PLIN', accountName: 'Debito BCP', categoryName: 'Food',
      tags: ['food', 'plin'], currency: 'PEN', amount: -35, created_at: '2026-06-29T20:55:00.000Z',
    })
    expect(message).toContain('ID: tx1')
    expect(message).toContain('PEN')
    expect(message).toContain('-35')
  })

  it('formats a delete confirmation', () => {
    expect(formatDeleted()).toContain('eliminada')
  })
})
```

`test/telegram-client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const env = {
  TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHAT_ID: '123',
}
vi.mock('../src/config/env.js', () => ({ loadEnv: () => env }))

import { sendMessage } from '../src/telegram/client.js'

describe('sendMessage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }))
  })

  it('posts to the Telegram sendMessage endpoint with HTML parse mode', async () => {
    await sendMessage('hello')
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('/botbot/sendMessage')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.chat_id).toBe('123')
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toBe('hello')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/telegram-format.test.ts test/telegram-client.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/telegram/format.ts`**

```ts
export interface NewTransactionView {
  id: string
  description: string
  accountName: string
  categoryName: string
  tags: string[]
  currency: string
  amount: number
  created_at: string
}

export function formatNewTransaction(view: NewTransactionView): string {
  return [
    'Nueva transaccion creada en SpendTracker:',
    '',
    `<strong>${view.description}</strong>`,
    '',
    `<pre>ID: ${view.id}`,
    `Account: ${view.accountName}`,
    `Category: ${view.categoryName}`,
    `Tags: ${view.tags.join(', ')}`,
    '</pre>',
    `Amount: ${view.currency} ${view.amount}`,
    '',
    `Fecha/hora: <code>${view.created_at}</code>`,
  ].join('\n')
}

export interface UpdatedTransactionView {
  id: string
  description: string
  categoryName: string
  tags: string[]
}

export function formatUpdatedTransaction(view: UpdatedTransactionView): string {
  return [
    'Transaccion actualizada:',
    `<strong>${view.description}</strong>`,
    '',
    `<pre>ID: ${view.id}`,
    `Category: ${view.categoryName}`,
    `Tags: ${view.tags.join(', ')}`,
    '</pre>',
  ].join('\n')
}

export function formatDeleted(): string {
  return 'Transaccion eliminada'
}

export function formatError(detail: string): string {
  return `Error creando la transaccion en SpendTracker:\n\n${detail}`
}
```

- [ ] **Step 4: Implement `src/telegram/client.ts`**

```ts
import { loadEnv } from '../config/env.js'

export async function sendMessage(
  text: string,
  options: { replyToMessageId?: number } = {},
): Promise<void> {
  const env = loadEnv()
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      reply_to_message_id: options.replyToMessageId,
    }),
  })
  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status}`)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/telegram-format.test.ts test/telegram-client.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
commita --no-push
```

---

### Task 10: Email processing pipeline

**Files:**
- Create: `src/pipeline/processEmail.ts`
- Test: `test/processEmail.test.ts`

**Interfaces:**
- Consumes: `detectTransaction` (Task 4), `extractTransaction` (Task 5), DB queries (Task 3), Telegram `sendMessage` + formatters (Task 9).
- Produces: `processEmail(input: { subject: string; text: string }, deps: ProcessDeps): Promise<void>` where `ProcessDeps = { db: Queryable; now: () => string; detect: typeof detectTransaction; extract: typeof extractTransaction; notify: typeof sendMessage }`. Default `deps` wire the real implementations; tests inject fakes.

- [ ] **Step 1: Write the failing test** in `test/processEmail.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { processEmail } from '../src/pipeline/processEmail.js'

function baseDeps(overrides: Record<string, unknown> = {}) {
  const queryRows: Record<string, unknown[]> = {
    categories: [{ id: 'c1', name: 'Food', type: 'expense' }],
    accounts: [{ id: 'a1', name: 'Debito BCP', type: 'DEBIT', currency: 'PEN' }],
    tags: [{ tag: 'food' }],
    insert: [{ id: 'tx1' }],
  }
  const db = {
    query: vi.fn(async (sql: string) => {
      if (/from categories/i.test(sql)) return { rows: queryRows.categories }
      if (/from accounts/i.test(sql)) return { rows: queryRows.accounts }
      if (/unnest/i.test(sql)) return { rows: queryRows.tags }
      if (/insert into transactions/i.test(sql)) return { rows: queryRows.insert }
      return { rows: [] }
    }),
  }
  return {
    db,
    now: () => '2026-06-30T10:00:00.000Z',
    detect: vi.fn().mockResolvedValue(true),
    extract: vi.fn().mockResolvedValue({
      description: 'PLIN', amount: -35, currency: 'PEN',
      account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
      created_at: '2026-06-29T20:55:00.000Z',
    }),
    notify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('processEmail', () => {
  it('skips non-transaction email', async () => {
    const deps = baseDeps({ detect: vi.fn().mockResolvedValue(false) })
    await processEmail({ subject: 'Oferta', text: 'descuento' }, deps as never)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('inserts and notifies for a valid transaction', async () => {
    const deps = baseDeps()
    await processEmail({ subject: 'Consumo', text: 'S/ 35.00' }, deps as never)
    const insertCall = deps.db.query.mock.calls.find((call: unknown[]) =>
      /insert into transactions/i.test(call[0] as string))
    expect(insertCall).toBeTruthy()
    expect(deps.notify).toHaveBeenCalledOnce()
    expect((deps.notify.mock.calls[0][0] as string)).toContain('ID: tx1')
  })

  it('sends an error notification when extraction yields no account', async () => {
    const deps = baseDeps({ extract: vi.fn().mockResolvedValue(null) })
    await processEmail({ subject: 'Consumo', text: 'raro' }, deps as never)
    const insertCall = deps.db.query.mock.calls.find((call: unknown[]) =>
      /insert into transactions/i.test(call[0] as string))
    expect(insertCall).toBeUndefined()
    expect((deps.notify.mock.calls[0][0] as string)).toMatch(/Error/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/processEmail.test.ts`
Expected: FAIL, cannot find `../src/pipeline/processEmail.js`.

- [ ] **Step 3: Implement `src/pipeline/processEmail.ts`**

```ts
import type { Queryable } from '../db/pool.js'
import { getAccounts, getCategories, getDistinctTags, insertTransaction } from '../db/queries.js'
import { detectTransaction } from '../ai/detect.js'
import { extractTransaction } from '../ai/extract.js'
import { sendMessage } from '../telegram/client.js'
import { formatError, formatNewTransaction } from '../telegram/format.js'

export interface ProcessDeps {
  db: Queryable
  now: () => string
  detect: typeof detectTransaction
  extract: typeof extractTransaction
  notify: typeof sendMessage
}

export const defaultProcessDeps: Omit<ProcessDeps, 'db'> = {
  now: () => new Date().toISOString(),
  detect: detectTransaction,
  extract: extractTransaction,
  notify: sendMessage,
}

export async function processEmail(
  email: { subject: string; text: string },
  deps: ProcessDeps,
): Promise<void> {
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

  const { id } = await insertTransaction(deps.db, extracted)
  const account = accounts.find((candidate) => candidate.id === extracted.account_id)
  const category = categories.find((candidate) => candidate.id === extracted.category_id)
  await deps.notify(
    formatNewTransaction({
      id,
      description: extracted.description,
      accountName: account?.name ?? extracted.account_id,
      categoryName: category?.name ?? extracted.category_id,
      tags: extracted.tags,
      currency: extracted.currency,
      amount: extracted.amount,
      created_at: extracted.created_at,
    }),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/processEmail.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
commita --no-push
```

---

### Task 11: Telegram webhook (edit + delete)

**Files:**
- Create: `src/telegram/parse.ts`, `src/telegram/webhook.ts`
- Test: `test/telegram-parse.test.ts`, `test/telegram-webhook.test.ts`

**Interfaces:**
- Consumes: `loadEnv` (Task 2), DB queries (Task 3), `classifyEdit` (Task 6), Telegram `sendMessage` + formatters (Task 9).
- Produces:
  - `src/telegram/parse.ts`: `parseTransactionId(replyText: string): string | null` (matches the `ID: <value>` line), `parseEdit(messageText: string): { description: string; tags: string[] }` (first line is the description, optional `[a, b]` bracket are tags).
  - `src/telegram/webhook.ts`: `handleTelegramUpdate(update, deps): Promise<void>` and a Hono sub-app `telegramRoute` mounted at `/telegram/webhook` that checks the `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`.

- [ ] **Step 1: Write the failing tests**

`test/telegram-parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseTransactionId, parseEdit } from '../src/telegram/parse.js'

describe('telegram parse', () => {
  it('extracts the transaction id from a notification reply', () => {
    expect(parseTransactionId('Nueva\nID: tx-123\nAccount: x')).toBe('tx-123')
  })

  it('returns null when no id line is present', () => {
    expect(parseTransactionId('no id here')).toBeNull()
  })

  it('parses description and bracket tags', () => {
    const result = parseEdit('Almuerzo con equipo\n[food, work]')
    expect(result.description).toBe('Almuerzo con equipo')
    expect(result.tags).toEqual(['food', 'work'])
  })

  it('parses description with no tags', () => {
    expect(parseEdit('Solo descripcion').tags).toEqual([])
  })
})
```

`test/telegram-webhook.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { handleTelegramUpdate } from '../src/telegram/webhook.js'

function deps(overrides: Record<string, unknown> = {}) {
  const db = { query: vi.fn(async (sql: string) => {
    if (/from categories/i.test(sql)) return { rows: [{ id: 'c1', name: 'Food', type: 'expense' }] }
    if (/unnest/i.test(sql)) return { rows: [{ tag: 'food' }] }
    return { rows: [] }
  }) }
  return {
    db,
    classify: vi.fn().mockResolvedValue({ category_id: 'c1', tags: ['food'] }),
    notify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const notification = 'Nueva transaccion\nID: tx-1\nAccount: BCP'

describe('handleTelegramUpdate', () => {
  it('deletes on /delete reply', async () => {
    const d = deps()
    await handleTelegramUpdate({ message: {
      text: '/delete', reply_to_message: { text: notification, message_id: 5 },
    } }, d as never)
    const del = d.db.query.mock.calls.find((call: unknown[]) =>
      /delete from transactions/i.test(call[0] as string))
    expect(del?.[1]).toEqual(['tx-1'])
    expect((d.notify.mock.calls[0][0] as string)).toMatch(/eliminada/i)
  })

  it('reclassifies and updates on an edit reply', async () => {
    const d = deps()
    await handleTelegramUpdate({ message: {
      text: 'Almuerzo\n[food]', reply_to_message: { text: notification, message_id: 5 },
    } }, d as never)
    const update = d.db.query.mock.calls.find((call: unknown[]) =>
      /update transactions/i.test(call[0] as string))
    expect(update?.[1]?.[0]).toBe('tx-1')
    expect(d.classify).toHaveBeenCalledOnce()
  })

  it('ignores a message that is not a reply', async () => {
    const d = deps()
    await handleTelegramUpdate({ message: { text: 'hello' } }, d as never)
    expect(d.db.query).not.toHaveBeenCalled()
    expect(d.notify).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/telegram-parse.test.ts test/telegram-webhook.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/telegram/parse.ts`**

```ts
export function parseTransactionId(replyText: string): string | null {
  const match = replyText.match(/ID:\s*(.+)/)
  return match ? match[1].trim() : null
}

export function parseEdit(messageText: string): { description: string; tags: string[] } {
  const description = messageText.split('\n')[0].trim()
  const bracket = messageText.match(/\[([^\]]+)\]/)
  const tags = bracket
    ? bracket[1].split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0)
    : []
  return { description, tags }
}
```

- [ ] **Step 4: Implement `src/telegram/webhook.ts`**

```ts
import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { getCategories, getDistinctTags, deleteTransaction, updateTransaction } from '../db/queries.js'
import { classifyEdit } from '../ai/classify.js'
import { sendMessage } from '../telegram/client.js'
import { formatDeleted, formatUpdatedTransaction } from '../telegram/format.js'
import { loadEnv } from '../config/env.js'
import { parseEdit, parseTransactionId } from './parse.js'

interface TelegramUpdate {
  message?: {
    text?: string
    reply_to_message?: { text?: string; message_id?: number }
  }
}

export interface WebhookDeps {
  db: Queryable
  classify: typeof classifyEdit
  notify: typeof sendMessage
}

export async function handleTelegramUpdate(update: TelegramUpdate, deps: WebhookDeps): Promise<void> {
  const message = update.message
  const replyText = message?.reply_to_message?.text
  if (!message?.text || !replyText) return

  const transactionId = parseTransactionId(replyText)
  if (!transactionId) return

  if (message.text.trim() === '/delete') {
    await deleteTransaction(deps.db, transactionId)
    await deps.notify(formatDeleted(), { replyToMessageId: message.reply_to_message?.message_id })
    return
  }

  const edit = parseEdit(message.text)
  const [categories, tags] = await Promise.all([
    getCategories(deps.db),
    getDistinctTags(deps.db),
  ])
  const classified = await deps.classify({ description: edit.description, categories, tags })
  const finalTags = edit.tags.length ? edit.tags : classified.tags
  await updateTransaction(deps.db, {
    id: transactionId,
    description: edit.description,
    category_id: classified.category_id,
    tags: finalTags,
  })
  const category = categories.find((candidate) => candidate.id === classified.category_id)
  await deps.notify(
    formatUpdatedTransaction({
      id: transactionId,
      description: edit.description,
      categoryName: category?.name ?? classified.category_id,
      tags: finalTags,
    }),
  )
}

export const telegramRoute = new Hono()

telegramRoute.post('/telegram/webhook', async (context) => {
  const env = loadEnv()
  const secret = context.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return context.json({ ok: false }, 401)
  }
  const update = await context.req.json()
  await handleTelegramUpdate(update, {
    db: getPool(),
    classify: classifyEdit,
    notify: sendMessage,
  })
  return context.json({ ok: true })
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/telegram-parse.test.ts test/telegram-webhook.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
commita --no-push
```

---

### Task 12: Wire bootstrap, OAuth route, setWebhook helper, Docker, README

**Files:**
- Modify: `src/app.ts` (mount `telegramRoute` + `oauthRoute`), `src/index.ts` (start poller, ensure state table)
- Create: `src/routes/oauth.ts`, `src/scripts/set-webhook.ts`, `Dockerfile`, `README.md`
- Test: `test/app.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: a runnable container. `oauthRoute` serves `GET /oauth/start` (redirect to Google consent) and `GET /oauth/callback` (exchanges the code, prints the refresh token to the response/log for one-time capture). `src/scripts/set-webhook.ts` registers `TELEGRAM_WEBHOOK_URL` with `secret_token = TELEGRAM_WEBHOOK_SECRET`.

- [ ] **Step 1: Write the failing test** in `test/app.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app.js'

describe('app wiring', () => {
  it('rejects telegram webhook without the secret header', async () => {
    const app = buildApp()
    const response = await app.request('/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: { text: 'hi' } }),
    })
    expect(response.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/app.test.ts`
Expected: FAIL, route not mounted (404, not 401).

- [ ] **Step 3: Implement `src/routes/oauth.ts`**

```ts
import { Hono } from 'hono'
import { google } from 'googleapis'
import { loadEnv } from '../config/env.js'

export const oauthRoute = new Hono()

function client() {
  const env = loadEnv()
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI)
}

oauthRoute.get('/oauth/start', (context) => {
  const url = client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  })
  return context.redirect(url)
})

oauthRoute.get('/oauth/callback', async (context) => {
  const code = context.req.query('code')
  if (!code) return context.text('Missing code', 400)
  const { tokens } = await client().getToken(code)
  console.log('GOOGLE_REFRESH_TOKEN=', tokens.refresh_token)
  return context.text(`Refresh token (copy into env): ${tokens.refresh_token ?? 'none returned'}`)
})
```

- [ ] **Step 4: Update `src/app.ts`**

```ts
import { Hono } from 'hono'
import { healthRoute } from './routes/health.js'
import { oauthRoute } from './routes/oauth.js'
import { telegramRoute } from './telegram/webhook.js'

export function buildApp(): Hono {
  const app = new Hono()
  app.route('/', healthRoute)
  app.route('/', oauthRoute)
  app.route('/', telegramRoute)
  return app
}
```

- [ ] **Step 5: Update `src/index.ts`** to start the poller

```ts
import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { loadEnv } from './config/env.js'
import { getPool } from './db/pool.js'
import { ensureStateTable } from './db/queries.js'
import { createGmailClient } from './gmail/client.js'
import { startPolling } from './gmail/poller.js'
import { processEmail, defaultProcessDeps } from './pipeline/processEmail.js'

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

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`SpendTracker listening on :${info.port}`)
})
```

- [ ] **Step 6: Implement `src/scripts/set-webhook.ts`**

```ts
import { loadEnv } from '../config/env.js'

const env = loadEnv()
const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`
const response = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: env.TELEGRAM_WEBHOOK_URL, secret_token: env.TELEGRAM_WEBHOOK_SECRET }),
})
console.log(await response.json())
```

- [ ] **Step 7: Create `Dockerfile`**

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Lima
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 8: Create `README.md`** documenting setup

````markdown
# SpendTracker Agent

Autonomous agent that scans Gmail for bank transaction emails, records them in
Postgres, and notifies over Telegram. Port of the original n8n flow.

## Setup

1. `cp .env.example .env` and fill in the values.
2. Get a Gmail refresh token: run the app, open `/oauth/start`, complete consent,
   copy the `GOOGLE_REFRESH_TOKEN` printed by `/oauth/callback` into `.env`.
3. Register the Telegram webhook: `npx tsx src/scripts/set-webhook.ts`.
4. Run locally: `npm run dev`. Build: `npm run build && npm start`.

## Docker

```
docker build -t spend-tracker .
docker run --env-file .env -p 3000:3000 spend-tracker
```

## Tests

`npm test`
````

- [ ] **Step 9: Run test + full suite + typecheck + build**

Run: `npm test` then `npm run typecheck` then `npm run build`
Expected: all tests PASS, typecheck clean, build emits `dist/`.

- [ ] **Step 10: Commit and push**

```bash
commita
```

---

## Self-Review

**Spec coverage:**
- Hono + node adapter: Tasks 1, 12. AI SDK detect/extract/classify: Tasks 4, 5, 6. pg + raw SQL: Task 3. Gmail OAuth polling: Tasks 7, 8, 12. Existing Postgres schema + agent_state: Task 3. Telegram notify + webhook edit/delete: Tasks 9, 11. Dockerfile + .env.example: Tasks 1, 12. Idempotency/cursor: Task 8. Error notification path: Task 10. Timezone injection: Task 5. Env validation: Task 2. All covered.

**Placeholder scan:** No TBD/TODO; every code step has full content.

**Type consistency:** `Queryable`, `Category`, `Account`, `NewTransaction`, `TransactionUpdate`, `ExtractedTransaction` names are consistent across tasks. `detectTransaction`, `extractTransaction`, `classifyEdit`, `sendMessage`, `processEmail`, `handleTelegramUpdate`, `pollOnce`, `parseMessage`, `parseTransactionId`, `parseEdit` signatures match their consumers.

**Note on the first-run cursor:** the agent ignores emails that arrive before its first poll (starts from "now"), matching the "scan going forward" intent. Historical backfill is explicitly out of scope.
