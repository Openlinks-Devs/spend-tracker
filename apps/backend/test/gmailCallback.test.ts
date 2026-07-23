import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGmailCallbackRoute } from '../src/routes/gmailCallback.js'

const consumedState = { rows: [{ user_id: 'user-1' }] }
const emptyRows = { rows: [] }

// loadEnv reads process.env at request time; provide the full schema so the
// callback handler parses env instead of throwing before it can redirect.
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

function exchangeReturning(refreshToken: string | null, email: string | null) {
  return vi.fn().mockResolvedValue({ refreshToken, email })
}

describe('gmail oauth callback', () => {
  it('rejects an unknown or expired state with a redirect to error=link_invalid', async () => {
    const db = { query: vi.fn().mockResolvedValue(emptyRows) }
    const route = createGmailCallbackRoute(() => db, exchangeReturning('rt', 'a@gmail.com'), async () => null)
    const response = await route.request('/connections/gmail/callback?code=x&state=bad')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('error=link_invalid')
  })

  it('rejects when a web session is present for a DIFFERENT user (anti-phishing)', async () => {
    const db = { query: vi.fn().mockResolvedValue(consumedState) }
    const route = createGmailCallbackRoute(
      () => db,
      exchangeReturning('rt', 'a@gmail.com'),
      async () => ({ user: { id: 'attacker-2' } }),
    )
    const response = await route.request('/connections/gmail/callback?code=x&state=ok')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('error=session_mismatch')
  })

  it('redirects to error=no_refresh_token when Google returns none', async () => {
    const db = { query: vi.fn().mockResolvedValue(consumedState) }
    const route = createGmailCallbackRoute(() => db, exchangeReturning(null, 'a@gmail.com'), async () => null)
    const response = await route.request('/connections/gmail/callback?code=x&state=ok')
    expect(response.headers.get('location')).toContain('error=no_refresh_token')
  })

  it('stores an encrypted connection and returns the return-to-app interstitial', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce(consumedState) // consume state
        .mockResolvedValueOnce({ rows: [{ id: 'conn-1' }] }), // upsert
    }
    const route = createGmailCallbackRoute(() => db, exchangeReturning('refresh-tok', 'a@gmail.com'), async () => null)
    const response = await route.request('/connections/gmail/callback?code=x&state=ok')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('/integrations?linked=gmail')
    const upsertParams = db.query.mock.calls[1][1]
    expect(upsertParams[0]).toBe('user-1')
    expect(upsertParams[1]).toBe('a@gmail.com')
    expect(Buffer.isBuffer(upsertParams[2])).toBe(true)
    expect(upsertParams[2].toString('utf8')).not.toContain('refresh-tok')
  })
})
