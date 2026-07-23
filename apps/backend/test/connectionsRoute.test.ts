import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createConnectionsRoute } from '../src/routes/connections.js'
import type { AppVariables } from '../src/http/context.js'

// Route tests inject the userId the session guard would set in production.
function appWithUser(routeFactory: () => Hono, userId = 'user-1'): Hono {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => {
    context.set('userId', userId)
    await next()
  })
  app.route('/', routeFactory())
  return app
}

const baseEnv = {
  APP_MODE: 'live',
  CONNECTION_ENCRYPTION_KEYS: `1:${Buffer.alloc(32).toString('base64')}`,
  TELEGRAM_BOT_USERNAME: 'SpendTrackerBot',
  APP_BASE_URL: 'https://spend.example.com',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://spend.example.com/connections/gmail/callback',
  // Remaining schema-required vars so loadEnv(process.env) parses in this suite.
  DATABASE_URL: 'postgres://localhost/db',
  OPENAI_API_KEY: 'sk-test',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  TELEGRAM_WEBHOOK_URL: 'https://spend.example.com/telegram/webhook',
  BETTER_AUTH_SECRET: 'test-secret-value-at-least-32-chars-long',
  BETTER_AUTH_URL: 'https://spend.example.com',
}

beforeEach(() => {
  for (const [key, value] of Object.entries(baseEnv)) process.env[key] = value
})

describe('connections route', () => {
  it('GET /api/connections lists the user connections', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections')
    expect(response.status).toBe(200)
    expect(db.query.mock.calls[0][1]).toContain('user-1')
  })

  it('POST /api/connections/gmail/link-url returns 402 premium_required at the free limit', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ is_premium: false }] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }),
    }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections/gmail/link-url', { method: 'POST' })
    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({ error: 'premium_required', limit: 1 })
  })

  it('POST /api/connections/gmail/link-url mints a state code and returns a Google URL', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ is_premium: true }] })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections/gmail/link-url', { method: 'POST' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.url).toContain('accounts.google.com')
    expect(body.url).toContain('gmail.readonly')
    expect(body.url).toContain('state=')
  })

  it('POST /api/connections/telegram/pair-code returns the bot deep link', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections/telegram/pair-code', { method: 'POST' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.deepLink).toMatch(/^https:\/\/t\.me\/SpendTrackerBot\?start=[A-Za-z0-9_-]+$/)
  })

  it('returns 503 connections_require_live_mode in mock mode', async () => {
    process.env.APP_MODE = 'mock'
    const db = { query: vi.fn() }
    const app = appWithUser(() => createConnectionsRoute(() => db))
    const response = await app.request('/api/connections')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'connections_require_live_mode' })
    expect(db.query).not.toHaveBeenCalled()
  })
})
