# Android Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, each task via superpowers:test-driven-development. Executed phase by phase. Reference: the ship-mobile-app skill (mock/live seam, backend-betterauth, google-signin).

**Goal:** Bring the Android app to parity with web: search, filters, summary tiles, currency switcher, six charts, and Google auth. Mock-first, live Google sign-in last.

**Tech Stack:** Kotlin + Jetpack Compose, OkHttp + kotlinx.serialization, JUnit + MockWebServer; Vico + Compose Canvas for charts. Backend: Hono + Better Auth + pg.

## Global Constraints

- No em dashes anywhere. Descriptive variable names (Kotlin idiomatic; no throwaway singles).
- Backend keeps the mock/live seam: `APP_MODE=mock|live`; routes never branch on mode (only `resolveSession` does). Gating is server-side.
- Android keeps mock parity: every feature works with `BuildConfig.USE_MOCK_AUTH=true` (default) via `x-mock-user`. Every visible string goes through `i18n/Strings.kt`.
- Follow existing test patterns: `FakeApi : SpendApi` + `StandardTestDispatcher` for ViewModel; `MockWebServer` for `ApiClient`; pure unit tests for mappers/calculators.
- Backend: `pnpm --filter backend test` + `typecheck`. Android: `apps/android/gradlew test` (unit) + `assembleDebug` (compiles). Run from `apps/android`.
- Commit only via `/commita` (or `commita --no-push`).

---

# PHASE A - Unbreak + backbone

## Task A1: Backend mock/live parity + bearer plugin

**Files:** `apps/backend/src/config/env.ts` (add `APP_MODE`), `apps/backend/src/auth/resolveSession.ts` (new), `apps/backend/src/app.ts` (use mock-aware default), `apps/backend/src/auth.ts` (add `bearer` plugin), `apps/backend/src/routes/health.ts` (report mode), `apps/backend/test/resolveSession.test.ts` (new).

**Interfaces:**
- `APP_MODE: z.enum(['mock','live']).default('mock')` in env.
- `resolveSessionFromRequest(headers: Headers): Promise<unknown>` - the mode-aware default: mock returns `{ user: { id, email, name } }` for the `x-mock-user` header (default `demo-user`); live calls `getAuth().api.getSession({ headers })`.
- `buildApp` default param becomes `resolveSessionFromRequest`.
- `getAuth()` adds `plugins: [bearer()]` from `better-auth/plugins`.
- `/health` -> `{ ok: true, mode: <APP_MODE> }`.
- CORS gains `exposeHeaders: ['set-auth-token']`.

**TDD:** unit test `resolveSessionFromRequest`: mock mode returns a demo user for any/absent `x-mock-user`; assert the demo id reflects the header. Live mode path returns null when `getSession` yields nothing (inject/stub `getAuth` or test via `APP_MODE=live` with no session -> null, tolerating that it constructs auth). Assert `getAuth()` wires the bearer plugin (`getAuth().options.plugins.some(p => p.id === 'bearer')`). Keep existing 95 tests green (the app.test gating tests use injected resolvers and stay valid). Update env fixtures if needed (`APP_MODE` has a default).

## Task A2: Android list envelope + mock still works

**Files:** `apps/android/.../data/Models.kt` (add `TransactionListResponse`), `apps/android/.../data/ApiClient.kt` (parse envelope), `apps/android/.../data/SpendApi.kt` (return type unchanged: `List<Transaction>` from `.items`), `apps/android/.../ApiClientTest.kt` (update).

**Interfaces:**
- `@Serializable data class TransactionListResponse(val items: List<Transaction>, val total: Int, val limit: Int, val offset: Int)`.
- `ApiClient.getTransactions()` now GETs `/api/transactions` and returns `response.items` (keep `SpendApi.getTransactions(): List<Transaction>` so screens/ViewModel are unaffected in Phase A).

**TDD:** update `ApiClientTest` so the mock server returns the envelope and `getTransactions()` returns the items list. Keep all other Android tests green. Verify `./gradlew test` and `./gradlew assembleDebug` (with default mock props).

---

# PHASE B - Analytics data + UI (mock)  [plan detailed at phase start]

Task list (refined when Phase A lands):
- B1: analytics wire models + `ApiClient.getAnalytics(filters,bucket)` + filtered `getTransactions(filters,page)` + a pure `filtersToQueryParams` mapper (TDD via MockWebServer + unit tests).
- B2: filter/search state on the ViewModel (`query`, date preset/range, accounts, categories, tags+tagMatch, amount min/max, type, currency, bucket) + a derived analytics fetch; TDD with FakeApi.
- B3: search bar + collapsible filter panel + active-filter chips UI; i18n keys.
- B4: summary tiles + currency switcher + net-by-account section (data + UI).

# PHASE C - Charts (mock)  [plan detailed at phase start]

- C1: add Vico dep + chart palette in theme; spending-over-time (Vico column) + income-vs-expense (Vico grouped column + net line).
- C2: tag-breakdown (Vico bar) + net-by-account (Vico bar, sign-colored).
- C3: category donut (Canvas) + calendar heatmap (Canvas).
- Each fed currency-filtered rows; data-shaping helpers unit tested.

# PHASE D - Live Google sign-in  [needs user's Android OAuth client]

- D1: backend confirm bearer live sign-in (verified by deploy/device, per skill).
- D2: Android auth gate + Credential Manager native Google sign-in + ID-token -> Better Auth bearer + SessionStore; per `references/google-signin.md`. Needs Google Android OAuth client (SHA-1 + package) + Web client id as `serverClientId`.

## Self-review

- Phase A unbreaks the app and restores the documented seam; B/C add features in mock; D flips to live auth. Each phase is independently testable. Live auth is device-verified, not unit-tested (documented boundary).
