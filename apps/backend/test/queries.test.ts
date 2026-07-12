import { describe, it, expect, vi } from 'vitest'
import {
  getCategories,
  getDistinctTags,
  insertTransaction,
  updateTransaction,
  deleteTransaction,
  setState,
  getTransactionById,
  getAccountById,
  insertAccount,
  insertCategory,
  getTransactionByExternalId,
  getCurrencyByCode,
  accountHasTransactions,
  categoryHasTransactions,
} from '../src/db/queries.js'

function fakeDb(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('queries', () => {
  it('getCategories returns rows', async () => {
    const db = fakeDb([{ id: 'c1', name: 'Food', type: 'expense' }])
    const categories = await getCategories(db)
    expect(categories[0].name).toBe('Food')
    expect(db.query.mock.calls[0][0]).toMatch(/from categories/i)
  })

  it('getDistinctTags flattens to strings', async () => {
    const db = fakeDb([{ tag: 'food' }, { tag: 'delivery' }])
    const tags = await getDistinctTags(db)
    expect(tags).toEqual(['food', 'delivery'])
  })

  it('insertTransaction passes params and returns id', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'tx1' }] }) }
    const result = await insertTransaction(db, {
      description: 'PLIN',
      amount: -35,
      currency: 'PEN',
      account_id: 'a1',
      category_id: 'c1',
      tags: ['food', 'plin', 'transfer'],
      type: 'expense',
      payee: 'Marisela Calle',
      notes: null,
      occurred_at: '2026-06-29T20:55:00.000Z',
      base_amount: -35,
      rate_used: 1,
      to_account_id: null,
      to_amount: null,
      external_id: 'gmail-123',
    })
    expect(result.id).toBe('tx1')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/insert into transactions/i)
    expect(params).toEqual([
      'PLIN', -35, 'PEN', 'a1', 'c1', ['food', 'plin', 'transfer'],
      'expense', 'Marisela Calle', null, '2026-06-29T20:55:00.000Z',
      -35, 1, null, null, 'gmail-123',
    ])
  })

  it('updateTransaction writes every column and bumps updated_at', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await updateTransaction(db, {
      id: 'tx1',
      description: 'PLIN',
      amount: -35,
      currency: 'PEN',
      account_id: 'a1',
      category_id: 'c1',
      tags: ['food'],
      type: 'expense',
      payee: null,
      notes: null,
      occurred_at: '2026-06-29T20:55:00.000Z',
      base_amount: -35,
      rate_used: 1,
      to_account_id: null,
      to_amount: null,
      external_id: null,
    })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/update transactions/i)
    expect(sql).toMatch(/updated_at = now\(\)/i)
    expect(params).toHaveLength(16)
    expect(params[0]).toBe('tx1')
  })

  it('deleteTransaction issues a delete with the id', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await deleteTransaction(db, 'tx1')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/delete from transactions/i)
    expect(params).toEqual(['tx1'])
  })

  it('setState upserts', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await setState(db, 'gmail_history_id', '42')
    expect(db.query.mock.calls[0][0]).toMatch(/on conflict/i)
  })

  it('getTransactionById returns null when no rows', async () => {
    const db = fakeDb([])
    const transaction = await getTransactionById(db, 'missing')
    expect(transaction).toBeNull()
    expect(db.query.mock.calls[0][1]).toEqual(['missing'])
  })

  it('getAccountById returns the row when present', async () => {
    const db = fakeDb([{ id: 'a1', name: 'Cash', type: 'cash', currency: 'PEN' }])
    const account = await getAccountById(db, 'a1')
    expect(account?.name).toBe('Cash')
  })

  it('insertAccount passes params and returns id', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'a-new' }] }) }
    const result = await insertAccount(db, { name: 'Savings', type: 'bank', currency: 'USD' })
    expect(result.id).toBe('a-new')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/insert into accounts/i)
    expect(params).toEqual(['Savings', 'bank', 'USD'])
  })

  it('insertCategory passes params and returns id', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'c-new' }] }) }
    const result = await insertCategory(db, { name: 'Transport', type: 'expense' })
    expect(result.id).toBe('c-new')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/insert into categories/i)
    expect(params).toEqual(['Transport', 'expense'])
  })

  it('getTransactionByExternalId looks up by external_id', async () => {
    const db = fakeDb([{ id: 'tx1', external_id: 'gmail-123' }])
    const transaction = await getTransactionByExternalId(db, 'gmail-123')
    expect(transaction?.id).toBe('tx1')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/where external_id = \$1/i)
    expect(params).toEqual(['gmail-123'])
  })

  it('getTransactionByExternalId returns null when absent', async () => {
    const db = fakeDb([])
    expect(await getTransactionByExternalId(db, 'gmail-404')).toBeNull()
  })

  it('getCurrencyByCode looks up a currency', async () => {
    const db = fakeDb([{ code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', decimal_places: 2 }])
    const currency = await getCurrencyByCode(db, 'PEN')
    expect(currency?.decimal_places).toBe(2)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/from currencies/i)
    expect(params).toEqual(['PEN'])
  })

  it('getCurrencyByCode returns null for an unknown code', async () => {
    const db = fakeDb([])
    expect(await getCurrencyByCode(db, 'XYZ')).toBeNull()
  })

  it('accountHasTransactions checks source and destination references', async () => {
    const db = fakeDb([{ referenced: true }])
    expect(await accountHasTransactions(db, 'a1')).toBe(true)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/select exists/i)
    expect(sql).toMatch(/account_id = \$1 or to_account_id = \$1/i)
    expect(params).toEqual(['a1'])
  })

  it('accountHasTransactions returns false when unreferenced', async () => {
    const db = fakeDb([{ referenced: false }])
    expect(await accountHasTransactions(db, 'a1')).toBe(false)
  })

  it('categoryHasTransactions checks category references', async () => {
    const db = fakeDb([{ referenced: true }])
    expect(await categoryHasTransactions(db, 'c1')).toBe(true)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/select exists/i)
    expect(sql).toMatch(/category_id = \$1/i)
    expect(params).toEqual(['c1'])
  })
})
