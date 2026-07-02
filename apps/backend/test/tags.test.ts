import { describe, it, expect, vi } from 'vitest'
import { createTagsRoute } from '../src/routes/tags.js'

describe('tags route', () => {
  it('GET /api/tags returns distinct tags', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ tag: 'food' }, { tag: 'travel' }] }) }
    const route = createTagsRoute(() => db)
    const response = await route.request('/api/tags')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(['food', 'travel'])
  })

  it('GET /api/tags returns 500 with a JSON error when the query fails', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) }
    const route = createTagsRoute(() => db)
    const response = await route.request('/api/tags')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to list tags' })
  })
})
