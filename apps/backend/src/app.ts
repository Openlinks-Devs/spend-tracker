import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getAuth } from './auth.js'
import { createSessionGuard } from './auth/sessionGuard.js'
import { healthRoute } from './routes/health.js'
import { oauthRoute } from './routes/oauth.js'
import { telegramRoute } from './telegram/webhook.js'
import { createTransactionsRoute } from './routes/transactions.js'
import { createAccountsRoute } from './routes/accounts.js'
import { createCategoriesRoute } from './routes/categories.js'
import { createTagsRoute } from './routes/tags.js'

export function buildApp(): Hono {
  const app = new Hono()

  // Credentialed requests (session cookie) require a concrete origin, never '*',
  // or browsers refuse to expose the response. Default to the browser-facing
  // origin (WEB_ORIGIN, else BETTER_AUTH_URL) and fall back to the local dev origin.
  const webOrigin =
    process.env.WEB_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:5173'
  app.use(
    '/api/*',
    cors({
      origin: webOrigin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  )

  // Auth endpoints (never gated).
  app.on(['GET', 'POST'], '/api/auth/*', (context) => getAuth().handler(context.req.raw))

  // Health (never gated).
  app.route('/', healthRoute)

  // Gate the data routes behind a valid session.
  const guard = createSessionGuard((headers) => getAuth().api.getSession({ headers }))
  for (const prefix of ['/api/transactions', '/api/accounts', '/api/categories', '/api/tags']) {
    app.use(prefix, guard)
    app.use(`${prefix}/*`, guard)
  }

  app.route('/', oauthRoute)
  app.route('/', telegramRoute)
  app.route('/', createTransactionsRoute())
  app.route('/', createAccountsRoute())
  app.route('/', createCategoriesRoute())
  app.route('/', createTagsRoute())
  return app
}
