import { describe, it, expect, vi } from 'vitest'
import { createTransfersRoute } from '../src/routes/transfers.js'

// A fake pool whose connect() returns a client backed by one query mock, so we
// can assert the SQL/params the route runs inside its transaction.
function fakePool(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() }
  return { connect: vi.fn().mockResolvedValue(client), client }
}

const validBody = {
  from_account_id: 'acc-usd',
  to_account_id: 'acc-pen',
  from_amount: 100,
  to_amount: 370,
  from_currency: 'USD',
  to_currency: 'PEN',
  from_category_id: 'balance-minus',
  to_category_id: 'balance-plus',
  from_description: 'Transfer to BCP Soles',
  to_description: 'Transfer from Deel dólares',
  tags: ['transfer'],
  created_at: '2026-07-13T12:00:00.000Z',
}

function requestTransfer(pool: ReturnType<typeof fakePool>, body: unknown) {
  const route = createTransfersRoute(() => pool)
  return route.request('/api/transfers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('transfers route', () => {
  it('POST /api/transfers inserts both legs atomically and signs the amounts', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'out-1' }] }) // insert out leg
      .mockResolvedValueOnce({ rows: [{ id: 'in-1' }] }) // insert in leg
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
      .mockResolvedValueOnce({ rows: [{ id: 'out-1', amount: -100, currency: 'USD' }] }) // fetch out
      .mockResolvedValueOnce({ rows: [{ id: 'in-1', amount: 370, currency: 'PEN' }] }) // fetch in
    const pool = fakePool(query)

    const response = await requestTransfer(pool, validBody)

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.from.id).toBe('out-1')
    expect(body.to.id).toBe('in-1')

    const calls = query.mock.calls
    expect(calls[0][0]).toBe('BEGIN')
    expect(calls[3][0]).toBe('COMMIT')
    // Out leg: negative amount, source account/currency.
    expect(calls[1][1]).toEqual([
      'Transfer to BCP Soles', -100, 'USD', 'acc-usd', 'balance-minus', ['transfer'], '2026-07-13T12:00:00.000Z',
    ])
    // In leg: positive amount, destination account/currency.
    expect(calls[2][1]).toEqual([
      'Transfer from Deel dólares', 370, 'PEN', 'acc-pen', 'balance-plus', ['transfer'], '2026-07-13T12:00:00.000Z',
    ])
  })

  it('rolls back and returns 500 when the second insert fails', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'out-1' }] }) // insert out leg
      .mockRejectedValueOnce(new Error('insert failed')) // insert in leg
      .mockResolvedValueOnce({ rows: [] }) // ROLLBACK
    const pool = fakePool(query)

    const response = await requestTransfer(pool, validBody)

    expect(response.status).toBe(500)
    expect(query.mock.calls.some((call) => call[0] === 'ROLLBACK')).toBe(true)
    expect(pool.client.release).toHaveBeenCalled()
  })

  it('returns 400 on an invalid body without touching the pool', async () => {
    const query = vi.fn()
    const pool = fakePool(query)

    const response = await requestTransfer(pool, { from_account_id: 'a' })

    expect(response.status).toBe(400)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects non-positive amounts', async () => {
    const query = vi.fn()
    const pool = fakePool(query)

    const response = await requestTransfer(pool, { ...validBody, from_amount: 0 })

    expect(response.status).toBe(400)
    expect(pool.connect).not.toHaveBeenCalled()
  })
})
