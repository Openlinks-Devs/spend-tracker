# SpendTracker Monorepo Migration + CRUD + Android App

Date: 2026-07-02
Status: Approved (pending spec review)

## Goal

Convert the single-package SpendTracker backend repo into a pnpm monorepo with
three apps, add a REST CRUD API to the backend, build a web dashboard, and
scaffold a Kotlin/Jetpack Compose Android app. The whole migration is executed
by an ultracode workflow that spawns subagents; each subagent commits its own
scoped work with `git add <files> && commita --no-push`.

## Decisions (locked)

- Monorepo tooling: **pnpm workspaces**.
- Web stack: **Vite + React + TypeScript + Tailwind + shadcn/ui** (TanStack
  Query + React Router).
- Backend scope: **CRUD only, no auth** (single-user). Keep the existing raw
  `pg` layer; do not adopt Drizzle or Better Auth.
- CRUD entities: **Transactions + Accounts + Categories** (tags derived). No
  transfer endpoints.
- Mobile app directory: **`apps/android`** (leaving room for a future
  `apps/ios`). Built via the `ship-mobile-app` playbook in **mock mode only**
  (no Better Auth, no Google sign-in, no cloud provisioning).

## Target layout

```
spend-tracker/                  # pnpm workspace root
  pnpm-workspace.yaml           # packages: apps/backend, apps/web
  package.json                  # root scripts: dev/build/test/typecheck fan-out (pnpm -r)
  tsconfig.base.json            # shared TS compiler options
  docs/ ...                     # unchanged
  apps/
    backend/                    # MOVED from ./src + ./test + backend configs
      package.json              # existing deps + hono/cors
      src/                      # existing agent, unchanged behavior
        routes/
          transactions.ts       # NEW
          accounts.ts           # NEW
          categories.ts         # NEW
          tags.ts               # NEW (derived)
        db/queries.ts           # extended
        db/types.ts             # extended
        app.ts                  # mounts /api/* + CORS
      migrations/001_init.sql   # NEW idempotent schema + seed
      test/                     # existing + new CRUD tests
    web/                        # NEW Vite + React + shadcn/ui dashboard
    android/                    # NEW Kotlin + Jetpack Compose (standalone Gradle)
```

`apps/android` is a standalone Gradle project and is NOT part of the pnpm
workspace. The Gmail -> Postgres -> Telegram agent moves verbatim into
`apps/backend` and keeps running alongside the new HTTP CRUD routes.

## Backend CRUD (apps/backend)

Routes mounted under `/api`, alongside existing `/health`, `/oauth/*`,
`/telegram/*`:

- Transactions: `GET /api/transactions`, `GET /api/transactions/:id`,
  `POST /api/transactions`, `PATCH /api/transactions/:id`,
  `DELETE /api/transactions/:id`.
- Accounts: full CRUD at `/api/accounts` (+ `/:id`).
- Categories: full CRUD at `/api/categories` (+ `/:id`).
- Tags: `GET /api/tags` (derived from `getDistinctTags`).

Implementation notes:

- Extend `src/db/queries.ts` and `src/db/types.ts` with the missing get-all /
  get-by-id / insert / update / delete for accounts and categories.
  Transactions already have insert/update/delete; add list + get-by-id.
- Validate request bodies with Zod. Return a consistent JSON error shape
  (`{ error: string }`) with appropriate status codes (400/404/500).
- Enable CORS via `hono/cors` for the web dev origin (configurable, default
  permissive in dev).
- New migration `apps/backend/migrations/001_init.sql`: idempotent
  `CREATE TABLE IF NOT EXISTS` for `accounts`, `categories`, `transactions`
  matching the columns the queries reference (including `transactions.updated_at`
  and `created_at`), plus a small seed (one default account, a few categories).
  Today these tables are assumed to pre-exist; this makes the CRUD runnable from
  a clean database. Provide a `pnpm --filter backend migrate` script that applies
  the SQL.

