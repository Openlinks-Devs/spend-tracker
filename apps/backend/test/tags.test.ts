import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createTagsRoute } from '../src/routes/tags.js'
import type { AppVariables } from '../src/http/context.js'

// The guard normally sets userId on the context before the route runs. For these
// unit tests, mount the route under a tiny parent app that sets it.
function requestAsUser(route: Hono<{ Variables: AppVariables }>, path: string) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => {
    context.set('userId', 'user-1')
    await next()
  })
  app.route('/', route)
  return app.request(path)
}

describe('tags route', () => {
  it('GET /api/tags returns distinct tags scoped to the user', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ tag: 'food' }, { tag: 'travel' }] }) }
    const route = createTagsRoute(() => db)
    const response = await requestAsUser(route, '/api/tags')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(['food', 'travel'])
    const [tagsSql, tagsParams] = db.query.mock.calls[0]
    expect(tagsSql).toMatch(/user_id = \$/)
    expect(tagsParams).toEqual(['user-1'])
  })

  it('GET /api/tags returns 500 with a JSON error when the query fails', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) }
    const route = createTagsRoute(() => db)
    const response = await requestAsUser(route, '/api/tags')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to list tags' })
  })
})
