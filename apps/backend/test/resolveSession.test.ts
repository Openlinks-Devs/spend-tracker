import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveSession } from '../src/auth/resolveSession.js'

describe('resolveSession (mock mode)', () => {
  it('returns a truthy session whose user id equals the x-mock-user header value', async () => {
    const headers = new Headers({ 'x-mock-user': 'alice' })
    const session = (await resolveSession(headers, {
      mode: 'mock',
      getSession: async () => null,
    })) as { user: { id: string; email: string; name: string } }

    expect(session.user.id).toBe('alice')
    expect(session.user.email).toBe('alice@app')
    expect(session.user.name).toBe('Demo')
  })

  it('defaults to demo-user when the x-mock-user header is absent', async () => {
    const headers = new Headers()
    const session = (await resolveSession(headers, {
      mode: 'mock',
      getSession: async () => null,
    })) as { user: { id: string } }

    expect(session.user.id).toBe('demo-user')
  })
})

describe('resolveSession (live mode)', () => {
  it('returns null when the injected getSession resolves to null', async () => {
    const headers = new Headers()
    const session = await resolveSession(headers, {
      mode: 'live',
      getSession: async () => null,
    })

    expect(session).toBeNull()
  })

  it('returns the session from the injected getSession', async () => {
    const headers = new Headers()
    const fakeSession = { user: { id: 'u1' }, session: { id: 's1' } }
    const session = await resolveSession(headers, {
      mode: 'live',
      getSession: async () => fakeSession,
    })

    expect(session).toBe(fakeSession)
  })

  it('passes the request headers through to the injected getSession', async () => {
    const getSession = vi.fn().mockResolvedValue(null)
    const headers = new Headers({ cookie: 'x=1' })
    await resolveSession(headers, { mode: 'live', getSession })

    expect(getSession).toHaveBeenCalledWith(headers)
  })
})

describe('bearer plugin wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('registers the bearer plugin on the auth instance', async () => {
    const requiredEnvVars = {
      DATABASE_URL: 'postgres://localhost/testdb',
      OPENAI_API_KEY: 'sk-test',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost/oauth/callback',
      GOOGLE_REFRESH_TOKEN: 'refresh-token',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: '123456',
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
      TELEGRAM_WEBHOOK_URL: 'https://example.com/telegram/webhook',
      BETTER_AUTH_SECRET: 'test-secret-value-at-least-32-chars-long',
      BETTER_AUTH_URL: 'http://localhost:5173',
    }
    for (const [key, value] of Object.entries(requiredEnvVars)) {
      vi.stubEnv(key, value)
    }

    const { getAuth } = await import('../src/auth.js')
    const auth = getAuth()

    expect(auth.options.plugins?.some((plugin) => plugin.id === 'bearer')).toBe(true)
  })
})
