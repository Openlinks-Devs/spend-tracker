import { describe, it, expect, vi } from 'vitest'
import { processEmail } from '../src/pipeline/processEmail.js'

interface QueryRows {
  categories: unknown[]
  accounts: unknown[]
  tags: unknown[]
  insert: unknown[]
  currencies: { code: string }[]
  existingByExternalId: unknown[]
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const queryRows: QueryRows = {
    categories: [{ id: 'c1', name: 'Food', type: 'expense' }],
    accounts: [{ id: 'a1', name: 'Debito BCP', type: 'DEBIT', currency: 'PEN' }],
    tags: [{ tag: 'food' }],
    insert: [{ id: 'tx1' }],
    currencies: [
      { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', decimal_places: 2 } as never,
      { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 } as never,
    ],
    existingByExternalId: [],
  }
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // Checked before the external_id lookup below: the insert statement's
      // own column list contains the substring "external_id", so a generic
      // /external_id/i test would misfire on it and never return the
      // inserted row.
      if (/insert into transactions/i.test(sql)) return { rows: queryRows.insert }
      if (/where external_id/i.test(sql)) return { rows: queryRows.existingByExternalId }
      if (/from categories/i.test(sql)) return { rows: queryRows.categories }
      if (/from accounts/i.test(sql)) return { rows: queryRows.accounts }
      if (/unnest/i.test(sql)) return { rows: queryRows.tags }
      if (/from currencies/i.test(sql)) {
        const code = String(params?.[0])
        return { rows: queryRows.currencies.filter((currency) => currency.code === code) }
      }
      return { rows: [] }
    }),
  }
  return {
    db,
    queryRows,
    now: () => '2026-06-30T10:00:00.000Z',
    detect: vi.fn().mockResolvedValue(true),
    extract: vi.fn().mockResolvedValue({
      description: 'PLIN', amount: -35, currency: 'PEN',
      account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
      payee: 'Marisela Calle', occurred_at: '2026-06-29T20:55:00.000Z',
    }),
    notify: vi.fn().mockResolvedValue(undefined),
    convert: vi.fn().mockResolvedValue({ convertedAmount: -35, rateUsed: 1 }),
    backfill: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

const email = { subject: 'Consumo', text: 'S/ 35.00', messageId: 'gmail-1' }

function findInsertParams(deps: ReturnType<typeof baseDeps>): unknown[] | undefined {
  const insertCall = deps.db.query.mock.calls.find((call: unknown[]) =>
    /insert into transactions/i.test(call[0] as string))
  return insertCall?.[1] as unknown[] | undefined
}

describe('processEmail', () => {
  it('skips non-transaction email', async () => {
    const deps = baseDeps({ detect: vi.fn().mockResolvedValue(false) })
    await processEmail({ ...email, subject: 'Oferta', text: 'descuento' }, deps as never)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('inserts with type, payee, occurred_at, external_id, and conversion', async () => {
    const deps = baseDeps()
    await processEmail(email, deps as never)
    const params = findInsertParams(deps)
    expect(params).toBeTruthy()
    expect(params?.[1]).toBe(-35)
    expect(params?.[2]).toBe('PEN')
    expect(params?.[6]).toBe('expense')
    expect(params?.[7]).toBe('Marisela Calle')
    expect(params?.[9]).toBe('2026-06-29T20:55:00.000Z')
    expect(params?.[10]).toBe(-35)
    expect(params?.[11]).toBe(1)
    expect(params?.[14]).toBe('gmail-1')
    expect(deps.notify).toHaveBeenCalledOnce()
    expect(deps.notify.mock.calls[0][0] as string).toContain('ID: tx1')
  })

  it('skips silently when the external_id already exists', async () => {
    const deps = baseDeps()
    deps.queryRows.existingByExternalId = [{ id: 'tx-old', external_id: 'gmail-1' }]
    await processEmail(email, deps as never)
    expect(deps.detect).not.toHaveBeenCalled()
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(findInsertParams(deps)).toBeUndefined()
  })

  it('derives income from a positive amount', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'Abono', amount: 1200, currency: 'PEN',
        account_id: 'a1', category_id: 'c1', tags: ['salary', 'bank', 'monthly'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      }),
      convert: vi.fn().mockResolvedValue({ convertedAmount: 1200, rateUsed: 1 }),
    })
    await processEmail(email, deps as never)
    expect(findInsertParams(deps)?.[6]).toBe('income')
  })

  it('normalizes the extracted currency to an uppercase trimmed code', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'PLIN', amount: -35, currency: ' pen ',
        account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      }),
    })
    await processEmail(email, deps as never)
    const currencyLookup = deps.db.query.mock.calls.find((call: unknown[]) =>
      /from currencies/i.test(call[0] as string))
    expect(currencyLookup?.[1]).toEqual(['PEN'])
    expect(findInsertParams(deps)?.[2]).toBe('PEN')
  })

  it('rejects an unknown currency through the telegram error path', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'PLIN', amount: -35, currency: 'XYZ',
        account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      }),
    })
    await processEmail(email, deps as never)
    expect(findInsertParams(deps)).toBeUndefined()
    expect(deps.notify).toHaveBeenCalledOnce()
    expect(deps.notify.mock.calls[0][0] as string).toMatch(/XYZ/)
    expect(deps.notify.mock.calls[0][0] as string).toMatch(/Error/i)
  })

  it('sends an error notification when extraction yields no account', async () => {
    const deps = baseDeps({ extract: vi.fn().mockResolvedValue(null) })
    await processEmail({ ...email, text: 'raro' }, deps as never)
    expect(findInsertParams(deps)).toBeUndefined()
    expect(deps.notify.mock.calls[0][0] as string).toMatch(/Error/i)
  })

  it('backfills the missing rate and retries the conversion', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'Amazon', amount: -35, currency: 'USD',
        account_id: 'a1', category_id: 'c1', tags: ['shopping', 'online', 'usd'],
        payee: 'Amazon', occurred_at: '2026-06-29T20:55:00.000Z',
      }),
      convert: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ convertedAmount: -130.9, rateUsed: 3.74 }),
    })
    await processEmail(email, deps as never)
    expect(deps.backfill).toHaveBeenCalledTimes(1)
    const [, quoteCode, onDate] = deps.backfill.mock.calls[0]
    expect(quoteCode).toBe('PEN')
    expect(onDate).toBe('2026-06-29')
    const params = findInsertParams(deps)
    expect(params?.[10]).toBe(-130.9)
    expect(params?.[11]).toBe(3.74)
  })

  it('stores null base_amount when no rate exists even after backfill', async () => {
    const deps = baseDeps({
      extract: vi.fn().mockResolvedValue({
        description: 'Amazon', amount: -35, currency: 'USD',
        account_id: 'a1', category_id: 'c1', tags: ['shopping', 'online', 'usd'],
        payee: 'Amazon', occurred_at: '2026-06-29T20:55:00.000Z',
      }),
      convert: vi.fn().mockResolvedValue(null),
    })
    await processEmail(email, deps as never)
    const params = findInsertParams(deps)
    expect(params?.[10]).toBeNull()
    expect(params?.[11]).toBeNull()
    expect(deps.notify).toHaveBeenCalledOnce()
  })
})
