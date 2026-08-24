import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { loadEnv } from '../config/env.js'
import { parseEncryptionKeys } from '../connections/crypto.js'
import { countEmailLog, listEmailLog } from '../connections/importSource.js'
import { retryEmail, type RetryEmailDeps } from '../connections/retryEmail.js'
import { createGmailClientForToken, fetchMessage } from '../gmail/client.js'
import { parseMessage, type GmailMessage } from '../gmail/parse.js'
import { createImportEmail } from '../pipeline/importEmail.js'
import { getUserId, type AppVariables } from '../http/context.js'

// Built per request rather than at module load: the encryption keys come from
// the environment, which the test suite sets up after importing this module.
function defaultRetryDeps(): RetryEmailDeps {
  const pool = getPool()
  return {
    db: pool,
    keys: parseEncryptionKeys(loadEnv().CONNECTION_ENCRYPTION_KEYS),
    buildGmail: createGmailClientForToken,
    fetchMessage,
    parseMessage: (message) => parseMessage(message as GmailMessage),
    importEmail: createImportEmail(pool, pool),
  }
}

const RETRY_FAILURE_STATUS = {
  email_not_found: 404,
  verdict_not_retryable: 409,
  connection_needs_reauth: 409,
} as const

export function createEmailsRoute(
  resolveDb: () => Queryable = getPool,
  resolveRetryDeps: () => RetryEmailDeps = defaultRetryDeps,
): Hono<{ Variables: AppVariables }> {
  const route = new Hono<{ Variables: AppVariables }>()

  // These rows hang off connection rows, which FK to a real "user" row; mock
  // mode has none, so it answers the same 503 the connections routes do. Both
  // patterns are registered because a Hono wildcard does not match the bare
  // path the list endpoint lives on.
  const requireLiveMode: MiddlewareHandler = async (context, next) => {
    if (loadEnv().APP_MODE === 'mock') {
      return context.json({ error: 'connections_require_live_mode' }, 503)
    }
    return next()
  }
  route.use('/api/emails', requireLiveMode)
  route.use('/api/emails/*', requireLiveMode)

  route.get('/api/emails', async (context) => {
    try {
      const db = resolveDb()
      const userId = getUserId(context)
      const query = context.req.query()
      const limit = Math.min(query.limit ? Number(query.limit) : 50, 200)
      const offset = query.offset ? Number(query.offset) : 0
      const items = await listEmailLog(db, userId, { limit, offset })
      const total = await countEmailLog(db, userId)
      return context.json({ items, total, limit, offset })
    } catch (error) {
      console.error('Failed to list emails:', error)
      return context.json({ error: 'Failed to list emails' }, 500)
    }
  })

  route.post('/api/emails/:connectionId/:messageId/retry', async (context) => {
    const userId = getUserId(context)
    const { connectionId, messageId } = context.req.param()
    try {
      const result = await retryEmail(resolveRetryDeps(), userId, connectionId, messageId)
      if (!result.ok) {
        return context.json({ error: result.reason }, RETRY_FAILURE_STATUS[result.reason])
      }
      return context.json({ email: result.email })
    } catch (error) {
      // The pipeline has already recorded its own failed row by this point, so
      // the Inbox reflects the attempt even though this answers 500.
      console.error(`Retry of message ${messageId} failed:`, error)
      return context.json({ error: 'retry_failed' }, 500)
    }
  })

  return route
}
