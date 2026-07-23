import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createAccountsRoute } from '../src/routes/accounts.js'
import type { AppVariables } from '../src/http/context.js'

const sampleAccount = { id: 'a1', name: 'Cash', type: 'cash', currency: 'PEN' }

// The guard normally sets userId on the context before the route runs. For
// these unit tests, mount the route under a tiny parent app that sets it.
function requestAsUser(
  route: Hono<{ Variables: AppVariables }>,
  path: string,
  init?: RequestInit,
) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => {
    context.set('userId', 'user-1')
    await next()
  })
  app.route('/', route)
  return app.request(path, init)
}

describe('accounts route', () => {
  it('GET /api/accounts lists only the user rows', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleAccount] }) }
    const route = createAccountsRoute(() => db)
    const response = await requestAsUser(route, '/api/accounts')
    expect(response.status).toBe(200)
    expect((await response.json())[0].name).toBe('Cash')
    const [listSql, listParams] = db.query.mock.calls[0]
    expect(listSql).toMatch(/user_id = \$/)
    expect(listParams).toContain('user-1')
  })

  it('GET /api/accounts/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createAccountsRoute(() => db)
    const response = await requestAsUser(route, '/api/accounts/nope')
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
    const response = await requestAsUser(route, '/api/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Savings', type: 'bank', currency: 'USD' }),
    })
    expect(response.status).toBe(201)
    expect((await response.json()).id).toBe('a-new')
    const [insertSql, insertParams] = db.query.mock.calls[0]
    expect(insertSql).toMatch(/insert into accounts/i)
    expect(insertParams).toContain('user-1')
  })

  it('POST /api/accounts returns 400 on invalid body', async () => {
    const db = { query: vi.fn() }
    const route = createAccountsRoute(() => db)
    const response = await requestAsUser(route, '/api/accounts', {
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
    const response = await requestAsUser(route, '/api/accounts/a1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Wallet' }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).name).toBe('Wallet')
    const [updateSql, updateParams] = db.query.mock.calls[1]
    expect(updateSql).toMatch(/user_id = \$/)
    expect(updateParams).toEqual(['a1', 'Wallet', 'cash', 'PEN', 'user-1'])
  })

  it('DELETE /api/accounts/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createAccountsRoute(() => db)
    const response = await requestAsUser(route, '/api/accounts/nope', { method: 'DELETE' })
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
    const response = await requestAsUser(route, '/api/accounts/a1', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    const [deleteSql, deleteParams] = db.query.mock.calls[1]
    expect(deleteSql).toMatch(/user_id = \$/)
    expect(deleteParams).toEqual(['a1', 'user-1'])
  })
})
