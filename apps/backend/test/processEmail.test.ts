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
    // When non-empty, the message already has a row and must short-circuit.
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

const sampleEmail = {
  subject: 'Consumo',
  text: 'S/ 35.00',
  messageId: 'msg-1',
  sender: 'Banco BCP <no-reply@bcp.com.pe>',
  emailDateSeconds: '1690000100',
}

// The recorded row: [connectionId, messageId, transactionId, sender, subject,
// emailDateSeconds, verdict].
function recordedParams(queryMock: { mock: { calls: unknown[][] } }): unknown[] | undefined {
  const call = queryMock.mock.calls.find((candidate) =>
    /insert into import_source/i.test(candidate[0] as string))
  return call?.[1] as unknown[] | undefined
}

describe('processEmail', () => {
  it('short-circuits before any AI call when the message already has a row', async () => {
    const deps = baseDeps()
    deps.queryRows.importSource = [{ verdict: 'imported', attempts: 1 }]
    await processEmail(sampleEmail, importContext, deps as never)
    expect(deps.detect).not.toHaveBeenCalled()
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.pool.connect).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(recordedParams(deps.db.query)).toBeUndefined()
  })

  it('retries a failed row that still has attempts left', async () => {
    const deps = baseDeps()
    deps.queryRows.importSource = [{ verdict: 'failed', attempts: 1 }]
    await processEmail(sampleEmail, importContext, deps as never)
    expect(deps.detect).toHaveBeenCalledOnce()
  })

  it('records verdict not_transaction for an email the detector rejects', async () => {
    const deps = baseDeps({ detect: vi.fn().mockResolvedValue(false) })
    await processEmail(
      { ...sampleEmail, subject: 'Oferta', text: 'descuento', messageId: 'msg-2' },
      importContext,
      deps as never,
    )
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(recordedParams(deps.db.query)).toEqual([
      'conn-1', 'msg-2', null, 'Banco BCP <no-reply@bcp.com.pe>', 'Oferta', '1690000100', 'not_transaction',
    ])
  })

  it('records verdict not_configured when the user has no accounts', async () => {
    const deps = baseDeps()
    deps.queryRows.accounts = []
    await processEmail(sampleEmail, importContext, deps as never)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.pool.connect).not.toHaveBeenCalled()
    expect(recordedParams(deps.db.query)?.at(-1)).toBe('not_configured')
  })

  it('records verdict not_configured when the user has no categories', async () => {
    const deps = baseDeps()
    deps.queryRows.categories = []
    await processEmail(sampleEmail, importContext, deps as never)
    expect(recordedParams(deps.db.query)?.at(-1)).toBe('not_configured')
  })

  it('records verdict extract_failed when extraction yields nothing', async () => {
    const deps = baseDeps({ extract: vi.fn().mockResolvedValue(null) })
    await processEmail(sampleEmail, importContext, deps as never)
    expect(deps.pool.connect).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(recordedParams(deps.db.query)?.at(-1)).toBe('extract_failed')
  })

  it('records verdict imported atomically with the transaction insert', async () => {
    const deps = baseDeps()
    await processEmail(sampleEmail, importContext, deps as never)
    const insertCall = deps.pool.client.query.mock.calls.find((call: unknown[]) =>
      /insert into transactions/i.test(call[0] as string))
    expect(insertCall).toBeTruthy()
    expect(insertCall?.[1]).toContain('user-1')
    // The log row is written on the same client, inside the transaction.
    const beginCall = deps.pool.client.query.mock.calls.find((call: unknown[]) => call[0] === 'BEGIN')
    const commitCall = deps.pool.client.query.mock.calls.find((call: unknown[]) => call[0] === 'COMMIT')
    expect(beginCall).toBeTruthy()
    expect(commitCall).toBeTruthy()
    expect(recordedParams(deps.pool.client.query)).toEqual([
      'conn-1', 'msg-1', 'tx1', 'Banco BCP <no-reply@bcp.com.pe>', 'Consumo', '1690000100', 'imported',
    ])
    expect(deps.notify).toHaveBeenCalledOnce()
    expect(deps.notify.mock.calls[0][0] as string).toContain('ID: tx1')
  })

  it('records verdict failed and rethrows when processing throws', async () => {
    const deps = baseDeps({ extract: vi.fn().mockRejectedValue(new Error('provider is down')) })
    await expect(processEmail(sampleEmail, importContext, deps as never)).rejects.toThrow(
      'provider is down',
    )
    expect(recordedParams(deps.db.query)?.at(-1)).toBe('failed')
  })

  it('rethrows the original error even when recording the failure also fails', async () => {
    const deps = baseDeps({ extract: vi.fn().mockRejectedValue(new Error('provider is down')) })
    deps.db.query = vi.fn(async (sql: string) => {
      if (/insert into import_source/i.test(sql)) throw new Error('database is down')
      if (/from import_source/i.test(sql)) return { rows: [] }
      if (/from categories/i.test(sql)) return { rows: [{ id: 'c1', name: 'Food', type: 'expense' }] }
      if (/from accounts/i.test(sql)) return { rows: [{ id: 'a1', name: 'BCP', type: 'DEBIT', currency: 'PEN' }] }
      return { rows: [] }
    })
    await expect(processEmail(sampleEmail, importContext, deps as never)).rejects.toThrow(
      'provider is down',
    )
  })

  it('keeps the import when the notify call rejects', async () => {
    const deps = baseDeps({ notify: vi.fn().mockRejectedValue(new Error('telegram down')) })
    await expect(processEmail(sampleEmail, importContext, deps as never)).resolves.toBeUndefined()
    const insertCall = deps.pool.client.query.mock.calls.find((call: unknown[]) =>
      /insert into transactions/i.test(call[0] as string))
    expect(insertCall).toBeTruthy()
  })
})

describe('processEmail force', () => {
  it('skips a message that already has a terminal row when not forced', async () => {
    const deps = baseDeps()
    deps.queryRows.importSource = [{ verdict: 'extract_failed', attempts: 1 }]
    await processEmail(sampleEmail, importContext, deps as never)

    expect(deps.detect).not.toHaveBeenCalled()
  })

  it('processes that same message when the user forces a retry', async () => {
    const deps = baseDeps()
    deps.queryRows.importSource = [{ verdict: 'extract_failed', attempts: 1 }]
    await processEmail(sampleEmail, { ...importContext, force: true }, deps as never)

    expect(deps.detect).toHaveBeenCalled()
    expect(deps.extract).toHaveBeenCalled()
  })

  it('forces past a failed row that already spent its automatic attempts', async () => {
    const deps = baseDeps()
    deps.queryRows.importSource = [{ verdict: 'failed', attempts: 3 }]
    await processEmail(sampleEmail, { ...importContext, force: true }, deps as never)

    expect(deps.detect).toHaveBeenCalled()
  })
})