## Web app (apps/web)

Vite + React + TS, Tailwind, shadcn/ui, TanStack Query, React Router. Pages
mirror `SpendTrackerWeb.json`:

- **Dashboard** — summary cards (balance/spend) + recent transactions, tabbed
  container.
- **Transactions** — list + create/edit/delete via a dialog form (description,
  amount, currency, account, category, tags).
- **Accounts** — list + create/edit/delete.
- **Categories** — list + create/edit/delete.

API client reads `VITE_API_URL`; the Vite dev server proxies `/api` to the
backend on `:3000`. No transfer UI (transfers are out of scope); this gap is
noted intentionally.

## Android app (apps/android)

Kotlin + Jetpack Compose via the `ship-mobile-app` playbook, **mock mode only**:
`BuildConfig.USE_MOCK_AUTH=true`, client sends `x-mock-user`, no Better Auth, no
Google sign-in. Screens from `SpendTrackerApp.json`:

- **TransactionsListScreen** — list of transactions.
- **TransactionDetailScreen** — single transaction detail.
- **Summary/home screen** — totals overview.
- **Transaction form** — create/edit.

`ApiClient` (OkHttp + kotlinx.serialization) points at the backend `/api`,
state in a `SessionViewModel`, strings through an i18n table. Deliverable: a
compiling debug APK target (`./gradlew assembleDebug -PuseMockAuth=true`) plus
unit tests. Stages 4-7 of the skill (cloud, live auth, device smoke) are
skipped. Since agents inside a workflow cannot invoke the `/ship-mobile-app`
skill directly, the android agent is handed the skill's fixed stack + screen
list inline as its brief.

## The ultracode workflow

Sequential build+commit pipeline (sequential because `commita` shares git's
index lock; explicit `git add <files>` scopes each commit):

1. **Scaffold** — create `pnpm-workspace.yaml`, root `package.json`,
   `tsconfig.base.json`; `git mv` `src`, `test`, and backend configs
   (tsconfig, vitest, eslint, prettier, Dockerfile, .env.example) into
   `apps/backend`; fix import/config paths so the existing app still builds.
   Then `git add <files> && commita --no-push`.
2. **Backend** — migration + CRUD routes + queries + Zod + CORS + tests.
   Then `git add apps/backend && commita --no-push`.
3. **Web** — scaffold Vite/React/shadcn app + pages + API client.
   Then `git add apps/web && commita --no-push`.
4. **Android** — scaffold Kotlin/Compose app + screens + ApiClient (mock mode).
   Then `git add apps/android && commita --no-push`.
5. **Verify** — one `pnpm install`; `pnpm -r typecheck`; `pnpm -r test`; web
   build; `./gradlew assembleDebug -PuseMockAuth=true` + android unit tests.
   Fix-up loop on failures; if fixes were made, `git add <files> && commita
   --no-push`.
6. **Review** — parallel adversarial review of the full diff for correctness /
   regressions (especially that the existing agent behavior is unchanged).
   Read-only, no commits. Findings verified and reported.

The workflow does **not** push. After it finishes and the verify + review
results are relayed, the final push stays with the user (`commita -a` or
`git push`).

## Testing / verification

- Backend: `pnpm --filter backend test` (existing vitest suite must still pass)
  + new CRUD route tests.
- Web: `pnpm --filter web build` (typecheck + bundle).
- Android: `./gradlew test` + `./gradlew assembleDebug -PuseMockAuth=true`.
- Root: `pnpm -r typecheck`.

## Risks / notes

- Moving `src`/`test` changes relative import roots and config paths; the
  scaffold step must re-verify the existing build before proceeding.
- `commita` availability inside workflow subagents is assumed (it is on the
  user's PATH at `~/.bun/bin/commita`).
- No transfer support in this iteration (deferred with the transfer UI).
- Android app is mock-mode only; wiring live auth is a future task via the full
  `ship-mobile-app` stages.
