# SpendTracker

pnpm monorepo for SpendTracker.

## Packages

- `apps/backend` - Hono/TypeScript agent + REST CRUD API (Gmail -> Postgres -> Telegram). See `apps/backend/README.md`.
- `apps/web` - Vite + React dashboard (added in a later step).
- `apps/android` - Kotlin/Jetpack Compose app (standalone Gradle, not part of the pnpm workspace).

## Getting started

```
pnpm install
pnpm -r typecheck
pnpm -r test
```

Per-package commands use filters, for example `pnpm --filter backend dev`.
