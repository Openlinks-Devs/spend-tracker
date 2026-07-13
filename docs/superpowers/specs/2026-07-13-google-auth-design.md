# Google login with Better Auth (allowlist-gated)

Date: 2026-07-13
Branch: `feature/google-auth` (stacked on `feature/transaction-analytics`)

## Goal

Add Google sign-in via Better Auth. Only allowlisted emails may authenticate
(default: `misaelabanto@gmail.com`); everyone else is rejected. The data API is
locked behind a valid session. Designed so more users can be added later by
editing an env allowlist, with a clean path to a DB-backed allowlist.

## Decisions (approved)

- Allowlist via `ALLOWED_EMAILS` env (comma-separated, default `misaelabanto@gmail.com`).
- Gate all data routes (transactions, accounts, categories, tags) behind a session; 401 otherwise.
- Web redirects unauthenticated users to a login page.
- Auth DB schema delivered as a reviewable, additive migration that only CREATEs
  the Better Auth tables. No existing table or data is touched.
- Strip the seed INSERT/backfill statements from `001_init.sql` (schema only).
- Reuse `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (a Google "Web application" client).

## Non-goals

- No email/password auth, no other social providers.
- No admin UI for managing the allowlist (env only for now).
- No live Google OAuth verification in automated tests (deferred to manual test
  once real credentials + a registered redirect URI exist).

## Backend (`apps/backend`)

### Dependencies
- Add `better-auth`.

### Env additions (`src/config/env.ts`)
- `BETTER_AUTH_SECRET` (min 32 chars).
- `BETTER_AUTH_URL` (browser-facing base origin, e.g. `http://localhost:5173`).
- `ALLOWED_EMAILS` (string, default `misaelabanto@gmail.com`).

### Auth instance (`src/auth.ts`)
- `betterAuth({ database: <pg Pool>, baseURL: BETTER_AUTH_URL, secret: BETTER_AUTH_SECRET,
  socialProviders: { google: { clientId, clientSecret } }, ... })`.
- Reuse the existing pg pool (`getPool()`).
- **Allowlist enforcement**: reject any non-allowlisted email during social sign-in /
  account creation by throwing an `APIError` in a Better Auth hook, so the flow fails
  and no account is ever created for a disallowed email. Backed by a pure
  `isEmailAllowed(email, allowedEmails)` helper (case-insensitive, trims) that is unit tested.
- Optional `accessType: 'offline'`, `prompt: 'select_account'` for the Google provider.

### Wiring (`src/app.ts`)
- Register CORS with `credentials: true` before routes.
- Mount `app.on(['GET','POST'], '/api/auth/*', (context) => auth.handler(context.req.raw))`
  BEFORE the data routes.
- **Session guard**: middleware applied to the data routes that calls
  `auth.api.getSession({ headers })`; returns 401 when there is no valid session.
  The guard must NOT cover `/api/auth/*` or `/api/health`.

### Auth migration
- Generate the Better Auth Postgres schema (via `@better-auth/cli generate`) into a
  new SQL migration file (`migrations/002_auth.sql`). It only CREATEs `user`,
  `session`, `account`, `verification` (Better Auth core). Reviewable; applied to the
  real DB by the user. Note: filename number may collide with other branches' `002`;
  cosmetic here because the runner is branch-local.

### Seed removal (`migrations/001_init.sql`)
- Remove the `INSERT INTO accounts`, `INSERT INTO categories`, and the
  `UPDATE transactions ... Uncategorized` backfill. Keep only `CREATE EXTENSION`,
  `CREATE TABLE`, and the `ALTER TABLE ... SET NOT NULL` if it stands without the
  backfill (drop the backfill+NOT NULL pair if it would fail on a table with null
  legacy rows; on a fresh DB there are none). No runtime code depends on the seeds.

## Web (`apps/web`)

### Auth client (`src/lib/authClient.ts`)
- `createAuthClient({ baseURL: '/api/auth' })` from `better-auth/react`; export
  `signIn`, `signOut`, `useSession`.

### Fetch credentials (`src/lib/api.ts`)
- Add `credentials: 'include'` to the shared `request` fetch so the session cookie
  is sent (same-origin through the vite proxy).

### Login + route guard
- `src/pages/LoginPage.tsx`: a single "Sign in with Google" button calling
  `signIn.social({ provider: 'google', callbackURL: '/' })`. Shows an error message
  when redirected back with an auth error (disallowed email).
- `src/App.tsx`: a guard that reads `useSession()`. While pending, render a loader.
  Unauthenticated → render `LoginPage` (route `/login`) / redirect. Authenticated →
  render the existing app shell.
- `src/components/layout/AppLayout.tsx`: show the signed-in email and a "Sign out"
  action (`signOut()` → back to login).

## Local dev topology

Browser hits the web origin (`:5173`), which proxies `/api/*` (including `/api/auth/*`)
to the backend (`:3000`). So auth is same-origin from the browser; the session cookie
is first-party. `BETTER_AUTH_URL` must equal the browser origin so the Google callback
matches. Register `<BETTER_AUTH_URL>/api/auth/callback/google` in Google Cloud Console.
Google accepts `http://localhost:<port>` or a public https domain, not a LAN IP.

## Testing

- Backend unit: `isEmailAllowed` (allowed, disallowed, case/space-insensitive, multi-email).
- Backend unit: env parsing accepts the new vars and defaults `ALLOWED_EMAILS`.
- Backend integration: the session guard returns 401 without a session and passes
  through with a mocked `getSession`, and does NOT gate `/api/auth/*` or `/api/health`.
- Web: `authClient` module shape; login page renders the Google button. (Full OAuth
  flow verified manually with real credentials.)

## Out of scope / follow-ups

- DB-backed allowlist / roles, invitations, multi-tenant data scoping.
- Per-user data isolation (today all rows are shared; add `user_id` later).
- `ALLOWED_EMAILS` is enforced at account-creation time only: removing an email
  from the list does not revoke an already-provisioned user's sessions or
  future logins. Per-request re-validation against the allowlist is the
  upgrade path if revocation is needed.
