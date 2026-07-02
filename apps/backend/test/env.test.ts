import { describe, it, expect } from 'vitest'
import { loadEnv } from '../src/config/env.js'

const complete = {
  DATABASE_URL: 'postgres://localhost/db',
  OPENAI_API_KEY: 'sk-test',
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REDIRECT_URI: 'http://localhost/cb',
  GOOGLE_REFRESH_TOKEN: 'refresh',
  TELEGRAM_BOT_TOKEN: 'bot',
  TELEGRAM_CHAT_ID: '123',
  TELEGRAM_WEBHOOK_SECRET: 'whsecret',
  TELEGRAM_WEBHOOK_URL: 'https://example.com/telegram/webhook',
}

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    const env = loadEnv(complete)
    expect(env.OPENAI_MODEL).toBe('gpt-5-mini')
    expect(env.GMAIL_POLL_INTERVAL_MS).toBe(60000)
    expect(env.PORT).toBe(3000)
  })

  it('throws when a required value is missing', () => {
    const { DATABASE_URL, ...incomplete } = complete
    expect(() => loadEnv(incomplete)).toThrow(/DATABASE_URL/)
  })
})
