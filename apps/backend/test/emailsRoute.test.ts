import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createEmailsRoute } from '../src/routes/emails.js'
import type { RetryEmailDeps } from '../src/connections/retryEmail.js'
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

// The retry endpoint's dependencies are injected whole, so these tests drive
// the route's status mapping without reaching for Gmail or the AI pipeline.
function retryDeps(rows: Record<string, unknown>[]): RetryEmailDeps {
  const emailLogRow = {
    message_id: 'msg-1',
    connection_id: 'conn-1',
    account_email: 'a@gmail.com',
    sender: 'Bank <no-reply@bank.com>',
    subject: 'Consumo',
    email_date: '2026-08-01T10:00:00.000Z',
    received_at: '2026-08-01T10:00:05.000Z',
    verdict: 'imported',
    attempts: 2,
    transaction_id: 'tx-1',
    transaction_description: 'PLIN',
    transaction_amount: -35,
    transaction_currency: 'PEN',
  }
  return {
    db: {
      query: vi.fn(async (sql: string) =>
        /connection.secret_encrypted/.test(sql) ? { rows } : { rows: [emailLogRow] },
      ),
    } as unknown as RetryEmailDeps['db'],
    keys: [{ version: 1, key: Buffer.alloc(32) }],
    buildGmail: vi.fn(() => ({}) as never),
    fetchMessage: vi.fn(async () => ({ id: 'msg-1' })),
    parseMessage: vi.fn(() => ({
      subject: 'Consumo',
      text: 'Consumo de S/ 35.00',
      sender: null,
      internalDateSeconds: '1787000000',
    })),
    importEmail: vi.fn(async () => {}),
  }
}

describe('emails retry route', () => {
  const retryPath = '/api/emails/conn-1/msg-1/retry'

  it('answers the refreshed row on a successful retry', async () => {
    const deps = retryDeps([
      {
        verdict: 'failed',
        connection_provider: 'gmail',
        connection_status: 'active',
        connection_external_id: 'a@gmail.com',
        connection_key_version: 1,
        connection_secret: Buffer.alloc(40),
      },
    ])
    // The real decrypt would reject the placeholder ciphertext, so the whole
    // retry is stubbed here: this test is about the route's success envelope.
    const app = appWithUser(() =>
      createEmailsRoute(
        () => ({ query: vi.fn() }),
        () => deps,
      ),
    )
    vi.spyOn(await import('../src/connections/retryEmail.js'), 'retryEmail').mockResolvedValue({
      ok: true,
      email: {
        message_id: 'msg-1',
        connection_id: 'conn-1',
        account_email: 'a@gmail.com',
        sender: null,
        subject: 'Consumo',
        email_date: null,
        received_at: '2026-08-01T10:00:05.000Z',
        verdict: 'imported',
        attempts: 3,
        transaction: { id: 'tx-1', description: 'PLIN', amount: -35, currency: 'PEN' },
      },
    })

    const response = await app.request(retryPath, { method: 'POST' })

    expect(response.status).toBe(200)
    expect((await response.json()).email).toMatchObject({ message_id: 'msg-1', verdict: 'imported' })
    vi.restoreAllMocks()
  })

  it('answers 404 when the message does not belong to the session user', async () => {
    const deps = retryDeps([])
    const app = appWithUser(() => createEmailsRoute(() => ({ query: vi.fn() }), () => deps))
    const response = await app.request(retryPath, { method: 'POST' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'email_not_found' })
  })

  it('answers 409 for a verdict that must not be retried', async () => {
    const deps = retryDeps([
      {
        verdict: 'imported',
        connection_provider: 'gmail',
        connection_status: 'active',
        connection_external_id: 'a@gmail.com',
        connection_key_version: 1,
        connection_secret: Buffer.alloc(40),
      },
    ])
    const app = appWithUser(() => createEmailsRoute(() => ({ query: vi.fn() }), () => deps))
    const response = await app.request(retryPath, { method: 'POST' })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'verdict_not_retryable' })
  })

  it('answers 409 connection_needs_reauth when the connection is parked', async () => {
    const deps = retryDeps([
      {
        verdict: 'failed',
        connection_provider: 'gmail',
        connection_status: 'needs_reauth',
        connection_external_id: 'a@gmail.com',
        connection_key_version: 1,
        connection_secret: null,
      },
    ])
    const app = appWithUser(() => createEmailsRoute(() => ({ query: vi.fn() }), () => deps))
    const response = await app.request(retryPath, { method: 'POST' })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'connection_needs_reauth' })
  })

  it('returns 503 in mock mode without touching the pipeline', async () => {
    process.env.APP_MODE = 'mock'
    const deps = retryDeps([])
    const app = appWithUser(() => createEmailsRoute(() => ({ query: vi.fn() }), () => deps))
    const response = await app.request(retryPath, { method: 'POST' })

    expect(response.status).toBe(503)
    expect(deps.fetchMessage).not.toHaveBeenCalled()
  })

  it('answers 500 when the pipeline throws', async () => {
    const deps = retryDeps([
      {
        verdict: 'failed',
        connection_provider: 'gmail',
        connection_status: 'active',
        connection_external_id: 'a@gmail.com',
        connection_key_version: 1,
        connection_secret: Buffer.alloc(40),
      },
    ])
    const app = appWithUser(() => createEmailsRoute(() => ({ query: vi.fn() }), () => deps))
    const response = await app.request(retryPath, { method: 'POST' })

    // Buffer.alloc(40) is not a real ciphertext, so decryptSecret throws: the
    // route has to turn that into a 500 rather than an unhandled rejection.
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'retry_failed' })
  })
})
