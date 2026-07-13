# Port web improvements to Android

Date: 2026-07-13
Branch: `feature/android-port` (off `main`)

## Goal

Bring the Android app (Kotlin/Jetpack Compose) to feature parity with the web app:
search, collapsible filters, summary tiles, currency switcher, all six analytics
charts, and Google auth. Do it mock-first (works offline, no credentials) and
finish with live native Google sign-in.

## Decisions (approved)

- Charting: **Vico** for line/column/bar charts. Vico has no pie/donut or
  calendar-heatmap, so the **category donut** and **calendar heatmap** are drawn
  with Compose **Canvas**.
- Sequencing: build the backbone + all features in **mock mode** first, then wire
  **live native Google sign-in** last (needs a Google Android OAuth client).
- Charts: all six web charts (spending over time, income vs expense, spending by
  category, tag breakdown, net by account, calendar heatmap).

## Current state (why this is needed)

The backend now gates every data route behind a Better Auth session and returns
`{ items, total, limit, offset }` for the list plus a `/api/transactions/analytics`
endpoint. The Android app still uses mock auth (`x-mock-user`), expects a bare list
array, and has no analytics/search/filters/charts. So it is currently broken
against the merged backend and lacks all the new features.

## Backbone: restore mock <-> live parity (ship-mobile-app playbook)

The Android app already has the client seam (`SessionStore`, `authHeaders`,
`ApiClient` with `x-mock-user` vs bearer, `BuildConfig.USE_MOCK_AUTH`). The backend
lost its half when auth was added. Restore it:

- Add `APP_MODE=mock|live` to the backend env (default `mock`).
- Make `buildApp`'s default `resolveSession` mode-aware: in mock, `x-mock-user`
  header -> a fixed demo user (no Better Auth, no DB); in live, Better Auth
  `getSession({ headers })` (cookie for web, bearer for native). `buildApp` already
  accepts an injected `resolveSession`, so this is a mock-aware default plus a
  `resolveSessionFromRequest` helper.
- Add the Better Auth `bearer` plugin to `getAuth()` (returns `set-auth-token` on
  sign-in, accepts `Authorization: Bearer` after) so native clients work in live.
- CORS `exposeHeaders: ['set-auth-token']`.
- `/health` returns `{ ok, mode }` so the running mode is verifiable.
- The web live-auth flow is unchanged (it uses the cookie path in live mode).

## Phases and scope

### Phase A - Unbreak + backbone
- Backend: `APP_MODE`, mock-aware `resolveSession`, `bearer` plugin, `/health` mode,
  CORS expose header.
- Android: adapt `SpendApi`/`ApiClient`/`Models` to the new list envelope
  `{ items, total, limit, offset }`; keep mock mode working. App builds and lists
  transactions again.

### Phase B - Analytics data + UI (mock)
- Android analytics wire models mirroring the backend camelCase rows:
  `SummaryRow`, `SeriesRow`, `CategoryRow`, `TagRow`, `AccountRow`, `AnalyticsPayload`.
- `ApiClient.getAnalytics(filters, bucket)` and a filtered/paginated
  `getTransactions(filters, page)` (query params via `toQueryParams`).
- Filter state on the ViewModel: `query`, date range/preset, accounts, categories,
  tags + tagMatch, amount min/max, type, currency, bucket. A pure filter->query
  mapper (unit tested).
- UI: a single search bar; a collapsible filter panel (Compose expandable
  section or bottom sheet) with date preset, type, account/category/tag multi-select,
  amount range; active-filter chips with clear-all; summary tiles (income/spend/net)
  fed by the analytics summary for the selected currency; a currency switcher
  (hidden when one currency); a net-by-account section.
- All new strings go through `i18n/Strings.kt`.

### Phase C - Charts (mock)
- Add Vico dependency; add a categorical chart palette to the theme.
- Vico charts: spending over time (column), income vs expense (grouped column +
  net line), tag breakdown (horizontal bar), net by account (bar, sign-colored).
- Canvas charts: category donut, calendar heatmap.
- Each chart is fed already-currency-filtered rows; drill-down is optional and can
  be deferred (web removed chart drill-downs, so parity does not require it).

### Phase D - Live Google sign-in (needs your Android OAuth client)
- Backend: already has `bearer` + Google provider + allowlist from Phase A/the
  merged auth work. Confirm live sign-in via bearer.
- Android: an auth gate (per the playbook `AppRoot` gate), native Google sign-in
  via Credential Manager (`androidx.credentials` + `googleid`), exchange the Google
  ID token with Better Auth (`/sign-in/social` idToken) to obtain a bearer token,
  store it via `SessionStore.saveToken`, 401 clears the session. Allowlist is
  enforced server-side (non-allowlisted emails rejected). Needs a Google **Android**
  OAuth client (SHA-1 + package) and the **Web** client id as `serverClientId`
  (Console-only; user provides).

## Testing

- Backend: unit-test the mock-aware `resolveSession` (mock returns demo user for
  `x-mock-user`; live path returns null without a session); assert the `bearer`
  plugin is wired (construct `getAuth()` and check `options.plugins`).
- Android: follow existing patterns - `FakeApi : SpendApi` + `StandardTestDispatcher`
  for ViewModel/filter-state tests; `MockWebServer` for `ApiClient` parsing (new
  envelope + analytics payload); pure unit tests for the filter->query mapper and
  any chart data-shaping helpers.
- Live Google auth (Phase D) is verified by a device smoke test, not a unit test
  (Better Auth is off in mock; Credential Manager UI is not unit-testable).

## Out of scope / follow-ups

- Chart drill-down interactions (web removed them).
- Offline caching / sync.
- iOS.
- Per-user data scoping (server data is still shared; add `user_id` later).
