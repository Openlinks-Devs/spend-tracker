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

  it('includes reply_to_message_id in the POST body when replyToMessageId is provided', async () => {
    await sendMessage('hello', { replyToMessageId: 5 })
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.reply_to_message_id).toBe(5)
  })

  it('throws when the Telegram API returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }))
    await expect(sendMessage('hello')).rejects.toThrow('400')
  })
})
