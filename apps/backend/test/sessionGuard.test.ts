import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createSessionGuard } from '../src/auth/sessionGuard.js'

function appWith(getSession: () => Promise<unknown>) {
  const app = new Hono()
  app.use('/api/data', createSessionGuard(getSession))
  app.get('/api/data', (context) => context.json({ ok: true }))
  return app
}

describe('sessionGuard', () => {
  it('returns 401 when there is no session', async () => {
    const response = await appWith(async () => null).request('/api/data')
    expect(response.status).toBe(401)
  })
  it('calls next when a session exists', async () => {
    const response = await appWith(async () => ({ session: { id: 's1' }, user: { id: 'u1' } })).request(
      '/api/data',
    )
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
  })
  it('passes the request headers to getSession', async () => {
    const getSession = vi.fn().mockResolvedValue({ session: {} })
    await appWith(getSession).request('/api/data', { headers: { cookie: 'x=1' } })
    expect(getSession).toHaveBeenCalledWith(expect.any(Headers))
  })
})
