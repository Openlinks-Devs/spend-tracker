import { describe, it, expect, vi, beforeEach } from 'vitest'

const convertAmount = vi.fn()
const getBaseCurrencyCode = vi.fn()
vi.mock('../src/currency/rates.js', () => ({
  convertAmount: (...args: unknown[]) => convertAmount(...args),
  getBaseCurrencyCode: (...args: unknown[]) => getBaseCurrencyCode(...args),
}))

import { createTransactionsRoute } from '../src/routes/transactions.js'

const accountId = '11111111-1111-4111-8111-111111111111'
const destinationAccountId = '22222222-2222-4222-8222-222222222222'
const expenseCategoryId = '33333333-3333-4333-8333-333333333333'
const incomeCategoryId = '44444444-4444-4444-8444-444444444444'
const transactionId = '55555555-5555-4555-8555-555555555555'
const missingId = '99999999-9999-4999-8999-999999999999'

const sampleTransaction = {
  id: transactionId,
  description: 'Coffee',
  amount: -12.5,
  currency: 'PEN',
  account_id: accountId,
  category_id: expenseCategoryId,
  tags: ['food'],
  type: 'expense',
  payee: null,
  notes: null,
  occurred_at: '2026-06-30T10:00:00.000Z',
  base_amount: -12.5,
  rate_used: 1,
  to_account_id: null,
  to_amount: null,
  external_id: null,
  created_at: '2026-06-30T10:00:00.000Z',
  updated_at: null,
}

interface DbFixtures {
  accounts?: Record<string, unknown>
  categories?: Record<string, unknown>
  transactions?: Record<string, unknown>
  listRows?: unknown[]
  totalsRows?: unknown[]
}

const defaultAccounts = {
  [accountId]: { id: accountId, name: 'Cash', type: 'cash', currency: 'PEN' },
  [destinationAccountId]: { id: destinationAccountId, name: 'BCP USD', type: 'bank', currency: 'USD' },
}

const defaultCategories = {
  [expenseCategoryId]: { id: expenseCategoryId, name: 'Food', type: 'expense' },
  [incomeCategoryId]: { id: incomeCategoryId, name: 'Salary', type: 'income' },
}

function defaultTransactions(): Record<string, unknown> {
  return {
    [transactionId]: { ...sampleTransaction },
    'tx-new': { ...sampleTransaction, id: 'tx-new' },
  }
}

function createDb(fixtures: DbFixtures = {}) {
  const accounts = fixtures.accounts ?? defaultAccounts
  const categories = fixtures.categories ?? defaultCategories
  const transactions = fixtures.transactions ?? defaultTransactions()
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/from accounts/i.test(sql)) {
        const account = (accounts as Record<string, unknown>)[String(params?.[0])]
        return { rows: account ? [account] : [] }
      }
      if (/from categories/i.test(sql)) {
        const category = (categories as Record<string, unknown>)[String(params?.[0])]
        return { rows: category ? [category] : [] }
      }
      if (/insert into transactions/i.test(sql)) return { rows: [{ id: 'tx-new' }] }
      if (/update transactions/i.test(sql)) return { rows: [] }
      if (/delete from transactions/i.test(sql)) return { rows: [] }
      if (/group by currency/i.test(sql)) {
        return {
          rows:
            fixtures.totalsRows ?? [
              { currency: 'PEN', count: 2, sum: -25, base_sum: -25, missing_base: false },
            ],
        }
      }
      if (/from transactions/i.test(sql) && /order by/i.test(sql)) {
        return { rows: fixtures.listRows ?? Object.values(transactions) }
      }
      if (/from transactions/i.test(sql) && /where id/i.test(sql)) {
        const transaction = transactions[String(params?.[0])]
        return { rows: transaction ? [transaction] : [] }
      }
      if (/from transactions/i.test(sql)) return { rows: Object.values(transactions) }
      return { rows: [] }
    }),
  }
}

function findParams(db: ReturnType<typeof createDb>, pattern: RegExp): unknown[] | undefined {
  const call = db.query.mock.calls.find(([sql]) => pattern.test(sql as string))
  return call?.[1] as unknown[] | undefined
}

