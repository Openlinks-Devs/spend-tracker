# Running SpendTracker

Sections 1 to 6 are a runbook for bringing the whole stack up on one machine,
where the browser and the servers share `localhost`. If you are running the
servers on a remote box (for example over Tailscale) read "Running on a remote
host" first, because Google OAuth will not work against a private hostname.
"Production deployment" at the bottom covers the live install.

## Prerequisites

- Node 20+ and pnpm (`pnpm install` at the repo root)
- Docker, for a throwaway Postgres
- For the Android client: JDK 17 and the Android SDK, with `ANDROID_HOME` set

## 1. Database

The app never needs your production data to run locally. Use a disposable
container so nothing you do here can touch the real thing:

```bash
docker run -d --name spendtracker-local \
  -e POSTGRES_USER=dev -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=spendtracker \
  -p 5434:5432 postgres:16
```

Port 5434 rather than 5432 so it cannot collide with a system Postgres. Then
apply the schema:

```bash
env DATABASE_URL="postgres://dev:devpass@localhost:5434/spendtracker" \
  pnpm --filter backend migrate
```

On an empty database all five migrations apply in one pass. A database that
already exists is a different job: it needs baselining and a specific ordering
around `004_user_scoping_not_null.sql`. See "Migrating an existing database"
under "Production deployment".

## 2. Backend environment

`apps/backend/src/config/env.ts` validates with Zod and **throws on boot** if any
of these is missing, so a partial `.env` gives you a startup crash rather than a
degraded server:

```
DATABASE_URL            OPENAI_API_KEY           BETTER_AUTH_SECRET (32+ chars)
GOOGLE_CLIENT_ID        GOOGLE_CLIENT_SECRET     BETTER_AUTH_URL
GOOGLE_REDIRECT_URI     TELEGRAM_BOT_TOKEN       CONNECTION_ENCRYPTION_KEYS
TELEGRAM_BOT_USERNAME   TELEGRAM_WEBHOOK_SECRET  TELEGRAM_WEBHOOK_URL
APP_BASE_URL
```

The `TELEGRAM_*` values are required even if you never wire Telegram. Put
placeholder strings there rather than leaving them unset.

`WEB_ORIGIN` is **optional** and is read straight from `process.env`, not from
the Zod schema, so leaving it out never blocks boot. It sets the origin allowed
by the credentialed CORS policy, falling back to `BETTER_AUTH_URL` and then to
`http://localhost:5173`. In the single-origin production image everything is
same-origin, so it can be omitted there.

Generate an encryption key (this one protects stored Gmail refresh tokens):

```bash
echo "1:$(openssl rand -base64 32)"
```

`ALLOWED_EMAILS` has a default but set it anyway; the first address in the list
is treated as the owner, and Better Auth refuses to create a user whose email is
not on it.

### Local-only overrides

Rather than editing `apps/backend/.env`, keep a second file and layer it on top.
Node applies `--env-file` in order and the last definition wins:

```bash
# local.env, kept outside the repo
DATABASE_URL=postgres://dev:devpass@localhost:5434/spendtracker
PORT=3001
NODE_ENV=development
APP_MODE=live
BETTER_AUTH_URL=http://localhost:5173
WEB_ORIGIN=http://localhost:5173
APP_BASE_URL=http://localhost:5173
ALLOWED_EMAILS=you@example.com
GOOGLE_REDIRECT_URI=http://localhost:5173/connections/gmail/callback
CONNECTION_ENCRYPTION_KEYS=1:<base64 from above>
TELEGRAM_BOT_USERNAME=spendtracker_local_bot
```

## 3. Start the backend

```bash
cd apps/backend
pnpm exec tsx --env-file=.env --env-file=/path/to/local.env src/index.ts
```

Verify before moving on. `/health` reports the mode, which is how you catch
"started, but still in mock":

```bash
curl -s http://localhost:3001/health     # {"ok":true,"mode":"live"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/accounts   # 401
```

The 401 is correct: `/api/*` is default-deny and you have no session yet.

## 4. Start the web client

```bash
pnpm --filter web dev
```

Then open <http://localhost:5173>.

