import { describe, it, expect, vi, beforeEach } from 'vitest'

const env = {
  TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_CHAT_ID: '123',
}
vi.mock('../src/config/env.js', () => ({ loadEnv: () => env }))

import { sendMessage } from '../src/telegram/client.js'

describe('sendMessage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }))
  })

  it('posts to the Telegram sendMessage endpoint with HTML parse mode', async () => {
    await sendMessage('hello')
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('/botbot/sendMessage')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.chat_id).toBe('123')
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toBe('hello')
  })
})
