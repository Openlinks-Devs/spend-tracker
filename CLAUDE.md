# SpendTracker - project instructions

This is a pnpm monorepo with **three surfaces of one product**, all talking to the same backend API:

- `apps/backend` - Hono + Better Auth + Postgres API (the source of truth).
- `apps/web` - Vite/React web client, including the signed-out landing page and the static legal documents in `apps/web/public`.
- `apps/android` - Kotlin/Jetpack Compose Android client (`app.openlinks.spendtracker`).

## Keep the mobile app in sync (standing rule)

**Any backend API change or user-facing feature must land on the Android client too, not just web.** When you add or change an endpoint in `apps/backend`, or add/modify a feature in `apps/web`, make the matching change in `apps/android` (screens, networking, models, tests) so the two clients stay at parity. Do not treat a feature as "done" until web **and** Android reflect it - unless I explicitly scope a change to backend/web-only.

For Android work, use the `ship-mobile-app` skill.

### Known Android gaps (the rule is not met today)

These shipped on web and have no Android equivalent yet. Record new ones here rather than letting the rule read as satisfied:

- Account and category CRUD (`AccountsPage`, `CategoriesPage` on web; no Android screens).
- The signed-out landing page and the legal documents (web-only surface).

### Android specifics

- The client has a build-time mock/live seam: `USE_MOCK_AUTH` (from the `useMockAuth` Gradle property) picks between an `x-mock-user` header and a real Better Auth bearer token. Debug builds default to mock; a live build is `./gradlew assembleDebug -PuseMockAuth=false -PserverClientId=<web-oauth-client-id> -PapiBaseUrl=<backend-url>`.
- Connections are unavailable in mock mode by design (the backend answers `503 connections_require_live_mode` because they key off a real `user` row), so the Integrations screen shows an explanatory state instead of an error there.
- Gmail linking leaves the app for a Chrome Custom Tab (Google rejects OAuth in a WebView). There is no App Link back: the Integrations screen reloads its list on resume, which is what picks up a completed link. Adding a real App Link would need `assetlinks.json` hosted on the `APP_BASE_URL` domain.
- A Gmail connection that loses access is announced over Telegram, not in-app: the poller flips it to `needs_reauth` and `connections/notifyConnectionLost.ts` sends the alert. Both clients only show the resulting status on their Integrations screens.

### Roadmap items - each must also ship on Android

Tracked in `docs/superpowers/plans/` and `docs/superpowers/specs/`:

1. **Multi-tenancy** - data scoped per user (`user_id` on `accounts`/`categories`/`transactions`), auth-gated. Deployed to production: migrations 001-005 are applied and `user_id` is `NOT NULL` on all three tables.
2. **Per-user integrations (connections)** - each user links their own Gmail account(s) and Telegram; premium (multiple Gmail accounts) is gated by an `is_premium` flag. Deployed to production.
3. **Mercado Pago (Mercado Libre) billing** - subscription flow that sets `is_premium`. Not started. Web and Android both need the upgrade entry point.
4. **Localization** - the product ships English-only for now, and that is deliberate: all new copy, including Telegram messages, is written in English. Not started. A real localization pass needs a per-user language preference on the `user` row, a catalog on web (Android already routes every string through `i18n/Strings.kt`, which was built for swapping the map), and the backend picking the locale for the messages it sends to Telegram, since those are written server-side rather than in a client.

## Deployment

The product is live at <https://spendtracker.openlinks.app>, deployed on a self-hosted Coolify instance from the **root `Dockerfile`** (build context is the repository root; the image builds both apps).

Production runs as **one container**: the Hono server serves the API and the built SPA from the same origin. Same-origin is a hard requirement, not a convenience, because the Better Auth browser client derives its base URL from `window.location.origin` and ignores `VITE_API_URL`; splitting the origins breaks sign-in. It also means no reverse proxy needs to know about `/api`, `/connections` and `/telegram`.

The production runbook (required env, migration baselining and ordering, Telegram webhook registration, Android release signing) is in `OPS.md`.

## Conventions

- **Theming.** Both clients ship a persisted three-state light/dark/system preference. On Android it is `ThemeStore` (its own `spendtracker_prefs` file, so it survives sign-out) read by `MainActivity` before the first frame, held in `ThemeController` behind `LocalThemeController`, and exposed by `AppearanceMenu` in the top app bar. Any new UI on either surface must respect the preference in effect and must never hardcode colours; read the theme tokens (web: the CSS variables and dark-aware chart themes; Android: `MaterialTheme` plus the theme-resolved chart tokens). Do not call `isSystemInDarkTheme()` or `prefers-color-scheme` directly in a component, because that follows the OS instead of the user's choice.
- Follow the global user preferences in `~/.claude/CLAUDE.md` (no em dashes, descriptive names, `commita` for commits, verify before claiming done, etc.).
- Backend/web checks: `pnpm --filter <backend|web> typecheck` and `pnpm --filter <backend|web> test`. Android: build/test via Gradle in `apps/android`.
