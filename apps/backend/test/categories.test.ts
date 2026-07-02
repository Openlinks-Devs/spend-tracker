import { describe, it, expect, vi } from 'vitest'
import { createCategoriesRoute } from '../src/routes/categories.js'

const sampleCategory = { id: 'c1', name: 'Food', type: 'expense' }

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
    const response = await route.request('/api/categories/nope')
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
    const response = await route.request('/api/categories/c1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Groceries' }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).name).toBe('Groceries')
    const [, updateParams] = db.query.mock.calls[1]
    expect(updateParams).toEqual(['c1', 'Groceries', 'expense'])
  })

  it('DELETE /api/categories/:id returns 404 when missing', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const route = createCategoriesRoute(() => db)
    const response = await route.request('/api/categories/nope', { method: 'DELETE' })
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
    const response = await route.request('/api/categories/c1', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })
})
