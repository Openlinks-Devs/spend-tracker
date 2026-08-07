# Running SpendTracker locally

A runbook for bringing the whole stack up on one machine, where the browser and
the servers share `localhost`. If you are running the servers on a remote box
(for example over Tailscale) read "Running on a remote host" at the bottom first,
because Google OAuth will not work against a private hostname.

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

On an empty database all five migrations apply in one pass. (Against a database
that already holds ledger rows, `004_user_scoping_not_null.sql` fails on purpose
until `scripts/backfill-owner.ts` has run. That is a production concern only.)

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
which proxies `/api` to the backend. Pointing `VITE_API_URL` straight at the
backend port looks like it works and then breaks sign-in, because the Better
Auth browser client ignores `VITE_API_URL`: it derives its own base URL from
`window.location.origin` and appends `/api/auth`. Split the origins and those
calls go somewhere else entirely.

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
