# Google Auth (Better Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, each task via superpowers:test-driven-development (red-green-refactor). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Google sign-in via Better Auth, allow only allowlisted emails, and lock the data API behind a valid session.

**Architecture:** Backend adds a Better Auth instance (pg pool, Google provider) mounted at `/api/auth/*`, an allowlist enforced in `databaseHooks.user.create.before`, and a session-guard middleware on the data routes. Web adds a Better Auth React client, a login page, and a route guard. All auth is same-origin through the existing vite `/api` proxy.

**Tech Stack:** better-auth, Hono, node-postgres, React 19 + react-router v8 + TanStack Query, Vitest.

## Global Constraints

- No em dashes anywhere (code, comments, commits). Descriptive variable names (no throwaway singles except `i`/`j`, `a`/`b`).
- ESM `.js` import extensions in backend TS source; `@/` alias in web.
- Backend tests mock dependencies via injection and never touch a live DB. Web tests use Vitest + jsdom.
- Allowlist default: `misaelabanto@gmail.com`. Reject non-allowlisted emails with a Better Auth `APIError('FORBIDDEN', ...)`.
- Auth endpoints live under `/api/auth/*`. The session guard must gate the data routes (`/api/transactions`, `/api/accounts`, `/api/categories`, `/api/tags` and their `/*`) and must NOT gate `/api/auth/*` or `/api/health`.
- `BETTER_AUTH_SECRET` min length 32. `BETTER_AUTH_URL` is the browser-facing origin.
- Commit only via `/commita` (or `commita --no-push`), never plain git.
- Verify: `pnpm --filter backend test`, `pnpm --filter backend typecheck`, `pnpm --filter web test`, `pnpm --filter web typecheck`, `pnpm --filter web build`.

## File Structure

Backend:
- `apps/backend/src/auth/allowlist.ts` (new): pure `parseAllowedEmails`, `isEmailAllowed`.
- `apps/backend/src/auth.ts` (new): lazy `getAuth()` Better Auth instance.
- `apps/backend/src/auth/sessionGuard.ts` (new): `createSessionGuard(getSession)` Hono middleware.
- `apps/backend/src/config/env.ts` (modify): add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_EMAILS`.
- `apps/backend/src/app.ts` (modify): CORS credentials, mount auth handler, gate data routes.
- `apps/backend/migrations/002_auth.sql` (new): Better Auth tables only.
- `apps/backend/migrations/001_init.sql` (modify): remove seed inserts/backfill.
- Tests: `apps/backend/test/allowlist.test.ts`, `apps/backend/test/sessionGuard.test.ts` (new); update `env.test.ts` / `app.test.ts` fixtures for new env vars.

Web:
- `apps/web/src/lib/authClient.ts` (new): Better Auth React client.
- `apps/web/src/lib/api.ts` (modify): `credentials: 'include'`.
- `apps/web/src/pages/LoginPage.tsx` (new).
- `apps/web/src/App.tsx` (modify): auth guard.
- `apps/web/src/components/layout/AppLayout.tsx` (modify): email + sign out.

---

## Task 1: Backend env + allowlist helper + auth instance

**Files:**
- Create: `apps/backend/src/auth/allowlist.ts`, `apps/backend/src/auth.ts`, `apps/backend/test/allowlist.test.ts`
- Modify: `apps/backend/src/config/env.ts`; update env fixtures in `apps/backend/test/env.test.ts` and `apps/backend/test/app.test.ts` (add `BETTER_AUTH_SECRET` = 32+ chars, `BETTER_AUTH_URL`).

**Interfaces:**
- Produces: `parseAllowedEmails(raw: string): string[]`, `isEmailAllowed(email: string, allowedEmails: string[]): boolean`, `getAuth()`.

- [ ] **Step 1: Install dep.** `pnpm --filter backend add better-auth` (run at repo root: `pnpm --filter backend add better-auth`).

- [ ] **Step 2: Failing tests** (`allowlist.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { parseAllowedEmails, isEmailAllowed } from '../src/auth/allowlist.js'

