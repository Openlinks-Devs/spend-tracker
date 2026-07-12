import { describe, it, expect, vi } from 'vitest'
import { createAccountsRoute } from '../src/routes/accounts.js'

const accountId = '11111111-1111-4111-8111-111111111111'
const missingId = '99999999-9999-4999-8999-999999999999'

const sampleAccount = { id: accountId, name: 'Cash', type: 'cash', currency: 'PEN' }
const sampleCurrency = { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 }

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
    const response = await route.request(`/api/accounts/${missingId}`)
    expect(response.status).toBe(404)
  })

  it('POST /api/accounts creates and returns 201', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleCurrency] })
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
    expect(db.query.mock.calls[1][0]).toMatch(/insert into accounts/i)
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

  it('POST /api/accounts returns 400 for an unknown currency code', async () => {
    const db = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Savings', type: 'bank', currency: 'XXX' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Unknown currency code: XXX' })
    expect(db.query).toHaveBeenCalledTimes(1)
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
    const response = await route.request(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Wallet' }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).name).toBe('Wallet')
    const [, updateParams] = db.query.mock.calls[1]
    expect(updateParams).toEqual([accountId, 'Wallet', 'cash', 'PEN'])
  })

  it('PATCH /api/accounts/:id validates a changed currency', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleAccount] })
        .mockResolvedValueOnce({ rows: [sampleCurrency] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...sampleAccount, currency: 'USD' }] }),
    }
    const route = createAccountsRoute(() => db)
    const response = await route.request(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currency: 'USD' }),
    })
    expect(response.status).toBe(200)
    const [, updateParams] = db.query.mock.calls[2]
    expect(updateParams).toEqual([accountId, 'Cash', 'cash', 'USD'])
  })

  it('PATCH /api/accounts/:id returns 400 when changing currency to an unknown code', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleAccount] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const route = createAccountsRoute(() => db)
    const response = await route.request(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currency: 'XXX' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Unknown currency code: XXX' })
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it('DELETE /api/accounts/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createAccountsRoute(() => db)
    const response = await route.request(`/api/accounts/${missingId}`, { method: 'DELETE' })
    expect(response.status).toBe(404)
  })

  it('DELETE /api/accounts/:id deletes when unreferenced', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleAccount] })
        .mockResolvedValueOnce({ rows: [{ referenced: false }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const route = createAccountsRoute(() => db)
    const response = await route.request(`/api/accounts/${accountId}`, { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })

  it('DELETE /api/accounts/:id returns 409 when transactions reference the account', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleAccount] })
        .mockResolvedValueOnce({ rows: [{ referenced: true }] }),
    }
    const route = createAccountsRoute(() => db)
    const response = await route.request(`/api/accounts/${accountId}`, { method: 'DELETE' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Account has transactions. Reassign or delete them first.',
    })
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it.each(['GET', 'PATCH', 'DELETE'])('%s /api/accounts/:id returns 400 on a malformed id', async (method) => {
    const db = { query: vi.fn() }
    const route = createAccountsRoute(() => db)
    const response = await route.request('/api/accounts/not-a-uuid', {
      method,
      ...(method === 'PATCH'
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) }
        : {}),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid account id' })
    expect(db.query).not.toHaveBeenCalled()
  })
})