**Keep it same-origin.** The browser should talk only to the Vite dev server,
which proxies the backend's routes. Pointing `VITE_API_URL` straight at the
backend port looks like it works and then breaks sign-in, because the Better
Auth browser client ignores `VITE_API_URL`: it derives its own base URL from
`window.location.origin` and appends `/api/auth`. Split the origins and those
calls go somewhere else entirely.

### The backend owns three prefixes, not just /api

Two backend routes sit outside `/api` on purpose, because a third party enters
them directly with no app session:

| Prefix | Who calls it |
|---|---|
| `/api` | The SPA and the Android client, including `/api/auth/*` |
| `/connections` | Google, redirecting to `/connections/gmail/callback` after consent |
| `/telegram` | Telegram, POSTing to `/telegram/webhook` |

`vite.config.ts` forwards all three. **Any production reverse proxy must do the
same.** Forwarding only `/api` is the easy mistake: the app looks completely
healthy, then Gmail linking dies at the final redirect and Telegram messages
vanish, because both resolve against the static web host and 404 there.

`/health` is also outside `/api`, but healthchecks hit the backend directly so
it does not need proxying.

If the backend is not on the default port, point the proxy at it:

```bash
VITE_PROXY_TARGET=http://localhost:3001 pnpm --filter web dev
```

`VITE_APP_MODE` controls the login gate. Set it to `mock` to skip Google
entirely and browse against the mock identity; anything else (or unset) shows
the real sign-in screen. `apps/web/.env.local` is gitignored and takes priority
over `.env`, so it is the right place for machine-specific overrides.

## 5. Google sign-in

The redirect URI Google receives is derived from `BETTER_AUTH_URL`, so with the
same-origin setup above it is the **web** origin, not the backend port:

```
http://localhost:5173/api/auth/callback/google      # Better Auth sign-in
http://localhost:5173/connections/gmail/callback    # Gmail linking
```

Both must be listed under the Web OAuth client in the Google Cloud console
(APIs & Services, Credentials). Changes there take five minutes to a few hours
to propagate, so a first attempt that fails and later succeeds is propagation
rather than a bug.

`GOOGLE_CLIENT_ID` must be the **Web** client. It is also the ID token audience
the Android client sends as `serverClientId`, so the same value serves both. The
separate Android OAuth client is a console registration only and yields no
environment value.

## 6. Android client

Debug builds default to mock mode and talk to `http://10.0.2.2:3000`, which is
how the emulator reaches the host. Override when your backend is elsewhere:

```bash
cd apps/android
./gradlew assembleDebug -PapiBaseUrl=http://10.0.2.2:3001
```

A live build needs the Web client id and a reachable backend:

```bash
./gradlew assembleDebug -PuseMockAuth=false \
  -PserverClientId=<web-oauth-client-id> -PapiBaseUrl=<backend-url>
```

Connections are unavailable in mock mode by design: the backend answers
`503 connections_require_live_mode` because they key off a real `user` row, and
the Integrations screen shows an explanatory state instead of an error.

Credential Manager needs a Google **Play** system image or a real device. A
plain `google_apis` emulator image cannot complete Google sign-in.

### Signed release build

The keystore lives outside the repo. Its four values come from Gradle properties
(`~/.gradle/gradle.properties`) or, for CI, the matching environment variables:

| Gradle property | Environment variable |
|---|---|
| `releaseStoreFile` | `ANDROID_RELEASE_STORE_FILE` |
| `releaseStorePassword` | `ANDROID_RELEASE_STORE_PASSWORD` |
| `releaseKeyAlias` | `ANDROID_RELEASE_KEY_ALIAS` |
| `releaseKeyPassword` | `ANDROID_RELEASE_KEY_PASSWORD` |

```bash
cd apps/android
./gradlew assembleRelease -PuseMockAuth=false \
  -PserverClientId=<web-oauth-client-id> \
  -PapiBaseUrl=https://spendtracker.openlinks.app
```

**The trap:** if any of the four is missing, or the keystore file does not exist
at `releaseStoreFile`, the build does not fail. It produces an **unsigned**
release APK, so a broken signing setup looks exactly like a successful build and
is only caught when the artifact refuses to install. Verify before shipping:

