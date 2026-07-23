import { describe, it, expect, vi, beforeEach } from 'vitest'

const env = { TELEGRAM_BOT_TOKEN: 'bot' }
vi.mock('../src/config/env.js', () => ({ loadEnv: () => env }))

import { sendMessage, TelegramSendError } from '../src/telegram/client.js'

describe('sendMessage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }))
  })

  it('posts to the Telegram sendMessage endpoint with the given chat id and HTML parse mode', async () => {
    await sendMessage('123', 'hello')
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('/botbot/sendMessage')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.chat_id).toBe('123')
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toBe('hello')
  })

  it('includes reply_to_message_id in the POST body when replyToMessageId is provided', async () => {
    await sendMessage('123', 'hello', { replyToMessageId: 5 })
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.reply_to_message_id).toBe(5)
  })

  it('throws a TelegramSendError carrying the status when the API returns non-ok 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'Forbidden' }),
    )
    const rejection = await sendMessage('123', 'hello').catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(TelegramSendError)
    expect((rejection as TelegramSendError).status).toBe(403)
  })
})
