import { Hono } from 'hono'

export const healthRoute = new Hono()

healthRoute.get('/health', (context) => {
  const mode = process.env.APP_MODE === 'live' ? 'live' : 'mock'
  return context.json({ ok: true, mode })
})
