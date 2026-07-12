import { describe, it, expect, vi } from 'vitest'
import { createSettingsRoute } from '../src/routes/settings.js'

const sampleSettings = { id: 1, base_currency_code: 'PEN' }

describe('settings route', () => {
  it('GET /api/settings returns the single row', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleSettings] }) }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(sampleSettings)
    expect(db.query.mock.calls[0][0]).toMatch(/from settings/i)
  })

  it('GET /api/settings defaults to PEN when the row is missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 1, base_currency_code: 'PEN' })
  })

  it('PUT /api/settings returns 400 on invalid body', async () => {
    const db = { query: vi.fn() }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_currency_code: 123 }),
    })
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('PUT /api/settings returns 400 for an unknown currency code', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_currency_code: 'ZZZ' }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/unknown currency/i)
    // Only the existence check ran, no upsert.
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('PUT /api/settings upserts and returns the updated row', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ code: 'USD' }] }) // currencyExists
        .mockResolvedValueOnce({ rows: [{ id: 1, base_currency_code: 'USD' }] }), // upsert
    }
    const route = createSettingsRoute(() => db)
    const response = await route.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_currency_code: 'USD' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 1, base_currency_code: 'USD' })
    const [upsertSql, upsertParams] = db.query.mock.calls[1]
    expect(upsertSql).toMatch(/on conflict \(id\) do update/i)
    expect(upsertParams).toEqual(['USD'])
  })
})
