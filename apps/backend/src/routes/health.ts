import { Hono } from 'hono'

export const healthRoute = new Hono()

healthRoute.get('/health', (context) => context.json({ status: 'ok' }))
