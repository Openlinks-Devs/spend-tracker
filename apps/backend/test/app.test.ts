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