function postTransaction(route: ReturnType<typeof createTransactionsRoute>, body: unknown) {
  return route.request('/api/transactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patchTransaction(
  route: ReturnType<typeof createTransactionsRoute>,
  id: string,
  body: unknown,
) {
  return route.request(`/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getBaseCurrencyCode.mockResolvedValue('PEN')
  convertAmount.mockResolvedValue({ convertedAmount: -12.5, rateUsed: 1 })
})

describe('transactions route: read and delete', () => {
  it('GET /api/transactions returns items, next_cursor, and totals', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.next_cursor).toBeNull()
    expect(body.totals).toEqual({
      count: 2,
      by_currency: [{ currency: 'PEN', sum: -25 }],
      base: { currency: 'PEN', sum: -25 },
    })
  })

  it('GET /api/transactions pages with a decodable next_cursor', async () => {
    const rowIds = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ]
    const listRows = rowIds.map((rowId, index) => ({
      ...sampleTransaction,
      id: rowId,
      occurred_at: `2026-06-2${index}T10:00:00.000Z`,
    }))
    const db = createDb({ listRows })
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions?limit=2')
    const body = await response.json()
    expect(body.items).toHaveLength(2)
    expect(body.next_cursor).toBeTypeOf('string')
    const decoded = JSON.parse(
      Buffer.from(body.next_cursor as string, 'base64url').toString('utf8'),
    )
    expect(decoded.id).toBe(rowIds[1])
  })

  it('GET /api/transactions passes filters into the SQL', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await route.request('/api/transactions?currency=USD&type=expense&search=cafe')
    const listCall = db.query.mock.calls.find(([sql]) => /order by/i.test(sql as string))
    expect(listCall?.[0]).toMatch(/currency = \$/)
    expect(listCall?.[0]).toMatch(/type = \$/)
    expect(listCall?.[0]).toMatch(/ILIKE/)
    expect(listCall?.[1]).toContain('USD')
    expect(listCall?.[1]).toContain('expense')
    expect(listCall?.[1]).toContain('%cafe%')
  })

  it('GET /api/transactions returns a null base sum when rates are missing', async () => {
    const db = createDb({
      totalsRows: [
        { currency: 'PEN', count: 1, sum: -10, base_sum: -10, missing_base: false },
        { currency: 'USD', count: 1, sum: -20, base_sum: null, missing_base: true },
      ],
    })
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions')
    const body = await response.json()
    expect(body.totals.base.sum).toBeNull()
    expect(body.totals.count).toBe(2)
  })

  it('GET /api/transactions rejects an invalid cursor with 400', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions?cursor=%%%broken')
    expect(response.status).toBe(400)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('GET /api/transactions rejects an invalid tag_mode with 400', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions?tags=food&tag_mode=some')
    expect(response.status).toBe(400)
  })

  it('GET /api/transactions rejects non-uuid account_ids with 400', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions?account_ids=abc,def')
    expect(response.status).toBe(400)
  })

  it('GET /api/transactions/:id returns 404 when missing', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request(`/api/transactions/${missingId}`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Transaction not found' })
  })

  it('DELETE /api/transactions/:id deletes when present', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request(`/api/transactions/${transactionId}`, { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })

  it('DELETE /api/transactions/:id returns 404 when missing', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await route.request(`/api/transactions/${missingId}`, { method: 'DELETE' })
    expect(response.status).toBe(404)
  })

  it('returns 500 with a JSON error when the query fails', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) }
    const route = createTransactionsRoute(() => db)
    const response = await route.request('/api/transactions')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to list transactions' })
  })
})

describe('POST /api/transactions', () => {
  it('creates an expense: negative sign derived, base_amount from convertAmount', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      tags: ['food'],
      type: 'expense',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(201)
    expect((await response.json()).id).toBe('tx-new')
    const params = findParams(db, /insert into transactions/i)
    expect(params).toEqual([
      'Lunch', -12.5, 'PEN', accountId, expenseCategoryId, ['food'],
      'expense', null, null, '2026-06-30T10:00:00.000Z', -12.5, 1, null, null, null,
    ])
    expect(convertAmount).toHaveBeenCalledTimes(1)
    const [, amountArg, fromArg, toArg, dateArg] = convertAmount.mock.calls[0]
    expect([amountArg, fromArg, toArg, dateArg]).toEqual([-12.5, 'PEN', 'PEN', '2026-06-30'])
  })

  it('creates an income with a positive stored amount', async () => {
    convertAmount.mockResolvedValue({ convertedAmount: 1200, rateUsed: 1 })
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Salary',
      amount: 1200,
      currency: 'PEN',
      account_id: accountId,
      category_id: incomeCategoryId,
      type: 'income',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(201)
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[1]).toBe(1200)
    expect(params?.[6]).toBe('income')
  })

  it('defaults occurred_at to now when omitted', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
    })
    expect(response.status).toBe(201)
    const params = findParams(db, /insert into transactions/i)
    expect(String(params?.[9])).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('stores payee, notes, and external_id', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      payee: 'La Lucha',
      notes: 'with the team',
      external_id: 'gmail-abc',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[7]).toBe('La Lucha')
    expect(params?.[8]).toBe('with the team')
    expect(params?.[14]).toBe('gmail-abc')
  })

  it('stores null base_amount and rate_used when no rate exists (never 1)', async () => {
    convertAmount.mockResolvedValue(null)
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Import',
      amount: 20,
      currency: 'USD',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(201)
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[10]).toBeNull()
    expect(params?.[11]).toBeNull()
  })

  it('honors an explicit base_amount override and derives rate_used', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await postTransaction(route, {
      description: 'Import',
      amount: 20,
      currency: 'USD',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      base_amount: 74.8,
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[10]).toBe(-74.8)
    expect(params?.[11]).toBe(3.74)
    expect(convertAmount).not.toHaveBeenCalled()
  })

  it('honors an explicit rate_used alongside base_amount', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await postTransaction(route, {
      description: 'Import',
      amount: 20,
      currency: 'USD',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      base_amount: 74.8,
      rate_used: 3.7401,
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[11]).toBe(3.7401)
  })

  it('creates a transfer: negative source leg, null category, destination stored', async () => {
    convertAmount.mockResolvedValue({ convertedAmount: -100, rateUsed: 1 })
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'To USD account',
      amount: 100,
      currency: 'PEN',
      account_id: accountId,
      type: 'transfer',
      to_account_id: destinationAccountId,
      to_amount: 26.7,
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(201)
    const params = findParams(db, /insert into transactions/i)
    expect(params?.[1]).toBe(-100)
    expect(params?.[4]).toBeNull()
    expect(params?.[6]).toBe('transfer')
    expect(params?.[12]).toBe(destinationAccountId)
    expect(params?.[13]).toBe(26.7)
  })

  it('returns 422 when the category type does not match the transaction type', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Salary',
      amount: 1200,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'income',
      occurred_at: '2026-06-30T10:00:00.000Z',
    })
    expect(response.status).toBe(422)
    expect((await response.json()).error).toMatch(/does not match/i)
    expect(findParams(db, /insert into transactions/i)).toBeUndefined()
  })

  it('returns 400 on a malformed account_id uuid', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: 'not-a-uuid',
      category_id: expenseCategoryId,
      type: 'expense',
    })
    expect(response.status).toBe(400)
    expect(findParams(db, /insert into transactions/i)).toBeUndefined()
  })

  it('returns 404 when the account does not exist', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: missingId,
      category_id: expenseCategoryId,
      type: 'expense',
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Account not found' })
  })

  it('returns 404 when the category does not exist', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: missingId,
      type: 'expense',
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Category not found' })
  })

  it('returns 422 for a transfer without to_amount', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Move',
      amount: 100,
      currency: 'PEN',
      account_id: accountId,
      type: 'transfer',
      to_account_id: destinationAccountId,
    })
    expect(response.status).toBe(422)
  })

  it('returns 422 for a transfer carrying a category_id', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Move',
      amount: 100,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'transfer',
      to_account_id: destinationAccountId,
      to_amount: 100,
    })
    expect(response.status).toBe(422)
  })

  it('returns 422 for a transfer into the same account', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Move',
      amount: 100,
      currency: 'PEN',
      account_id: accountId,
      type: 'transfer',
      to_account_id: accountId,
      to_amount: 100,
    })
    expect(response.status).toBe(422)
  })

  it('returns 422 for a non-transfer carrying to_account_id', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
      to_account_id: destinationAccountId,
    })
    expect(response.status).toBe(422)
  })

  it('returns 422 for a non-transfer without category_id', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: 12.5,
      currency: 'PEN',
      account_id: accountId,
      type: 'expense',
    })
    expect(response.status).toBe(422)
  })

  it('returns 400 when amount is not positive', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await postTransaction(route, {
      description: 'Lunch',
      amount: -5,
      currency: 'PEN',
      account_id: accountId,
      category_id: expenseCategoryId,
      type: 'expense',
    })
    expect(response.status).toBe(400)
  })
})

describe('PATCH /api/transactions/:id', () => {
  it('merges description only and does not recompute base_amount', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, { description: 'Tea' })
    expect(response.status).toBe(200)
    const params = findParams(db, /update transactions/i)
    expect(params).toEqual([
      transactionId, 'Tea', -12.5, 'PEN', accountId, expenseCategoryId, ['food'],
      'expense', null, null, '2026-06-30T10:00:00.000Z', -12.5, 1, null, null, null,
    ])
    expect(convertAmount).not.toHaveBeenCalled()
  })

  it('recomputes base_amount when the amount changes', async () => {
    convertAmount.mockResolvedValue({ convertedAmount: -99.9, rateUsed: 1 })
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, { amount: 99.9 })
    expect(response.status).toBe(200)
    const params = findParams(db, /update transactions/i)
    expect(params?.[2]).toBe(-99.9)
    expect(params?.[11]).toBe(-99.9)
    expect(params?.[12]).toBe(1)
    expect(convertAmount).toHaveBeenCalledTimes(1)
  })

  it('recomputes base_amount when the currency changes', async () => {
    convertAmount.mockResolvedValue({ convertedAmount: -46.75, rateUsed: 3.74 })
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await patchTransaction(route, transactionId, { currency: 'USD' })
    const params = findParams(db, /update transactions/i)
    expect(params?.[3]).toBe('USD')
    expect(params?.[11]).toBe(-46.75)
    expect(params?.[12]).toBe(3.74)
  })

  it('does not recompute when an explicit base_amount accompanies the change', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    await patchTransaction(route, transactionId, { amount: 20, currency: 'USD', base_amount: 74.8 })
    const params = findParams(db, /update transactions/i)
    expect(params?.[2]).toBe(-20)
    expect(params?.[11]).toBe(-74.8)
    expect(params?.[12]).toBe(3.74)
    expect(convertAmount).not.toHaveBeenCalled()
  })

  it('flips the stored sign when type changes to income', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, {
      type: 'income',
      category_id: incomeCategoryId,
    })
    expect(response.status).toBe(200)
    const params = findParams(db, /update transactions/i)
    expect(params?.[2]).toBe(12.5)
    expect(params?.[7]).toBe('income')
    expect(params?.[11]).toBe(12.5)
    expect(convertAmount).not.toHaveBeenCalled()
  })

  it('returns 422 when changing type to transfer without a destination', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, { type: 'transfer' })
    expect(response.status).toBe(422)
  })

  it('returns 422 when the new category type mismatches the type', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, transactionId, {
      category_id: incomeCategoryId,
    })
    expect(response.status).toBe(422)
  })

  it('returns 404 when the transaction is missing', async () => {
    const db = createDb()
    const route = createTransactionsRoute(() => db)
    const response = await patchTransaction(route, missingId, { description: 'Tea' })
    expect(response.status).toBe(404)
  })
})
