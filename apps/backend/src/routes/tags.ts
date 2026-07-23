import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { getDistinctTags } from '../db/queries.js'
import type { AppVariables } from '../http/context.js'
import { getUserId } from '../http/context.js'

export function createTagsRoute(
  resolveDb: () => Queryable = getPool,
): Hono<{ Variables: AppVariables }> {
  const route = new Hono<{ Variables: AppVariables }>()

  route.get('/api/tags', async (context) => {
    try {
      const tags = await getDistinctTags(resolveDb(), getUserId(context))
      return context.json(tags)
    } catch (error) {
      console.error('Failed to list tags:', error)
      return context.json({ error: 'Failed to list tags' }, 500)
    }
  })

  return route
}
