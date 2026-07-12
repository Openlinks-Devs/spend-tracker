import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { getCurrencies } from '../db/queries.js'

export function createCurrenciesRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/currencies', async (context) => {
    try {
      const currencies = await getCurrencies(resolveDb())
      return context.json(currencies)
    } catch (error) {
      console.error('Failed to list currencies:', error)
      return context.json({ error: 'Failed to list currencies' }, 500)
    }
  })

  return route
}
