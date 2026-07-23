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

// The Gmail poller runs server-side with no session, so imported transactions
// must be attributed to an explicit owner. Resolve the owner's user id by
// email (first entry of ALLOWED_EMAILS) at startup; the owner must have
// signed in via Google at least once so a "user" row exists.
const ownerEmail = env.ALLOWED_EMAILS.split(',')[0]?.trim()
const ownerLookup = ownerEmail
  ? await db.query('SELECT id FROM "user" WHERE email = $1', [ownerEmail])
  : { rows: [] }
const ownerUserId = ownerLookup.rows[0]?.id as string | undefined

if (!ownerUserId) {
  console.warn(
    `No "user" row for ${ownerEmail ?? '(no ALLOWED_EMAILS)'}. Sign in once with Google so the Gmail poller can attribute imports to an owner; the poller will not start until then.`,
  )
} else {
  const gmail = createGmailClient()
  startPolling(
    {
      gmail,
      db,
      onEmail: (email) =>
        processEmail(
          { subject: email.subject, text: email.text },
          { db, ...defaultProcessDeps, userId: ownerUserId },
        ).catch((error) => console.error('processEmail failed:', error)),
    },
    env.GMAIL_POLL_INTERVAL_MS,
  )
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`SpendTracker listening on :${info.port}`)
})
