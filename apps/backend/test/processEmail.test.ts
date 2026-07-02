import { describe, it, expect, vi } from 'vitest'
import { processEmail } from '../src/pipeline/processEmail.js'

function baseDeps(overrides: Record<string, unknown> = {}) {
  const queryRows: Record<string, unknown[]> = {
    categories: [{ id: 'c1', name: 'Food', type: 'expense' }],
    accounts: [{ id: 'a1', name: 'Debito BCP', type: 'DEBIT', currency: 'PEN' }],
    tags: [{ tag: 'food' }],
    insert: [{ id: 'tx1' }],
  }
  const db = {
    query: vi.fn(async (sql: string) => {
      if (/from categories/i.test(sql)) return { rows: queryRows.categories }
      if (/from accounts/i.test(sql)) return { rows: queryRows.accounts }
      if (/unnest/i.test(sql)) return { rows: queryRows.tags }
      if (/insert into transactions/i.test(sql)) return { rows: queryRows.insert }
      return { rows: [] }
    }),
  }
  return {
    db,
    now: () => '2026-06-30T10:00:00.000Z',
    detect: vi.fn().mockResolvedValue(true),
    extract: vi.fn().mockResolvedValue({
      description: 'PLIN', amount: -35, currency: 'PEN',
      account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
      created_at: '2026-06-29T20:55:00.000Z',
    }),
    notify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('processEmail', () => {
  it('skips non-transaction email', async () => {
    const deps = baseDeps({ detect: vi.fn().mockResolvedValue(false) })
    await processEmail({ subject: 'Oferta', text: 'descuento' }, deps as never)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('inserts and notifies for a valid transaction', async () => {
    const deps = baseDeps()
    await processEmail({ subject: 'Consumo', text: 'S/ 35.00' }, deps as never)
    const insertCall = deps.db.query.mock.calls.find((call: unknown[]) =>
      /insert into transactions/i.test(call[0] as string))
    expect(insertCall).toBeTruthy()
    expect(deps.notify).toHaveBeenCalledOnce()
    expect((deps.notify.mock.calls[0][0] as string)).toContain('ID: tx1')
  })

  it('sends an error notification when extraction yields no account', async () => {
    const deps = baseDeps({ extract: vi.fn().mockResolvedValue(null) })
    await processEmail({ subject: 'Consumo', text: 'raro' }, deps as never)
    const insertCall = deps.db.query.mock.calls.find((call: unknown[]) =>
      /insert into transactions/i.test(call[0] as string))
    expect(insertCall).toBeUndefined()
    expect((deps.notify.mock.calls[0][0] as string)).toMatch(/Error/i)
  })
})
