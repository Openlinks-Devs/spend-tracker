import { describe, it, expect, vi } from 'vitest'
import { createTransactionsRoute } from '../src/routes/transactions.js'

describe('analytics route', () => {
  it('GET /api/transactions/analytics returns grouped aggregates', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ currency: 'PEN', income: 100, spend: 40, net: 60, count: 3 }] })
        .mockResolvedValueOnce({ rows: [{ bucketStart: '2026-07-01T00:00:00.000Z', currency: 'PEN', income: 100, spend: 40, net: 60 }] })
        .mockResolvedValueOnce({ rows: [{ categoryId: 'c1', currency: 'PEN', spend: 40, income: 0, net: -40, count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ tag: 'coffee', currency: 'PEN', spend: 40, count: 2 }] }),
    }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/analytics?bucket=month&type=expense')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.summary[0].currency).toBe('PEN')
    expect(body.series[0].bucketStart).toBe('2026-07-01T00:00:00.000Z')
    expect(body.byCategory[0].categoryId).toBe('c1')
    expect(body.byTag[0].tag).toBe('coffee')
    expect(db.query.mock.calls[1][0]).toMatch(/date_trunc\('month'/)
  })

  it('defaults an invalid bucket to month', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createTransactionsRoute(() => db)
    await route.request('/api/transactions/analytics?bucket=nonsense')
    expect(db.query.mock.calls[1][0]).toMatch(/date_trunc\('month'/)
  })
})
