import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createCategoriesRoute } from '../src/routes/categories.js'
import type { AppVariables } from '../src/http/context.js'

const sampleCategory = { id: 'c1', name: 'Food', type: 'out', parent_id: null, emoji: '🍽️' }

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

describe('categories route', () => {
  it('GET /api/categories lists only the user rows', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleCategory] }) }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories')
    expect(response.status).toBe(200)
    expect((await response.json())[0].name).toBe('Food')
    const [listSql, listParams] = db.query.mock.calls[0]
    expect(listSql).toMatch(/user_id = \$/)
    expect(listParams).toContain('user-1')
  })

  it('GET /api/categories/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories/nope')
    expect(response.status).toBe(404)
  })

  it('POST /api/categories creates and returns 201', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'c-new' }] })
        .mockResolvedValueOnce({ rows: [{ ...sampleCategory, id: 'c-new' }] }),
    }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Transport', type: 'out' }),
    })
    expect(response.status).toBe(201)
    expect((await response.json()).id).toBe('c-new')
    const [insertSql, insertParams] = db.query.mock.calls[0]
    expect(insertSql).toMatch(/insert into categories/i)
    expect(insertParams).toContain('user-1')
  })

  it('POST /api/categories returns 400 on invalid body', async () => {
    const db = { query: vi.fn() }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Transport' }),
    })
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('PATCH /api/categories/:id merges existing fields', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleCategory] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...sampleCategory, name: 'Groceries' }] }),
    }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories/c1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Groceries' }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).name).toBe('Groceries')
    const [updateSql, updateParams] = db.query.mock.calls[1]
    expect(updateSql).toMatch(/user_id = \$/)
    expect(updateParams).toEqual(['c1', 'Groceries', 'out', null, '🍽️', 'user-1'])
  })

  it('DELETE /api/categories/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories/nope', { method: 'DELETE' })
    expect(response.status).toBe(404)
  })

  it('DELETE /api/categories/:id deletes when present', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleCategory] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories/c1', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    const [deleteSql, deleteParams] = db.query.mock.calls[1]
    expect(deleteSql).toMatch(/user_id = \$/)
    expect(deleteParams).toEqual(['c1', 'user-1'])
  })

  it('POST /api/categories rejects a parent that is not the caller\'s', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Taxi', type: 'out', parent_id: 'someone-elses' }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Parent category not found')
  })

  it('POST /api/categories stores the parent and emoji', async () => {
    const parent = { ...sampleCategory, id: 'c-parent' }
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [parent] })
        .mockResolvedValueOnce({ rows: [{ id: 'c-new' }] })
        .mockResolvedValueOnce({ rows: [{ ...sampleCategory, id: 'c-new' }] }),
    }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Taxi', type: 'out', parent_id: 'c-parent', emoji: '🚕' }),
    })
    expect(response.status).toBe(201)
    const [, insertParams] = db.query.mock.calls[1]
    expect(insertParams).toEqual(['Taxi', 'out', 'c-parent', '🚕', 'user-1'])
  })

  it('PATCH /api/categories/:id refuses a parent below the category', async () => {
    const parentRow = { ...sampleCategory, id: 'c1' }
    const childRow = { ...sampleCategory, id: 'c2', parent_id: 'c1' }
    const db = {
      query: vi
        .fn()
        // existing row, then the proposed parent, then the full list the cycle
        // check walks.
        .mockResolvedValueOnce({ rows: [parentRow] })
        .mockResolvedValueOnce({ rows: [childRow] })
        .mockResolvedValueOnce({ rows: [parentRow, childRow] }),
    }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories/c1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent_id: 'c2' }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('A category cannot be nested under itself')
  })

  it('PATCH /api/categories/:id detaches a child when parent_id is null', async () => {
    const child = { ...sampleCategory, id: 'c2', parent_id: 'c1' }
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [child] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...child, parent_id: null }] }),
    }
    const route = createCategoriesRoute(() => db)
    const response = await requestAsUser(route, '/api/categories/c2', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent_id: null }),
    })
    expect(response.status).toBe(200)
    expect(db.query.mock.calls[1][1]).toEqual(['c2', 'Food', 'out', null, '🍽️', 'user-1'])
  })
})
