import { describe, it, expect, vi } from 'vitest'
import { createAccountsRoute } from '../src/routes/accounts.js'

const sampleAccount = { id: 'a1', name: 'Cash', type: 'cash', currency: 'PEN' }

describe('accounts route', () => {
  it('GET /api/accounts returns the list', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleAccount] }) }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts')
    expect(response.status).toBe(200)
    expect((await response.json())[0].name).toBe('Cash')
  })

  it('GET /api/accounts/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts/nope')
    expect(response.status).toBe(404)
  })

  it('POST /api/accounts creates and returns 201', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'a-new' }] })
        .mockResolvedValueOnce({ rows: [{ ...sampleAccount, id: 'a-new' }] }),
    }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Savings', type: 'bank', currency: 'USD' }),
    })
    expect(response.status).toBe(201)
    expect((await response.json()).id).toBe('a-new')
    expect(db.query.mock.calls[0][0]).toMatch(/insert into accounts/i)
  })

  it('POST /api/accounts returns 400 on invalid body', async () => {
    const db = { query: vi.fn() }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Savings' }),
    })
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('PATCH /api/accounts/:id merges existing fields', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleAccount] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...sampleAccount, name: 'Wallet' }] }),
    }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts/a1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Wallet' }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).name).toBe('Wallet')
    const [, updateParams] = db.query.mock.calls[1]
    expect(updateParams).toEqual(['a1', 'Wallet', 'cash', 'PEN'])
  })

  it('DELETE /api/accounts/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts/nope', { method: 'DELETE' })
    expect(response.status).toBe(404)
  })

  it('DELETE /api/accounts/:id deletes when present', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleAccount] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts/a1', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })
})
