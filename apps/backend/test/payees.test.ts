import { describe, it, expect, vi } from 'vitest'
import { createPayeesRoute } from '../src/routes/payees.js'

describe('payees route', () => {
  it('GET /api/payees returns distinct payees with their last category', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { payee: 'La Lucha', last_category_id: 'cat-1' },
          { payee: 'Uber', last_category_id: null },
        ],
      }),
    }
    const route = createPayeesRoute(() => db)
    const response = await route.request('/api/payees')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      { payee: 'La Lucha', last_category_id: 'cat-1' },
      { payee: 'Uber', last_category_id: null },
    ])
  })

  it('GET /api/payees returns 500 with a JSON error when the query fails', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) }
    const route = createPayeesRoute(() => db)
    const response = await route.request('/api/payees')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to list payees' })
  })
})
