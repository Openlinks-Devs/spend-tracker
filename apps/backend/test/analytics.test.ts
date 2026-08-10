import { describe, it, expect, vi } from 'vitest'
import { createTransactionsRoute } from '../src/routes/transactions.js'

describe('analytics route', () => {
  it('GET /api/transactions/analytics returns grouped aggregates', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ currency: 'PEN', income: 100, spend: 40, net: 60, count: 3 }] })
        .mockResolvedValueOnce({ rows: [{ bucketStart: '2026-07-01T00:00:00.000', currency: 'PEN', income: 100, spend: 40, net: 60 }] })
        .mockResolvedValueOnce({ rows: [{ categoryId: 'c1', currency: 'PEN', spend: 40, income: 0, net: -40, count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ tag: 'coffee', currency: 'PEN', spend: 40, count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ accountId: 'a1', currency: 'PEN', income: 100, spend: 40, net: 60, count: 3 }] }),
    }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/analytics?bucket=month&type=expense')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.summary[0].currency).toBe('PEN')
    expect(body.series[0].bucketStart).toBe('2026-07-01T00:00:00.000')
    expect(body.byCategory[0].categoryId).toBe('c1')
    expect(body.byTag[0].tag).toBe('coffee')
    expect(body.byAccount[0].accountId).toBe('a1')
    expect(body.byAccount[0].net).toBe(60)
    expect(db.query.mock.calls[4][0]).toMatch(/GROUP BY account_id, currency/)
    expect(db.query.mock.calls[1][0]).toMatch(/date_trunc\('month'/)
  })

  // created_at is `timestamp without time zone`, so date_trunc yields a LOCAL
  // midnight. Formatting it with a literal "Z" asserts that local time is UTC.
  // A client west of UTC (Lima, -5) then parses the bucket back five hours,
  // crossing midnight, and renders every daily bucket on the previous day.
  it('emits bucketStart as a local timestamp rather than a false UTC instant', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createTransactionsRoute(() => db)
    await route.request('/api/transactions/analytics?bucket=day')
    const seriesSql = db.query.mock.calls[1][0]
    expect(seriesSql).toMatch(/date_trunc\('day'/)
    expect(seriesSql).not.toMatch(/"Z"/)
  })

  it('defaults an invalid bucket to month', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createTransactionsRoute(() => db)
    await route.request('/api/transactions/analytics?bucket=nonsense')
    expect(db.query.mock.calls[1][0]).toMatch(/date_trunc\('month'/)
  })
})