describe('allowlist', () => {
  it('parses a comma list, trims, lowercases, drops empties', () => {
    expect(parseAllowedEmails(' A@x.com , b@Y.com ,')).toEqual(['a@x.com', 'b@y.com'])
  })
  it('allows an email on the list case- and space-insensitively', () => {
    const allowed = parseAllowedEmails('misaelabanto@gmail.com')
    expect(isEmailAllowed('  MisaelAbanto@Gmail.com ', allowed)).toBe(true)
  })
  it('rejects an email not on the list', () => {
    expect(isEmailAllowed('intruder@evil.com', ['misaelabanto@gmail.com'])).toBe(false)
  })
  it('rejects when the list is empty', () => {
    expect(isEmailAllowed('anyone@x.com', [])).toBe(false)
  })
})
```

- [ ] **Step 3: Run, verify fail.** `pnpm --filter backend test allowlist`

- [ ] **Step 4: Implement `allowlist.ts`**

```typescript
export function parseAllowedEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

export function isEmailAllowed(email: string, allowedEmails: string[]): boolean {
  return allowedEmails.includes(email.trim().toLowerCase())
}
```

- [ ] **Step 5: Extend env schema** (`config/env.ts`) — add inside the zod object:

```typescript
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().min(1),
  ALLOWED_EMAILS: z.string().default('misaelabanto@gmail.com'),
```

Update `env.test.ts` and `app.test.ts` env fixtures to include `BETTER_AUTH_SECRET` (a 32+ char string, e.g. `'test-secret-value-at-least-32-chars-long'`) and `BETTER_AUTH_URL` (`'http://localhost:5173'`). Run `pnpm --filter backend test` and fix any env-fixture failures.

- [ ] **Step 6: Implement `auth.ts`** (lazy so importing the allowlist/tests never constructs it):

```typescript
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { getPool } from './db/pool.js'
import { loadEnv } from './config/env.js'
import { parseAllowedEmails, isEmailAllowed } from './auth/allowlist.js'

let authInstance: ReturnType<typeof betterAuth> | undefined

