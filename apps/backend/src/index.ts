import { serve } from '@hono/node-server'
import { buildApp } from './app.js'
import { loadEnv } from './config/env.js'
import { getPool } from './db/pool.js'
import { parseEncryptionKeys } from './connections/crypto.js'
import { startConnectionPolling } from './connections/poller.js'
import { createGmailClientForToken, fetchMessage, listMessageIdsSince } from './gmail/client.js'
import { parseMessage, type GmailMessage } from './gmail/parse.js'
import { processEmail, defaultProcessDeps } from './pipeline/processEmail.js'
import { getTelegramConnectionForUser } from './connections/queries.js'
import { sendMessage } from './telegram/client.js'

const env = loadEnv()
const app = buildApp()

// Auto-import runs on per-user connections: each user links their own Gmail
// account and each imported row is attributed to that user's id (see
// docs/superpowers/specs/2026-07-17-per-user-connections-design.md). The poller
// is live-mode only because connection rows FK to a real "user" row.
if (env.APP_MODE === 'live') {
  const db = getPool()
  const keys = parseEncryptionKeys(env.CONNECTION_ENCRYPTION_KEYS)
  startConnectionPolling(
    {
      pool: db,
      db,
      keys,
      buildGmail: createGmailClientForToken,
      listSince: listMessageIdsSince,
      fetchMessage,
      // The poller types the raw message as unknown; fetchMessage returns a
      // GmailMessage, so narrow it back for the real parser.
      parseMessage: (message) => parseMessage(message as GmailMessage),
      importEmail: (email, importContext) =>
        processEmail(email, importContext, {
          ...defaultProcessDeps,
          db,
          pool: db,
          notify: async (text) => {
            const telegram = await getTelegramConnectionForUser(db, importContext.userId)
            if (telegram) await sendMessage(telegram.external_id, text)
          },
        }).catch((error) => console.error('processEmail failed:', error)),
      nowSeconds: () => String(Math.floor(Date.now() / 1000)),
    },
    env.GMAIL_POLL_INTERVAL_MS,
  )
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`SpendTracker listening on :${info.port}`)
})
