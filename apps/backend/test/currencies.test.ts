import { describe, it, expect, vi } from 'vitest'
import { createCurrenciesRoute } from '../src/routes/currencies.js'

const sampleCurrencies = [
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', decimal_places: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 },
]

describe('currencies route', () => {
  it('GET /api/currencies returns the list ordered by code', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: sampleCurrencies }) }
    const route = createCurrenciesRoute(() => db)
    const response = await route.request('/api/currencies')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveLength(2)
    expect(body[0].code).toBe('PEN')
    const [sql] = db.query.mock.calls[0]
    expect(sql).toMatch(/from currencies/i)
    expect(sql).toMatch(/order by code/i)
  })

  it('GET /api/currencies returns 500 on db failure', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('boom')) }
    const route = createCurrenciesRoute(() => db)
    const response = await route.request('/api/currencies')
    expect(response.status).toBe(500)
  })
})
