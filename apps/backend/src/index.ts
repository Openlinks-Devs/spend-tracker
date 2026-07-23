import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { loadEnv } from './config/env.js'

// The env-configured Gmail poller wiring was removed here. Auto-import now waits
// on per-user connections, where each user links their own Gmail account and the
// import attributes rows to that user's id (see
// docs/superpowers/specs/2026-07-17-per-user-connections-design.md). Until then
// there is no owner-only poller to start.
const env = loadEnv()
const app = buildApp()

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`SpendTracker listening on :${info.port}`)
})
