import { describe, it, expect, vi } from 'vitest'
import { createRatesRoute } from '../src/routes/rates.js'

const sampleRate = {
  base_code: 'USD',
  quote_code: 'PEN',
  date: '2026-07-10',
  rate: 3.74,
  source: 'exchangerate-api',
}

describe('rates route', () => {
  it('GET /api/rates lists USD-based rates', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleRate] }) }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates')
    expect(response.status).toBe(200)
    expect((await response.json())[0].quote_code).toBe('PEN')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/base_code = 'USD'/i)
    expect(sql).toMatch(/order by date desc/i)
    expect(params).toEqual([])
  })

  it('GET /api/rates applies quote, from, and to filters as params', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleRate] }) }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates?quote=PEN&from=2026-01-01&to=2026-07-11')
    expect(response.status).toBe(200)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/quote_code = \$1/i)
    expect(sql).toMatch(/date >= \$2/i)
    expect(sql).toMatch(/date <= \$3/i)
    expect(params).toEqual(['PEN', '2026-01-01', '2026-07-11'])
  })

  it('GET /api/rates returns 400 on a malformed date filter', async () => {
    const db = { query: vi.fn() }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates?from=not-a-date')
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('PUT /api/rates returns 400 on invalid body', async () => {
    const db = { query: vi.fn() }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_code: 'USD', quote_code: 'PEN', date: '2026-07-10', rate: -1 }),
    })
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('PUT /api/rates returns 400 for an unknown currency code', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } // currencyExists misses
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_code: 'USD', quote_code: 'ZZZ', date: '2026-07-10', rate: 3.74 }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/unknown currency/i)
  })

  it('PUT /api/rates upserts with source manual and returns the row', async () => {
    const manualRow = { ...sampleRate, source: 'manual' }
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ code: 'USD' }] }) // base_code exists
        .mockResolvedValueOnce({ rows: [{ code: 'PEN' }] }) // quote_code exists
        .mockResolvedValueOnce({ rows: [manualRow] }), // upsert
    }
    const route = createRatesRoute(() => db)
    const response = await route.request('/api/rates', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_code: 'USD', quote_code: 'PEN', date: '2026-07-10', rate: 3.74 }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(manualRow)
    const [upsertSql, upsertParams] = db.query.mock.calls[2]
    expect(upsertSql).toMatch(/insert into exchange_rates/i)
    expect(upsertSql).toMatch(/'manual'/)
    expect(upsertParams).toEqual(['USD', 'PEN', '2026-07-10', 3.74])
  })
})