export function getAuth(): ReturnType<typeof betterAuth> {
  if (!authInstance) {
    const env = loadEnv()
    const allowedEmails = parseAllowedEmails(env.ALLOWED_EMAILS)
    authInstance = betterAuth({
      database: getPool(),
      baseURL: env.BETTER_AUTH_URL,
      secret: env.BETTER_AUTH_SECRET,
      socialProviders: {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          accessType: 'offline',
          prompt: 'select_account',
        },
      },
      databaseHooks: {
        user: {
          create: {
            before: async (user: { email: string }) => {
              if (!isEmailAllowed(user.email, allowedEmails)) {
                throw new APIError('FORBIDDEN', { message: 'This account is not authorized.' })
              }
              return { data: user }
            },
          },
        },
      },
    })
  }
  return authInstance
}
```

- [ ] **Step 7: Verify.** `pnpm --filter backend test` (all pass) and `pnpm --filter backend typecheck`. If Better Auth's types require additional fields, consult https://www.better-auth.com/docs/installation and adjust; do not weaken the allowlist logic.

- [ ] **Step 8: Commit** via `/commita`.

---

## Task 2: Auth migration + strip 001 seeds

**Files:**
- Create: `apps/backend/migrations/002_auth.sql`
- Modify: `apps/backend/migrations/001_init.sql`

**Interfaces:** none (SQL only).

- [ ] **Step 1: Generate the Better Auth schema.** With Task 1's `auth.ts` present, generate the Postgres DDL:
  `pnpm --filter backend exec npx @better-auth/cli@latest generate --output migrations/002_auth.sql` (the CLI reads `auth.ts`). If the CLI cannot load the config or env in this environment, hand-write the four core tables from the documented schema at https://www.better-auth.com/docs/concepts/database (tables: `user`, `session`, `account`, `verification`) instead. The file must contain ONLY `CREATE TABLE`/index statements for those four tables. No `INSERT`, no `DROP`, no changes to existing tables. Verify it parses by applying it to a throwaway database:
  `psql "postgres://postgres:demo@localhost:5466/spendtracker" -f migrations/002_auth.sql` (the demo Postgres is already running; this is additive). Then confirm the tables exist:
  `psql "postgres://postgres:demo@localhost:5466/spendtracker" -c "\dt"` and check for `user`, `session`, `account`, `verification`.

- [ ] **Step 2: Strip seeds from `001_init.sql`.** Remove the three seed blocks (the `INSERT INTO accounts ... 'Cash'`, the `INSERT INTO categories ... VALUES (...)`, and the `UPDATE transactions SET category_id = ... Uncategorized`). Also remove the now-orphaned `ALTER TABLE transactions ALTER COLUMN category_id SET NOT NULL` ONLY if it depended on the backfill; keep it if `category_id` should stay NOT NULL (on a fresh DB with no rows the ALTER is safe and harmless, so keeping it is fine). Keep `CREATE EXTENSION`, all `CREATE TABLE` statements. The file must contain no `INSERT` and no `UPDATE`.

- [ ] **Step 3: Verify no data statements remain.** `grep -niE "INSERT|UPDATE" migrations/001_init.sql` returns nothing. `grep -niE "INSERT|DROP|UPDATE|ALTER TABLE (transactions|accounts|categories)" migrations/002_auth.sql` returns nothing (002 only creates auth tables).

- [ ] **Step 4: Commit** via `/commita`.

---

## Task 3: Mount auth handler + session guard

**Files:**
- Create: `apps/backend/src/auth/sessionGuard.ts`, `apps/backend/test/sessionGuard.test.ts`
- Modify: `apps/backend/src/app.ts`

**Interfaces:**
- Consumes: `getAuth()` (Task 1).
- Produces: `createSessionGuard(getSession: (headers: Headers) => Promise<unknown>): MiddlewareHandler`.

- [ ] **Step 1: Failing test** (`sessionGuard.test.ts`) — exercise the middleware with a tiny Hono app and an injected getSession:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createSessionGuard } from '../src/auth/sessionGuard.js'

function appWith(getSession: () => Promise<unknown>) {
  const app = new Hono()
  app.use('/api/data', createSessionGuard(getSession))
  app.get('/api/data', (context) => context.json({ ok: true }))
  return app
}

describe('sessionGuard', () => {
  it('returns 401 when there is no session', async () => {
    const response = await appWith(async () => null).request('/api/data')
    expect(response.status).toBe(401)
  })
  it('calls next when a session exists', async () => {
    const response = await appWith(async () => ({ session: { id: 's1' }, user: { id: 'u1' } })).request('/api/data')
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
  })
  it('passes the request headers to getSession', async () => {
    const getSession = vi.fn().mockResolvedValue({ session: {} })
    await appWith(getSession).request('/api/data', { headers: { cookie: 'x=1' } })
    expect(getSession).toHaveBeenCalledWith(expect.any(Headers))
  })
})
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter backend test sessionGuard`

- [ ] **Step 3: Implement `sessionGuard.ts`**

```typescript
import type { MiddlewareHandler } from 'hono'

export function createSessionGuard(
  getSession: (headers: Headers) => Promise<unknown>,
): MiddlewareHandler {
  return async (context, next) => {
    const result = await getSession(context.req.raw.headers)
    if (!result) {
      return context.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  }
}
```

- [ ] **Step 4: Wire `app.ts`.** Register CORS with credentials, mount the auth handler, keep health ungated, then gate the data prefixes:

