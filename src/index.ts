import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { loadEnv } from './config/env.js'
import { getPool } from './db/pool.js'
import { ensureStateTable } from './db/queries.js'
import { createGmailClient } from './gmail/client.js'
import { startPolling } from './gmail/poller.js'
import { processEmail, defaultProcessDeps } from './pipeline/processEmail.js'

const env = loadEnv()
const app = buildApp()
const db = getPool()

await ensureStateTable(db)

const gmail = createGmailClient()
startPolling(
  {
    gmail,
    db,
    onEmail: (email) =>
      processEmail(
        { subject: email.subject, text: email.text },
        { db, ...defaultProcessDeps },
      ).catch((error) => console.error('processEmail failed:', error)),
  },
  env.GMAIL_POLL_INTERVAL_MS,
)

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`SpendTracker listening on :${info.port}`)
})