```bash
apksigner verify app/build/outputs/apk/release/app-release.apk
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Backend exits immediately on start | A required variable is missing; the Zod error names it |
| `EADDRINUSE` on 3000 | Something else owns the port. Set `PORT` and `VITE_PROXY_TARGET` together |
| `/health` says `"mode":"mock"` when you wanted live | `APP_MODE` is not `live` in the last `--env-file` |
| Blank page, console shows `Cannot read properties of undefined` | `/api/auth` is reaching the wrong server; check the proxy target |
| `Unexpected token '<' ... is not valid JSON` | An `/api` call got HTML back, so the proxy is pointed at the wrong service |
| `Blocked request. This host is not allowed` | Vite rejects unknown Host headers; see below |
| `redirect_uri_mismatch` from Google | The URI derived from `BETTER_AUTH_URL` is not registered on the Web client |
| `INVALID_CALLBACK_URL` from Better Auth | The `callbackURL` origin differs from `BETTER_AUTH_URL` |
| Vite watcher dies with `EMFILE` | inotify limit; prefix with `CHOKIDAR_USEPOLLING=true` |

## Running on a remote host

If the servers run on another machine and you reach them by hostname, set
`VITE_ALLOWED_HOSTS` or Vite will refuse the request:

```bash
VITE_ALLOWED_HOSTS=myhost,myhost.tail1234.ts.net \
VITE_PROXY_TARGET=http://localhost:3001 pnpm --filter web dev
```

Everything works in that arrangement **except Google sign-in**. Google only
accepts `http` redirect URIs for `localhost` and `127.0.0.1`; any other host must
be a public domain over HTTPS. A private hostname is rejected outright and
cannot be registered. Two ways around it:

- Forward the ports so the browser genuinely uses localhost, which keeps the
  registered `localhost` URIs valid:
  `ssh -L 5173:localhost:5173 -L 3001:localhost:3001 <host>`
- Or expose a real HTTPS name (for example `tailscale serve`) and register that
  origin's callback URIs instead.

## Production deployment

Production is a **Coolify** application at <https://spendtracker.openlinks.app>,
built from the **root `Dockerfile`** with the **repository root as the build
context** (the image builds both apps and needs the workspace manifests):

```bash
docker build -t spend-tracker .
```

It runs as one container on one port: the Hono server answers `/api`,
`/connections`, `/telegram` and `/health`, and serves the built SPA for
everything else. **No reverse-proxy prefix configuration is needed**, unlike the
local Vite proxy in section 4, because the backend serves the SPA itself.
Same-origin is also a hard requirement: the Better Auth browser client derives
its base URL from `window.location.origin`, so splitting the origins breaks
sign-in.

### Runtime environment

The image already sets `NODE_ENV=production`, `TZ=America/Lima` and
`WEB_DIST_PATH=./apps/web/dist` (the last one is what turns on static serving in
`apps/backend/src/index.ts`, and it is resolved relative to the working
directory). Coolify supplies the rest: every variable from section 2, plus

- `APP_MODE=live`. Under `NODE_ENV=production`, `env.ts` **throws on boot** if
  `APP_MODE` is `mock`, because mock mode bypasses auth.
- `ALLOWED_EMAILS`, set explicitly. `env.ts` also throws in production if it is
  empty, rather than falling back to its default.
- `BETTER_AUTH_URL`, `APP_BASE_URL` and `TELEGRAM_WEBHOOK_URL` on the public
  origin, and `GOOGLE_REDIRECT_URI=https://spendtracker.openlinks.app/connections/gmail/callback`
  registered on the Web OAuth client.

### Healthcheck

Coolify's container healthcheck shells out to `curl` (or `wget`) against
`/health`, and `node:22-slim` ships with neither. The runtime stage installs
`curl` for exactly this reason. Remove it and the app starts correctly, is still
marked unhealthy, and the deployment rolls back.

### apps/web/public must be copied

The privacy policy and terms are static files in `apps/web/public`, which Vite
copies into `dist/` verbatim. The Dockerfile copies `apps/web/public` before
`vite build`; drop that line and the build still succeeds while the legal
documents 404 in production. This has already regressed twice (commits
`406a712`, `483c8a2`).

### Coolify credentials

The repository-root `.env` is gitignored and holds `COOLIFY_API_KEY` and
`COOLIFY_BASE_URL`, which is what the Coolify tooling reads to drive the
deployment. A fresh clone has to recreate it.

