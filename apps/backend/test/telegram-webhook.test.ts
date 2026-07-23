import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Connection } from '../src/connections/queries.js'
import type { Transaction } from '../src/db/types.js'

vi.mock('../src/config/env.js', () => ({
  loadEnv: () => ({ TELEGRAM_WEBHOOK_SECRET: 'test-secret', TELEGRAM_BOT_TOKEN: 'bot' }),
}))
vi.mock('../src/db/pool.js', () => ({ getPool: () => ({ query: vi.fn() }) }))
vi.mock('../src/connections/queries.js', () => ({
  getTelegramConnectionByChatId: vi.fn(),
  replaceTelegramConnection: vi.fn(),
  setConnectionStatus: vi.fn(),
}))
vi.mock('../src/connections/pairingCodes.js', () => ({ consumePairingCode: vi.fn() }))
vi.mock('../src/db/queries.js', () => ({
  getCategories: vi.fn(),
  getDistinctTags: vi.fn(),
  getTransactionById: vi.fn(),
  deleteTransaction: vi.fn(),
  updateTransaction: vi.fn(),
}))

import {
  getTelegramConnectionByChatId,
  replaceTelegramConnection,
  setConnectionStatus,
} from '../src/connections/queries.js'
import { consumePairingCode } from '../src/connections/pairingCodes.js'
import {
  getCategories,
  getDistinctTags,
  getTransactionById,
  deleteTransaction,
  updateTransaction,
} from '../src/db/queries.js'
import { TelegramSendError } from '../src/telegram/client.js'
import { handleTelegramUpdate, telegramRoute } from '../src/telegram/webhook.js'

function telegramConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    user_id: 'user-1',
    provider: 'telegram',
    status: 'active',
    external_id: '5',
    key_version: null,
    cursor: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function existingTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    description: 'old',
    amount: -10,
    currency: 'PEN',
    account_id: 'a1',
    category_id: 'c0',
    tags: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: null,
    ...overrides,
  }
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    db: { query: vi.fn() },
    classify: vi.fn().mockResolvedValue({ category_id: 'cat-1', tags: ['food'] }),
    notify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleTelegramUpdate', () => {
  it('pairs a chat to its user on /start with a valid code', async () => {
    vi.mocked(consumePairingCode).mockResolvedValue('user-1')
    vi.mocked(getTelegramConnectionByChatId).mockResolvedValue(null)
    vi.mocked(replaceTelegramConnection).mockResolvedValue({ id: 'conn-1' })
    const deps = makeDeps()

    await handleTelegramUpdate({ message: { text: '/start abc123', chat: { id: 999 } } }, deps as never)

    expect(consumePairingCode).toHaveBeenCalledWith(deps.db, 'abc123', 'telegram_pair')
    expect(replaceTelegramConnection).toHaveBeenCalledWith(deps.db, 'user-1', '999')
    expect(deps.notify).toHaveBeenCalledOnce()
    expect(deps.notify.mock.calls[0][0]).toBe('999')
  })

  it('refuses /start when the chat is already paired to another user', async () => {
    vi.mocked(consumePairingCode).mockResolvedValue('user-1')
    vi.mocked(getTelegramConnectionByChatId).mockResolvedValue(
      telegramConnection({ id: 'conn-x', user_id: 'other-user', external_id: '999' }),
    )
    const deps = makeDeps()

    await handleTelegramUpdate({ message: { text: '/start abc123', chat: { id: 999 } } }, deps as never)

    expect(replaceTelegramConnection).not.toHaveBeenCalled()
    expect(deps.notify).toHaveBeenCalledOnce()
    expect(deps.notify.mock.calls[0][1]).toMatch(/otra cuenta/i)
  })

  it('scopes a reply-edit to the paired chat user', async () => {
    vi.mocked(getTelegramConnectionByChatId).mockResolvedValue(
      telegramConnection({ id: 'conn-1', user_id: 'user-1', external_id: '5' }),
    )
    vi.mocked(getTransactionById).mockResolvedValue(existingTransaction())
    vi.mocked(getCategories).mockResolvedValue([{ id: 'cat-1', name: 'Food', type: 'expense' }])
    vi.mocked(getDistinctTags).mockResolvedValue(['food'])
    const deps = makeDeps()

    await handleTelegramUpdate(
      {
        message: {
          text: 'lunch [food]',
          chat: { id: 5 },
          reply_to_message: { text: 'ID: tx-1', message_id: 10 },
        },
      },
      deps as never,
    )

    expect(getTransactionById).toHaveBeenCalledWith(deps.db, 'user-1', 'tx-1')
    expect(vi.mocked(updateTransaction).mock.calls[0][1]).toBe('user-1')
    expect(deps.notify.mock.calls[0][0]).toBe('5')
  })

  it('ignores updates from an unpaired chat without running any query', async () => {
    vi.mocked(getTelegramConnectionByChatId).mockResolvedValue(null)
    const deps = makeDeps()

    await handleTelegramUpdate(
      {
        message: { text: 'lunch', chat: { id: 7 }, reply_to_message: { text: 'ID: tx-1' } },
      },
      deps as never,
    )

    expect(getTransactionById).not.toHaveBeenCalled()
    expect(updateTransaction).not.toHaveBeenCalled()
    expect(deleteTransaction).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('flips the connection to needs_reauth when a notify hits a 403', async () => {
    vi.mocked(getTelegramConnectionByChatId).mockResolvedValue(
      telegramConnection({ id: 'conn-1', user_id: 'user-1', external_id: '5' }),
    )
    const deps = makeDeps({
      notify: vi.fn().mockRejectedValue(new TelegramSendError(403, 'Forbidden')),
    })

    await handleTelegramUpdate(
      {
        message: {
          text: '/delete',
          chat: { id: 5 },
          reply_to_message: { text: 'ID: tx-1', message_id: 10 },
        },
      },
      deps as never,
    )

    expect(deleteTransaction).toHaveBeenCalledWith(deps.db, 'user-1', 'tx-1')
    expect(setConnectionStatus).toHaveBeenCalledWith(deps.db, 'conn-1', 'needs_reauth')
  })
})

describe('telegram webhook route', () => {
  it('rejects a request with a bad secret token', async () => {
    const response = await telegramRoute.request('/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
      body: JSON.stringify({ message: { text: 'hi', chat: { id: 1 } } }),
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false })
  })

  it('accepts a valid update and returns ok', async () => {
    vi.mocked(getTelegramConnectionByChatId).mockResolvedValue(null)
    const response = await telegramRoute.request('/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
      },
      body: JSON.stringify({ message: { text: 'hi', chat: { id: 1 } } }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})
