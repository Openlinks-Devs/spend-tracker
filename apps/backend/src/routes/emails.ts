import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { loadEnv } from '../config/env.js'
import { countEmailLog, listEmailLog } from '../connections/importSource.js'
import { getUserId, type AppVariables } from '../http/context.js'

export function createEmailsRoute(
  resolveDb: () => Queryable = getPool,
): Hono<{ Variables: AppVariables }> {
  const route = new Hono<{ Variables: AppVariables }>()

  // These rows hang off connection rows, which FK to a real "user" row; mock
  // mode has none, so it answers the same 503 the connections routes do.
  route.use('/api/emails', async (context, next) => {
    if (loadEnv().APP_MODE === 'mock') {
      return context.json({ error: 'connections_require_live_mode' }, 503)
    }
    return next()
  })

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

  return route
}
