import { describe, it, expect, vi } from 'vitest'
import { notifyGmailConnectionLost } from '../src/connections/notifyConnectionLost.js'
import { TelegramSendError } from '../src/telegram/client.js'

const brokenConnection = { user_id: 'user-1', external_id: 'broken@gmail.com' }

function telegramRow(rows: unknown[]) {
  return vi.fn(async (sql: string) =>
    /provider = 'telegram'/.test(sql) ? { rows } : { rows: [] })
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    db: { query: telegramRow([{ id: 'tg-1', user_id: 'user-1', external_id: '5551234' }]) },
    sendMessage: vi.fn().mockResolvedValue(undefined),
    integrationsUrl: 'https://spendtracker.openlinks.app/integrations',
    ...overrides,
  }
}

describe('notifyGmailConnectionLost', () => {
  it('sends the alert to the user telegram chat', async () => {
    const deps = baseDeps()
    await notifyGmailConnectionLost(deps as never, brokenConnection)
    expect(deps.sendMessage).toHaveBeenCalledTimes(1)
    const [chatId, text] = deps.sendMessage.mock.calls[0]
    expect(chatId).toBe('5551234')
    expect(text).toContain('broken@gmail.com')
    expect(text).toContain('https://spendtracker.openlinks.app/integrations')
  })

  it('sends nothing when the user has no telegram connection', async () => {
    const deps = baseDeps({ db: { query: telegramRow([]) } })
    await notifyGmailConnectionLost(deps as never, brokenConnection)
    expect(deps.sendMessage).not.toHaveBeenCalled()
  })

  it('marks the telegram connection needs_reauth when the bot is blocked', async () => {
    const deps = baseDeps({
      sendMessage: vi.fn().mockRejectedValue(new TelegramSendError(403, 'bot was blocked by the user')),
    })
    await notifyGmailConnectionLost(deps as never, brokenConnection)
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['tg-1', 'needs_reauth'])
  })

  it('swallows other send failures and leaves the telegram connection alone', async () => {
    const deps = baseDeps({
      sendMessage: vi.fn().mockRejectedValue(new TelegramSendError(500, 'internal server error')),
    })
    await expect(notifyGmailConnectionLost(deps as never, brokenConnection)).resolves.toBeUndefined()
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall).toBeUndefined()
  })

  it('swallows a database failure', async () => {
    const deps = baseDeps({ db: { query: vi.fn().mockRejectedValue(new Error('connection reset')) } })
    await expect(notifyGmailConnectionLost(deps as never, brokenConnection)).resolves.toBeUndefined()
    expect(deps.sendMessage).not.toHaveBeenCalled()
  })
})
