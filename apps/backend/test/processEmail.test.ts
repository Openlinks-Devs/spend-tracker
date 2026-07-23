import { describe, it, expect, vi } from 'vitest'
import { processEmail } from '../src/pipeline/processEmail.js'

const importContext = { userId: 'user-1', connectionId: 'conn-1' }

// A fake pool whose connect() returns a client backed by one query mock, so we
// can assert the SQL/params the atomic insert runs inside its transaction.
function fakePool() {
  const client = {
    query: vi.fn(async (sql: string) =>
      /insert into transactions/i.test(sql) ? { rows: [{ id: 'tx1' }] } : { rows: [] }),
    release: vi.fn(),
  }
  return { connect: vi.fn().mockResolvedValue(client), client }
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const queryRows: Record<string, unknown[]> = {
    categories: [{ id: 'c1', name: 'Food', type: 'expense' }],
    accounts: [{ id: 'a1', name: 'Debito BCP', type: 'DEBIT', currency: 'PEN' }],
    tags: [{ tag: 'food' }],
    // When non-empty, the message is already imported and must short-circuit.
    importSource: [],
  }
  const db = {
    query: vi.fn(async (sql: string) => {
      if (/from import_source/i.test(sql)) return { rows: queryRows.importSource }
      if (/from categories/i.test(sql)) return { rows: queryRows.categories }
      if (/from accounts/i.test(sql)) return { rows: queryRows.accounts }
      if (/unnest/i.test(sql)) return { rows: queryRows.tags }
      return { rows: [] }
    }),
  }
  const pool = fakePool()
  return {
    queryRows,
    db,
    pool,
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

const sampleEmail = { subject: 'Consumo', text: 'S/ 35.00', messageId: 'msg-1' }

describe('processEmail', () => {
  it('short-circuits before any AI call when the message is already imported', async () => {
    const deps = baseDeps()
    deps.queryRows.importSource = [{ exists: 1 }]
    await processEmail(sampleEmail, importContext, deps as never)
    expect(deps.detect).not.toHaveBeenCalled()
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.pool.connect).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('records the message and skips a non-transaction email', async () => {
    const deps = baseDeps({ detect: vi.fn().mockResolvedValue(false) })
    await processEmail({ subject: 'Oferta', text: 'descuento', messageId: 'msg-2' }, importContext, deps as never)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    const recordCall = deps.db.query.mock.calls.find((call: unknown[]) =>
      /insert into import_source/i.test(call[0] as string))
    expect(recordCall?.[1]).toEqual(['conn-1', 'msg-2', null])
  })

  it('records the message and skips when the user has no accounts', async () => {
    const deps = baseDeps()
    deps.queryRows.accounts = []
    await processEmail(sampleEmail, importContext, deps as never)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.pool.connect).not.toHaveBeenCalled()
    const recordCall = deps.db.query.mock.calls.find((call: unknown[]) =>
      /insert into import_source/i.test(call[0] as string))
    expect(recordCall?.[1]).toEqual(['conn-1', 'msg-1', null])
  })

  it('inserts scoped to the passed user and records the import atomically', async () => {
    const deps = baseDeps()
    await processEmail(sampleEmail, importContext, deps as never)
    const insertCall = deps.pool.client.query.mock.calls.find((call: unknown[]) =>
      /insert into transactions/i.test(call[0] as string))
    expect(insertCall).toBeTruthy()
    expect(insertCall?.[1]).toContain('user-1')
    // The dedupe row is written on the same client, inside the transaction.
    const beginCall = deps.pool.client.query.mock.calls.find((call: unknown[]) => call[0] === 'BEGIN')
    const commitCall = deps.pool.client.query.mock.calls.find((call: unknown[]) => call[0] === 'COMMIT')
    expect(beginCall).toBeTruthy()
    expect(commitCall).toBeTruthy()
    const recordCall = deps.pool.client.query.mock.calls.find((call: unknown[]) =>
      /insert into import_source/i.test(call[0] as string))
    expect(recordCall?.[1]).toEqual(['conn-1', 'msg-1', 'tx1'])
    expect(deps.notify).toHaveBeenCalledOnce()
    expect(deps.notify.mock.calls[0][0] as string).toContain('ID: tx1')
  })

  it('records the message and skips when extraction yields nothing', async () => {
    const deps = baseDeps({ extract: vi.fn().mockResolvedValue(null) })
    await processEmail(sampleEmail, importContext, deps as never)
    expect(deps.pool.connect).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    const recordCall = deps.db.query.mock.calls.find((call: unknown[]) =>
      /insert into import_source/i.test(call[0] as string))
    expect(recordCall?.[1]).toEqual(['conn-1', 'msg-1', null])
  })

  it('keeps the import when the notify call rejects', async () => {
    const deps = baseDeps({ notify: vi.fn().mockRejectedValue(new Error('telegram down')) })
    await expect(processEmail(sampleEmail, importContext, deps as never)).resolves.toBeUndefined()
    const insertCall = deps.pool.client.query.mock.calls.find((call: unknown[]) =>
      /insert into transactions/i.test(call[0] as string))
    expect(insertCall).toBeTruthy()
  })
})
