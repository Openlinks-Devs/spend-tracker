import { serve } from '@hono/node-server'
import { buildApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)
const app = buildApp()

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SpendTracker listening on :${info.port}`)
})
