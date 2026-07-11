import { describe, it, expect, vi } from 'vitest'
import { createTransactionsRoute } from '../src/routes/transactions.js'

const sampleTransaction = {
  id: 'tx1',
  description: 'Coffee',
  amount: -12.5,
  currency: 'PEN',
  account_id: 'a1',
  category_id: 'c1',
  tags: ['food'],
  created_at: '2026-06-30T10:00:00.000Z',
  updated_at: null,
}

describe('transactions route', () => {
  it('GET /api/transactions returns the list', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleTransaction] }) }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body[0].id).toBe('tx1')
  })

  it('GET /api/transactions/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/nope')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Transaction not found' })
  })

  it('POST /api/transactions creates and returns 201', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'tx-new' }] })
        .mockResolvedValueOnce({ rows: [{ ...sampleTransaction, id: 'tx-new' }] }),
    }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'Lunch',
        amount: -30,
        currency: 'PEN',
        account_id: 'a1',
        category_id: 'c1',
        tags: ['food'],
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.id).toBe('tx-new')
    const [insertSql] = db.query.mock.calls[0]
    expect(insertSql).toMatch(/insert into transactions/i)
  })

  it('POST /api/transactions returns 400 on invalid body', async () => {
    const db = { query: vi.fn() }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: '' }),
    })
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('PATCH /api/transactions/:id merges and returns the updated record', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleTransaction] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...sampleTransaction, description: 'Tea' }] }),
    }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/tx1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Tea' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.description).toBe('Tea')
  })

  it('PATCH /api/transactions/:id preserves the existing category_id when the body omits it', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleTransaction] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...sampleTransaction, description: 'Tea' }] }),
    }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/tx1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Tea' }),
    })
    expect(response.status).toBe(200)
    const updateParams = db.query.mock.calls[1][1]
    expect(updateParams[5]).toBe('c1')
  })

  it('PATCH /api/transactions/:id updates amount, currency, account, and date', async () => {
    const updatedTransaction = {
      ...sampleTransaction,
      amount: -99.9,
      currency: 'USD',
      account_id: 'a2',
      created_at: '2026-07-01T08:30:00.000Z',
    }
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleTransaction] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [updatedTransaction] }),
    }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/tx1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: -99.9,
        currency: 'USD',
        account_id: 'a2',
        created_at: '2026-07-01T08:30:00.000Z',
      }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.amount).toBe(-99.9)
    const updateParams = db.query.mock.calls[1][1]
    expect(updateParams).toEqual([
      'tx1',
      'Coffee',
      -99.9,
      'USD',
      'a2',
      'c1',
      ['food'],
      '2026-07-01T08:30:00.000Z',
    ])
  })

  it('PATCH /api/transactions/:id preserves amount, currency, account, and date when omitted', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleTransaction] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...sampleTransaction, description: 'Tea' }] }),
    }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/tx1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Tea' }),
    })
    expect(response.status).toBe(200)
    const updateParams = db.query.mock.calls[1][1]
    expect(updateParams).toEqual([
      'tx1',
      'Tea',
      -12.5,
      'PEN',
      'a1',
      'c1',
      ['food'],
      '2026-06-30T10:00:00.000Z',
    ])
  })

  it('PATCH /api/transactions/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/nope', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Tea' }),
    })
    expect(response.status).toBe(404)
  })

  it('DELETE /api/transactions/:id deletes when present', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleTransaction] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/tx1', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })

  it('DELETE /api/transactions/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions/nope', { method: 'DELETE' })
    expect(response.status).toBe(404)
  })

  it('returns 500 with a JSON error when the query fails', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to list transactions' })
  })
})
