import { Hono } from 'hono'
import { healthRoute } from './routes/health.js'
import { oauthRoute } from './routes/oauth.js'
import { telegramRoute } from './telegram/webhook.js'

export function buildApp(): Hono {
  const app = new Hono()
  app.route('/', healthRoute)
  app.route('/', oauthRoute)
  app.route('/', telegramRoute)
  return app
}
