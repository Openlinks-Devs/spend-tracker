import { describe, it, expect, vi } from 'vitest'
import { notifyImportFailures } from '../src/connections/notifyImportFailures.js'
import { TelegramSendError } from '../src/telegram/client.js'

const failures = [
  { sender: 'Banco BCP <no-reply@bcp.com.pe>', subject: 'Consumo' },
  { sender: 'Interbank <alertas@interbank.pe>', subject: 'Compra' },
]

function telegramRow(rows: unknown[]) {
  return vi.fn(async (sql: string) =>
    /provider = 'telegram'/.test(sql) ? { rows } : { rows: [] })
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    db: { query: telegramRow([{ id: 'tg-1', user_id: 'user-1', external_id: '5551234' }]) },
    sendMessage: vi.fn().mockResolvedValue(undefined),
    inboxUrl: 'https://spendtracker.openlinks.app/inbox',
    ...overrides,
  }
}

describe('notifyImportFailures', () => {
  it('sends one message naming the first failure and the total', async () => {
    const deps = baseDeps()
    await notifyImportFailures(deps as never, 'user-1', failures)
    expect(deps.sendMessage).toHaveBeenCalledTimes(1)
    const [chatId, text] = deps.sendMessage.mock.calls[0]
    expect(chatId).toBe('5551234')
    expect(text).toContain('Banco BCP')
    expect(text).toContain('2 emails')
    expect(text).toContain('https://spendtracker.openlinks.app/inbox')
  })

  it('sends nothing when there are no failures', async () => {
    const deps = baseDeps()
    await notifyImportFailures(deps as never, 'user-1', [])
    expect(deps.sendMessage).not.toHaveBeenCalled()
    expect(deps.db.query).not.toHaveBeenCalled()
  })

  it('sends nothing when the user has no telegram connection', async () => {
    const deps = baseDeps({ db: { query: telegramRow([]) } })
    await notifyImportFailures(deps as never, 'user-1', failures)
    expect(deps.sendMessage).not.toHaveBeenCalled()
  })

  it('marks the telegram connection needs_reauth when the bot is blocked', async () => {
    const deps = baseDeps({
      sendMessage: vi.fn().mockRejectedValue(new TelegramSendError(403, 'bot was blocked by the user')),
    })
    await notifyImportFailures(deps as never, 'user-1', failures)
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['tg-1', 'needs_reauth'])
  })

  it('swallows other send failures and leaves the telegram connection alone', async () => {
    const deps = baseDeps({
      sendMessage: vi.fn().mockRejectedValue(new TelegramSendError(500, 'internal server error')),
    })
    await expect(notifyImportFailures(deps as never, 'user-1', failures)).resolves.toBeUndefined()
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall).toBeUndefined()
  })

  it('swallows a database failure', async () => {
    const deps = baseDeps({ db: { query: vi.fn().mockRejectedValue(new Error('connection reset')) } })
    await expect(notifyImportFailures(deps as never, 'user-1', failures)).resolves.toBeUndefined()
    expect(deps.sendMessage).not.toHaveBeenCalled()
  })
})
