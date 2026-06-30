import { Hono } from 'hono'
import { healthRoute } from './routes/health.js'

export function buildApp(): Hono {
  const app = new Hono()
  app.route('/', healthRoute)
  return app
}
