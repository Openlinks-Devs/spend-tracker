import { describe, it, expect, vi } from 'vitest'
import { createCategoriesRoute } from '../src/routes/categories.js'

const categoryId = '33333333-3333-4333-8333-333333333333'
const missingId = '99999999-9999-4999-8999-999999999999'

const sampleCategory = { id: categoryId, name: 'Food', type: 'expense' }

describe('categories route', () => {
  it('GET /api/categories returns the list', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [sampleCategory] }) }
    const route = createCategoriesRoute(() => db)
    const response = await route.request('/api/categories')
    expect(response.status).toBe(200)
    expect((await response.json())[0].name).toBe('Food')
  })

  it('GET /api/categories/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createCategoriesRoute(() => db)
    const response = await route.request(`/api/categories/${missingId}`)
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
    const response = await route.request('/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Transport', type: 'expense' }),
    })
    expect(response.status).toBe(201)
    expect((await response.json()).id).toBe('c-new')
    expect(db.query.mock.calls[0][0]).toMatch(/insert into categories/i)
  })

  it('POST /api/categories returns 400 on invalid body', async () => {
    const db = { query: vi.fn() }
    const route = createCategoriesRoute(() => db)
    const response = await route.request('/api/categories', {
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
    const response = await route.request(`/api/categories/${categoryId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Groceries' }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).name).toBe('Groceries')
    const [, updateParams] = db.query.mock.calls[1]
    expect(updateParams).toEqual([categoryId, 'Groceries', 'expense'])
  })

  it('DELETE /api/categories/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createCategoriesRoute(() => db)
    const response = await route.request(`/api/categories/${missingId}`, { method: 'DELETE' })
    expect(response.status).toBe(404)
  })

  it('DELETE /api/categories/:id deletes when unreferenced', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleCategory] })
        .mockResolvedValueOnce({ rows: [{ referenced: false }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const route = createCategoriesRoute(() => db)
    const response = await route.request(`/api/categories/${categoryId}`, { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })

  it('DELETE /api/categories/:id returns 409 when transactions reference the category', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [sampleCategory] })
        .mockResolvedValueOnce({ rows: [{ referenced: true }] }),
    }
    const route = createCategoriesRoute(() => db)
    const response = await route.request(`/api/categories/${categoryId}`, { method: 'DELETE' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Category has transactions. Reassign or delete them first.',
    })
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it.each(['GET', 'PATCH', 'DELETE'])('%s /api/categories/:id returns 400 on a malformed id', async (method) => {
    const db = { query: vi.fn() }
    const route = createCategoriesRoute(() => db)
    const response = await route.request('/api/categories/not-a-uuid', {
      method,
      ...(method === 'PATCH'
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) }
        : {}),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid category id' })
    expect(db.query).not.toHaveBeenCalled()
  })
})
