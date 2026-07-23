import { describe, it, expect, vi } from 'vitest'

// Edit-by-reply is disabled until per-user connections land, so the webhook route
// only validates the secret token and then accepts the update as a no-op. Stub
// loadEnv to supply the expected secret, and spy on the pool so we can prove no
// database query runs.
const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }))
vi.mock('../src/db/pool.js', () => ({ getPool: () => ({ query: poolQuery }) }))
vi.mock('../src/config/env.js', () => ({
  loadEnv: () => ({ TELEGRAM_WEBHOOK_SECRET: 'test-secret' }),
}))

import { telegramRoute } from '../src/telegram/webhook.js'

function postWebhook(secret: string | undefined, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (secret !== undefined) headers['X-Telegram-Bot-Api-Secret-Token'] = secret
  return telegramRoute.request('/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('telegram webhook route', () => {
  it('rejects a request with a bad secret token', async () => {
    const response = await postWebhook('wrong-secret', {
      message: { text: '/delete', reply_to_message: { text: 'ID: tx-1' } },
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false })
    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('accepts a valid update as a no-op without touching the database', async () => {
    const response = await postWebhook('test-secret', {
      message: { text: '/delete', reply_to_message: { text: 'ID: tx-1' } },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(poolQuery).not.toHaveBeenCalled()
  })
})
