import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { buildApp } from './app.js'
import { loadEnv } from './config/env.js'
import { getPool } from './db/pool.js'
import { parseEncryptionKeys } from './connections/crypto.js'
import { startConnectionPolling } from './connections/poller.js'
import { createGmailClientForToken, fetchMessage, listMessageIdsSince } from './gmail/client.js'
import { parseMessage, type GmailMessage } from './gmail/parse.js'
import { processEmail, defaultProcessDeps } from './pipeline/processEmail.js'
import { getTelegramConnectionForUser } from './connections/queries.js'
import { sendMessage } from './telegram/client.js'

const env = loadEnv()
const app = buildApp()

// Auto-import runs on per-user connections: each user links their own Gmail
// account and each imported row is attributed to that user's id (see
// docs/superpowers/specs/2026-07-17-per-user-connections-design.md). The poller
// is live-mode only because connection rows FK to a real "user" row.
if (env.APP_MODE === 'live') {
  const db = getPool()
  const keys = parseEncryptionKeys(env.CONNECTION_ENCRYPTION_KEYS)
  startConnectionPolling(
    {
      pool: db,
      db,
      keys,
      buildGmail: createGmailClientForToken,
      listSince: listMessageIdsSince,
      fetchMessage,
      // The poller types the raw message as unknown; fetchMessage returns a
      // GmailMessage, so narrow it back for the real parser.
      parseMessage: (message) => parseMessage(message as GmailMessage),
      importEmail: (email, importContext) =>
        processEmail(email, importContext, {
          ...defaultProcessDeps,
          db,
          pool: db,
          notify: async (text) => {
            const telegram = await getTelegramConnectionForUser(db, importContext.userId)
            if (telegram) await sendMessage(telegram.external_id, text)
          },
        }).catch((error) => console.error('processEmail failed:', error)),
      nowSeconds: () => String(Math.floor(Date.now() / 1000)),
    },
    env.GMAIL_POLL_INTERVAL_MS,
  )
}

// Serve the built SPA from the same origin as the API. This is not a nicety:
// the Better Auth browser client ignores VITE_API_URL and derives its base from
// window.location.origin, so splitting the web and API origins breaks sign-in.
// Serving both here also means the deployment needs no reverse proxy aware of
// /api, /connections and /telegram (see OPS.md) - they are simply this server.
//
// Registered after buildApp() so every API route already claimed its path and
// wins the match; only unclaimed paths fall through to static files. buildApp()
// itself stays untouched, which keeps it a pure API app for the test suite.
const webDistPath = process.env.WEB_DIST_PATH
if (webDistPath) {
  // Paths the backend owns. An unmatched URL under these is a genuine 404, not
  // a client-side route, so it must not be answered with index.html - doing so
  // hands the SPA shell to API callers and turns a 404 into a confusing
  // "Unexpected token '<'" JSON parse error.
  const backendPrefixes = ['/api', '/connections', '/telegram', '/health']
  const isBackendPath = (pathname: string) =>
    backendPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

  app.use('/*', serveStatic({ root: webDistPath }))
  // History fallback: deep links like /transactions are client-side routes with
  // no file on disk, so hand them the shell and let the router take over.
  app.get('*', async (context, next) => {
    if (isBackendPath(new URL(context.req.url).pathname)) return next()
    return serveStatic({ path: 'index.html', root: webDistPath })(context, next)
  })
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(
    `SpendTracker listening on :${info.port}${webDistPath ? ` (serving SPA from ${webDistPath})` : ''}`,
  )
})
