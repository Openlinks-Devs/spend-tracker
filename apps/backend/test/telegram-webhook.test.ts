import { describe, it, expect, vi } from 'vitest'
import { handleTelegramUpdate } from '../src/telegram/webhook.js'

function deps(overrides: Record<string, unknown> = {}) {
  const db = { query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (/from categories/i.test(sql)) return { rows: [{ id: 'c1', name: 'Food', type: 'expense' }] }
    if (/unnest/i.test(sql)) return { rows: [{ tag: 'food' }] }
    if (/select[\s\S]*from transactions/i.test(sql))
      return { rows: [{
        id: 'tx-1', description: 'Almuerzo viejo', amount: -25, currency: 'PEN',
        account_id: 'a1', category_id: 'c1', tags: ['food'],
        created_at: '2026-06-30T10:00:00.000Z', updated_at: null,
      }] }
    return { rows: [] }
  }) }
  return {
    db,
    classify: vi.fn().mockResolvedValue({ category_id: 'c1', tags: ['food'] }),
    notify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const notification = 'Nueva transaccion\nID: tx-1\nAccount: BCP'

describe('handleTelegramUpdate', () => {
  it('deletes on /delete reply', async () => {
    const d = deps()
    await handleTelegramUpdate({ message: {
      text: '/delete', reply_to_message: { text: notification, message_id: 5 },
    } }, d as never)
    const del = d.db.query.mock.calls.find((call: unknown[]) =>
      /delete from transactions/i.test(call[0] as string))
    expect(del?.[1]).toEqual(['tx-1'])
    expect((d.notify.mock.calls[0][0] as string)).toMatch(/eliminada/i)
  })

  it('reclassifies and updates on an edit reply', async () => {
    const d = deps()
    await handleTelegramUpdate({ message: {
      text: 'Almuerzo\n[food]', reply_to_message: { text: notification, message_id: 5 },
    } }, d as never)
    const update = d.db.query.mock.calls.find((call: unknown[]) =>
      /update transactions/i.test(call[0] as string))
    expect(update?.[1]?.[0]).toBe('tx-1')
    expect(d.classify).toHaveBeenCalledOnce()
  })

  it('ignores a message that is not a reply', async () => {
    const d = deps()
    await handleTelegramUpdate({ message: { text: 'hello' } }, d as never)
    expect(d.db.query).not.toHaveBeenCalled()
    expect(d.notify).not.toHaveBeenCalled()
  })
})