```typescript
import { getAuth } from './auth.js'
import { createSessionGuard } from './auth/sessionGuard.js'
// ... existing imports

export function buildApp(): Hono {
  const app = new Hono()
  const webOrigin = process.env.WEB_ORIGIN
  app.use(
    '/api/*',
    cors({
      origin: webOrigin ?? '*',
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  )

  // Auth endpoints (never gated).
  app.on(['GET', 'POST'], '/api/auth/*', (context) => getAuth().handler(context.req.raw))

  // Health (never gated).
  app.route('/', healthRoute)

  // Gate the data routes behind a valid session.
  const guard = createSessionGuard((headers) => getAuth().api.getSession({ headers }))
  for (const prefix of ['/api/transactions', '/api/accounts', '/api/categories', '/api/tags']) {
    app.use(prefix, guard)
    app.use(`${prefix}/*`, guard)
  }

  app.route('/', oauthRoute)
  app.route('/', telegramRoute)
  app.route('/', createTransactionsRoute())
  app.route('/', createAccountsRoute())
  app.route('/', createCategoriesRoute())
  app.route('/', createTagsRoute())
  return app
}
```

Note: `getAuth()` is lazy, so `buildApp()` still constructs without full env; the auth instance is built on the first `/api/auth` or guarded request. Existing route tests call the route factories directly and are unaffected by the guard.

- [ ] **Step 5: Verify.** `pnpm --filter backend test` (all pass, including existing app.test) and `pnpm --filter backend typecheck`. If `app.test.ts` exercises a data route through `buildApp` without a session it will now get 401 - update or remove that assertion, noting the guard is covered by `sessionGuard.test.ts`.

- [ ] **Step 6: Commit** via `/commita`.

---

## Task 4: Web auth client + fetch credentials

**Files:**
- Create: `apps/web/src/lib/authClient.ts`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Produces: `authClient`, `signIn`, `signOut`, `useSession` exports.

- [ ] **Step 1: Install dep.** `pnpm --filter web add better-auth`.

- [ ] **Step 2: Implement `authClient.ts`**

```typescript
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({ baseURL: '/api/auth' })
export const { signIn, signOut, useSession } = authClient
```

- [ ] **Step 3: Add credentials to the shared fetch** (`api.ts`) — in the `request` helper's `fetch(...)` init, add `credentials: 'include'` so the session cookie is always sent:

```typescript
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })
```

Ensure `credentials: 'include'` is not overridden by a spread `...init` (place it so `init` can still override intentionally, but by default it is included; if `init` has no credentials key it stays 'include').

- [ ] **Step 4: Verify.** `pnpm --filter web typecheck`, `pnpm --filter web test` (existing pass). No new unit test required (covered by typecheck + manual).

- [ ] **Step 5: Commit** via `/commita`.

---

## Task 5: Login page + route guard + AppLayout sign-out

**Files:**
- Create: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/layout/AppLayout.tsx`

**Interfaces:**
- Consumes: `signIn`, `signOut`, `useSession` (Task 4).

- [ ] **Step 1: `LoginPage.tsx`** — a centered card with one Google button; surfaces an error when the URL has an auth error query param (disallowed email). Use existing `Button`/`Card` UI primitives and an `@tabler/icons-react` icon.

```tsx
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { signIn } from '@/lib/authClient'

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const hasError = searchParams.has('error')
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to SpendTracker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasError ? (
            <p className="text-sm text-destructive">
              This account is not authorized to access SpendTracker.
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            onClick={() => signIn.social({ provider: 'google', callbackURL: '/' })}
          >
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Guard in `App.tsx`** — read `useSession()`; while pending show a loader; unauthenticated renders `LoginPage`; authenticated renders the existing routes.

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { TransactionsPage } from '@/pages/TransactionsPage'
import { AccountsPage } from '@/pages/AccountsPage'
import { CategoriesPage } from '@/pages/CategoriesPage'
import { LoginPage } from '@/pages/LoginPage'
import { useSession } from '@/lib/authClient'

export function App() {
  return (
    <BrowserRouter>
      <AuthenticatedApp />
    </BrowserRouter>
  )
}

function AuthenticatedApp() {
  const { data: session, isPending } = useSession()
  if (isPending) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading...</div>
  }
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 3: AppLayout** — show the signed-in email and a Sign out control that calls `signOut()`. Place it in the sidebar footer. Read the email from `useSession()`; on sign out the guard re-renders to the login page automatically.

- [ ] **Step 4: Verify.** `pnpm --filter web typecheck`, `pnpm --filter web build`, `pnpm --filter web test`. Then a smoke check that unauthenticated load shows the login page (no session cookie present).

- [ ] **Step 5: Commit** via `/commita`.

---

## Self-review notes

- Spec coverage: allowlist helper + hook (Task 1), auth instance (Task 1), migration + seed strip (Task 2), handler mount + session guard (Task 3), web client + credentials (Task 4), login + guard + sign out (Task 5). Covered.
- Live Google OAuth flow is verified manually once real credentials and a registered redirect URI exist (out of automated scope).
- Type consistency: `getAuth()` used in Task 3 as defined in Task 1; `signIn/signOut/useSession` exported in Task 4 and consumed in Task 5.