### Migrations run on every deployment

The container's `CMD` is `migrate && exec node ...`, so every pending migration
applies at startup, before the server accepts a request. Three consequences
worth knowing:

- **A failed migration means the container never starts.** Coolify sees an
  unhealthy deployment and rolls back, which is the intended outcome: it is
  better than serving new code against an old schema.
- **The run holds a Postgres advisory lock** (`727402`), so if a rolling deploy
  ever has two containers booting at once, the second waits for the schema
  instead of racing the first through the check-then-insert.
- **The runner still applies everything pending, in order, with no target or
  step argument.** That is exactly what makes the baselining below matter: a
  production database that is not correctly recorded in `schema_migrations`
  will now fail a deployment rather than waiting for someone to run migrations
  by hand.

Before the first deployment on this scheme, confirm the baseline:

```sql
SELECT name FROM schema_migrations ORDER BY name;
```

Every migration already applied to that database must be listed. If any are
missing, record them with the `INSERT` below before deploying.

### Migrating an existing database

`migrate.ts` skips only the files already recorded in `schema_migrations`
(`name text PRIMARY KEY, applied_at timestamptz`), and `002_auth.sql` is not
idempotent: it does a bare `create table "user"` with no `IF NOT EXISTS`. So a
database whose Better Auth tables already exist dies on 002 with a duplicate
table error, long before 004 is ever reached. Baseline first:

```sql
INSERT INTO schema_migrations (name) VALUES ('001_init.sql'), ('002_auth.sql')
  ON CONFLICT DO NOTHING;
```

(Create the table yourself if this is the first run: `migrate.ts` creates it with
`CREATE TABLE IF NOT EXISTS`, so running the migration once to that point is also
fine.) Then, for a database that already holds ledger rows, follow this order:

1. Apply `003_user_scoping.sql` (nullable `user_id`) **on its own**. There is no
   command for this: `pnpm --filter backend migrate` takes no target, range or
   step argument, it loops over every pending file (`src/scripts/migrate.ts`), so
   running it here applies 003 and then immediately attempts 004 on unbackfilled
   rows. Apply the one file and record it the way `migrate.ts` would, in a single
   transaction:

   ```bash
   cd apps/backend
   psql "<production-url>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/003_user_scoping.sql \
     -c "INSERT INTO schema_migrations (name) VALUES ('003_user_scoping.sql');"
   ```

   Without `psql` there is a fallback, because each migration runs in its own
   transaction: run `pnpm --filter backend migrate` and let it fail on 004. That
   failure rolls 004 back and aborts the loop with exit code 1, leaving 003
   applied and recorded, which is the state this step wants. Expect a non-zero
   exit and a `column "user_id" of relation "accounts" contains null values`
   error; any other error means something else is wrong and you should stop.
2. The owner signs in once with Google, so a `"user"` row exists for the first
   address in `ALLOWED_EMAILS`. `backfill-owner.ts` exits with an error without
   it.
3. Run the backfill:

   ```bash
   cd apps/backend
   env DATABASE_URL=<production-url> ALLOWED_EMAILS=owner@example.com \
     pnpm exec tsx scripts/backfill-owner.ts
   ```

4. Confirm no old deployment is still writing rows with a NULL `user_id`. Skip
   this and 004 either fails on rows written after the backfill, or passes and
   then the old code starts failing its inserts.
5. Only now run the rest: `pnpm --filter backend migrate`. With 001-003 recorded
   in `schema_migrations` it skips them and applies
   `004_user_scoping_not_null.sql` and `005_connections.sql`, which is exactly
   what "the rest" means here since the script always runs everything pending.

### Telegram webhook registration

Setting `TELEGRAM_WEBHOOK_URL` registers nothing by itself. Telegram has to be
told where to POST, once after deploy and again whenever the URL changes, or
`/telegram/webhook` is simply never called. There is no npm script for it:

```bash
cd apps/backend
pnpm exec tsx --env-file=/path/to/production.env src/scripts/set-webhook.ts
```

The script reads the full validated env, so it needs the production values, and
the URL must be publicly reachable: a `localhost` webhook URL is unreachable
from Telegram's servers.
