import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { currencyExists, getExchangeRates, upsertManualRate } from '../db/queries.js'
import { parseJsonBody } from './validation.js'

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const currencyCodePattern = /^[A-Z]{3}$/

const rateQuerySchema = z.object({
  quote: z.string().regex(currencyCodePattern).optional(),
  from: z.string().regex(isoDatePattern).optional(),
  to: z.string().regex(isoDatePattern).optional(),
})

const manualRateSchema = z.object({
  base_code: z.string().regex(currencyCodePattern, 'must be a 3-letter ISO 4217 code'),
  quote_code: z.string().regex(currencyCodePattern, 'must be a 3-letter ISO 4217 code'),
  date: z.string().regex(isoDatePattern, 'must be YYYY-MM-DD'),
  rate: z.number().positive(),
})

export function createRatesRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/rates', async (context) => {
    const parsedQuery = rateQuerySchema.safeParse({
      quote: context.req.query('quote'),
      from: context.req.query('from'),
      to: context.req.query('to'),
    })
    if (!parsedQuery.success) {
      return context.json(
        { error: 'Invalid query: quote must be a 3-letter code, from/to must be YYYY-MM-DD' },
        400,
      )
    }
    try {
      const rates = await getExchangeRates(resolveDb(), parsedQuery.data)
      return context.json(rates)
    } catch (error) {
      console.error('Failed to list rates:', error)
      return context.json({ error: 'Failed to list rates' }, 500)
    }
  })

  route.put('/api/rates', async (context) => {
    const parsed = await parseJsonBody(context, manualRateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const db = resolveDb()
      for (const code of [parsed.data.base_code, parsed.data.quote_code]) {
        const known = await currencyExists(db, code)
        if (!known) {
          return context.json({ error: `Unknown currency code: ${code}` }, 400)
        }
      }
      const storedRate = await upsertManualRate(db, parsed.data)
      return context.json(storedRate)
    } catch (error) {
      console.error('Failed to upsert rate:', error)
      return context.json({ error: 'Failed to upsert rate' }, 500)
    }
  })

  return route
}
