import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { healthRoute } from './routes/health.js'
import { oauthRoute } from './routes/oauth.js'
import { telegramRoute } from './telegram/webhook.js'
import { createTransactionsRoute } from './routes/transactions.js'
import { createAccountsRoute } from './routes/accounts.js'
import { createCategoriesRoute } from './routes/categories.js'
import { createTagsRoute } from './routes/tags.js'

export function buildApp(): Hono {
  const app = new Hono()

  const webOrigin = process.env.WEB_ORIGIN
  app.use(
    '/api/*',
    cors({
      origin: webOrigin ?? '*',
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  )

  app.route('/', healthRoute)
  app.route('/', oauthRoute)
  app.route('/', telegramRoute)
  app.route('/', createTransactionsRoute())
  app.route('/', createAccountsRoute())
  app.route('/', createCategoriesRoute())
  app.route('/', createTagsRoute())
  return app
}
