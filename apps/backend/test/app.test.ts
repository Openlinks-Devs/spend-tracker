import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApp } from '../src/app.js'

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

describe('app wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects telegram webhook without the secret header', async () => {
    for (const [key, value] of Object.entries(requiredEnvVars)) {
      vi.stubEnv(key, value)
    }
    const app = buildApp()
    const response = await app.request('/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: { text: 'hi' } }),
    })
    expect(response.status).toBe(401)
  })

  it('rejects telegram webhook with wrong secret header', async () => {
    for (const [key, value] of Object.entries(requiredEnvVars)) {
      vi.stubEnv(key, value)
    }
    const app = buildApp()
    const response = await app.request('/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wrong-secret',
      },
      body: JSON.stringify({ message: { text: 'hi' } }),
    })
    expect(response.status).toBe(401)
  })
})

describe('session gating (default-deny)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 on a data route when there is no session', async () => {
    for (const [key, value] of Object.entries(requiredEnvVars)) {
      vi.stubEnv(key, value)
    }
    const app = buildApp(async () => null)
    const response = await app.request('/api/transactions')
    expect(response.status).toBe(401)
  })

  it('does not return 401 on a data route when a session is present', async () => {
    for (const [key, value] of Object.entries(requiredEnvVars)) {
      vi.stubEnv(key, value)
    }
    const app = buildApp(async () => ({ session: {}, user: {} }))
    const response = await app.request('/api/transactions')
    // The guard passed; the route itself may still fail (no real DB in this
    // test), but that failure must not be a 401.
    expect(response.status).not.toBe(401)
  })

  it('never gates /api/auth/* even when the injected resolver denies the session', async () => {
    for (const [key, value] of Object.entries(requiredEnvVars)) {
      vi.stubEnv(key, value)
    }
    const app = buildApp(async () => null)
    const response = await app.request('/api/auth/anything')
    expect(response.status).not.toBe(401)
  })
})
