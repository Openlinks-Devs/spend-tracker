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

export function buildApp(
  resolveSession: (headers: Headers) => Promise<unknown> = (headers) =>
    getAuth().api.getSession({ headers }),
): Hono {
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

  // Default-deny: gate every /api/* route behind a valid session, except
  // /api/auth/* itself (login must never be gated). Any future data route
  // ships gated automatically, no allowlist to remember to update.
  const guard = createSessionGuard(resolveSession)
  app.use('/api/*', async (context, next) => {
    if (context.req.path.startsWith('/api/auth/')) {
      return next()
    }
    return guard(context, next)
  })

  app.route('/', oauthRoute)
  app.route('/', telegramRoute)
  app.route('/', createTransactionsRoute())
  app.route('/', createAccountsRoute())
  app.route('/', createCategoriesRoute())
  app.route('/', createTagsRoute())
  return app
}
