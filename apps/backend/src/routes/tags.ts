import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { getDistinctTags } from '../db/queries.js'

export function createTagsRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/tags', async (context) => {
    try {
      const tags = await getDistinctTags(resolveDb())
      return context.json(tags)
    } catch (error) {
      console.error('Failed to list tags:', error)
      return context.json({ error: 'Failed to list tags' }, 500)
    }
  })

  return route
}
