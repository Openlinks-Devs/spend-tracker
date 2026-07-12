import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { currencyExists, getSettings, updateSettings } from '../db/queries.js'
import { parseJsonBody } from './validation.js'

const settingsUpdateSchema = z.object({
  base_currency_code: z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO 4217 code'),
})

export function createSettingsRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/settings', async (context) => {
    try {
      const settings = await getSettings(resolveDb())
      return context.json(settings)
    } catch (error) {
      console.error('Failed to fetch settings:', error)
      return context.json({ error: 'Failed to fetch settings' }, 500)
    }
  })

  route.put('/api/settings', async (context) => {
    const parsed = await parseJsonBody(context, settingsUpdateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const db = resolveDb()
      const known = await currencyExists(db, parsed.data.base_currency_code)
      if (!known) {
        return context.json(
          { error: `Unknown currency code: ${parsed.data.base_currency_code}` },
          400,
        )
      }
      const settings = await updateSettings(db, parsed.data.base_currency_code)
      return context.json(settings)
    } catch (error) {
      console.error('Failed to update settings:', error)
      return context.json({ error: 'Failed to update settings' }, 500)
    }
  })

  return route
}
