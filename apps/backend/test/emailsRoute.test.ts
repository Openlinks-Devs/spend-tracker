import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createEmailsRoute } from '../src/routes/emails.js'
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

function emailLogDb() {
  return {
    query: vi.fn(async (sql: string) =>
      /count\(\*\)/.test(sql)
        ? { rows: [{ count: 1 }] }
        : {
            rows: [
              {
                message_id: 'msg-1',
                connection_id: 'conn-1',
                account_email: 'a@gmail.com',
                sender: 'Bank <no-reply@bank.com>',
                subject: 'Consumo',
                email_date: '2026-08-01T10:00:00.000Z',
                received_at: '2026-08-01T10:00:05.000Z',
                verdict: 'imported',
                attempts: 1,
                transaction_id: 'tx-1',
                transaction_description: 'PLIN',
                transaction_amount: -35,
                transaction_currency: 'PEN',
              },
            ],
          }),
  }
}

// Every schema-required var, so loadEnv(process.env) parses in this suite.
const baseEnv = {
  APP_MODE: 'live',
  CONNECTION_ENCRYPTION_KEYS: `1:${Buffer.alloc(32).toString('base64')}`,
  TELEGRAM_BOT_USERNAME: 'SpendTrackerBot',
  APP_BASE_URL: 'https://spend.example.com',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://spend.example.com/connections/gmail/callback',
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

describe('emails route', () => {
  it('GET /api/emails returns the paginated shape scoped to the session user', async () => {
    const db = emailLogDb()
    const app = appWithUser(() => createEmailsRoute(() => db))
    const response = await app.request('/api/emails')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      items: [
        {
          message_id: 'msg-1',
          connection_id: 'conn-1',
          account_email: 'a@gmail.com',
          sender: 'Bank <no-reply@bank.com>',
          subject: 'Consumo',
          email_date: '2026-08-01T10:00:00.000Z',
          received_at: '2026-08-01T10:00:05.000Z',
          verdict: 'imported',
          attempts: 1,
          transaction: { id: 'tx-1', description: 'PLIN', amount: -35, currency: 'PEN' },
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    })
    expect(db.query.mock.calls[0][1]).toEqual(['user-1', 50, 0])
  })

  it('never reads another user emails', async () => {
    const db = emailLogDb()
    const app = appWithUser(() => createEmailsRoute(() => db), 'user-2')
    await app.request('/api/emails?limit=10&offset=20')
    for (const [, params] of db.query.mock.calls) {
      expect((params as unknown[])[0]).toBe('user-2')
    }
    expect(db.query.mock.calls[0][1]).toEqual(['user-2', 10, 20])
  })

  it('caps the limit at 200', async () => {
    const db = emailLogDb()
    const app = appWithUser(() => createEmailsRoute(() => db))
    const response = await app.request('/api/emails?limit=1000')
    expect((await response.json()).limit).toBe(200)
    expect(db.query.mock.calls[0][1]).toEqual(['user-1', 200, 0])
  })

  it('returns 503 connections_require_live_mode in mock mode', async () => {
    process.env.APP_MODE = 'mock'
    const db = { query: vi.fn() }
    const app = appWithUser(() => createEmailsRoute(() => db))
    const response = await app.request('/api/emails')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'connections_require_live_mode' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('answers 500 when the query fails', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('connection reset')) }
    const app = appWithUser(() => createEmailsRoute(() => db))
    const response = await app.request('/api/emails')
    expect(response.status).toBe(500)
  })
})
