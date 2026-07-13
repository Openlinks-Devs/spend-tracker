// Temporary demo server: wires only the HTTP routes (no Gmail poller), so the
// analytics feature can be exercised against a seeded database. Not committed.
import { serve } from '@hono/node-server'
import { buildApp } from './src/app.js'

const app = buildApp()
const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Demo API listening on :${info.port}`)
})
