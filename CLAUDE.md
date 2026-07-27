# SpendTracker - project instructions

This is a pnpm monorepo with **three surfaces of one product**, all talking to the same backend API:

- `apps/backend` - Hono + Better Auth + Postgres API (the source of truth).
- `apps/web` - Vite/React web client.
- `apps/android` - Kotlin/Jetpack Compose Android client (`com.openlinks.spendtracker`).

## Keep the mobile app in sync (standing rule)

**Any backend API change or user-facing feature must land on the Android client too, not just web.** When you add or change an endpoint in `apps/backend`, or add/modify a feature in `apps/web`, make the matching change in `apps/android` (screens, networking, models, tests) so the two clients stay at parity. Do not treat a feature as "done" until web **and** Android reflect it - unless I explicitly scope a change to backend/web-only.

For Android work, use the `ship-mobile-app` skill.

### Android specifics

- The client has a build-time mock/live seam: `USE_MOCK_AUTH` (from the `useMockAuth` Gradle property) picks between an `x-mock-user` header and a real Better Auth bearer token. Debug builds default to mock; a live build is `./gradlew assembleDebug -PuseMockAuth=false -PserverClientId=<web-oauth-client-id> -PapiBaseUrl=<backend-url>`.
- Connections are unavailable in mock mode by design (the backend answers `503 connections_require_live_mode` because they key off a real `user` row), so the Integrations screen shows an explanatory state instead of an error there.
- Gmail linking leaves the app for a Chrome Custom Tab (Google rejects OAuth in a WebView). There is no App Link back: the Integrations screen reloads its list on resume, which is what picks up a completed link. Adding a real App Link would need `assetlinks.json` hosted on the `APP_BASE_URL` domain.

### Roadmap items - each must also ship on Android

Tracked in `docs/superpowers/plans/` and `docs/superpowers/specs/`:

1. **Multi-tenancy** - data scoped per user (`user_id` on `accounts`/`categories`/`transactions`), auth-gated. Implemented on backend, web and Android, pending deploy.
2. **Per-user integrations (connections)** - each user links their own Gmail account(s) and Telegram; premium (multiple Gmail accounts) is gated by an `is_premium` flag. Implemented on backend, web and Android, pending deploy.
3. **Mercado Pago (Mercado Libre) billing** - subscription flow that sets `is_premium`. Not started. Web and Android both need the upgrade entry point.

## Conventions

- Follow the global user preferences in `~/.claude/CLAUDE.md` (no em dashes, descriptive names, `commita` for commits, verify before claiming done, etc.).
- Backend/web checks: `pnpm --filter <backend|web> typecheck` and `pnpm --filter <backend|web> test`. Android: build/test via Gradle in `apps/android`.
