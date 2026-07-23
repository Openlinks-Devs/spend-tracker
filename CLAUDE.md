# SpendTracker — project instructions

This is a pnpm monorepo with **three surfaces of one product**, all talking to the same backend API:

- `apps/backend` — Hono + Better Auth + Postgres API (the source of truth).
- `apps/web` — Vite/React web client.
- `apps/android` — Kotlin/Jetpack Compose Android client (`com.openlinks.spendtracker`).

## Keep the mobile app in sync (standing rule)

**Any backend API change or user-facing feature must land on the Android client too, not just web.** When you add or change an endpoint in `apps/backend`, or add/modify a feature in `apps/web`, make the matching change in `apps/android` (screens, networking, models, tests) so the two clients stay at parity. Do not treat a feature as "done" until web **and** Android reflect it — unless I explicitly scope a change to backend/web-only.

For Android work, use the `ship-mobile-app` skill.

### Parity catch-up (recently added to web, still to mirror on Android)

These shipped on web/backend and need to be brought to the Android client:

- **Transfer** between accounts (creates two linked transactions; supports different amounts/currencies; defaults to the Balance -/+ categories).
- **Duplicate transaction** (pre-fills a new transaction from an existing one).
- **Currency filter** in the transactions filters.

### Roadmap items — each must also ship on Android

Tracked in `docs/superpowers/plans/` and `docs/superpowers/specs/`:

1. **Multi-tenancy** — data scoped per user (`user_id` on `accounts`/`categories`/`transactions`), auth-gated. The Android client must send auth and only ever show the signed-in user's data.
2. **Per-user integrations (connections)** — each user links their own Gmail account(s) and Telegram; premium (multiple Gmail accounts) is gated by an `is_premium` flag. Android needs the connection-management UI too.
3. **Mercado Pago (Mercado Libre) billing** — subscription flow that sets `is_premium`. Android needs the upgrade entry point.

## Conventions

- Follow the global user preferences in `~/.claude/CLAUDE.md` (no em dashes, descriptive names, `commita` for commits, verify before claiming done, etc.).
- Backend/web checks: `pnpm --filter <backend|web> typecheck` and `pnpm --filter <backend|web> test`. Android: build/test via Gradle in `apps/android`.
