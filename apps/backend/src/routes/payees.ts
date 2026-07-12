import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { getPayees } from '../db/queries.js'

export function createPayeesRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/payees', async (context) => {
    try {
      const payees = await getPayees(resolveDb())
      return context.json(payees)
    } catch (error) {
      console.error('Failed to list payees:', error)
      return context.json({ error: 'Failed to list payees' }, 500)
    }
  })

  return route
}
