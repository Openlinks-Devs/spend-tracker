import { describe, it, expect, vi } from 'vitest'
import {
  getCategories,
  getDistinctTags,
  insertTransaction,
  deleteTransaction,
  setState,
  getTransactions,
  getTransactionById,
  getAccountById,
  insertAccount,
  insertCategory,
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
      description: 'PLIN', amount: -35, currency: 'PEN',
      account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
      created_at: '2026-06-30T10:00:00.000Z',
    })
    expect(result.id).toBe('tx1')
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/insert into transactions/i)
    expect(params).toContain('PLIN')
    expect(params).toContain(-35)
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

  it('getTransactions selects ordered rows', async () => {
    const db = fakeDb([{ id: 'tx1' }, { id: 'tx2' }])
    const transactions = await getTransactions(db)
    expect(transactions).toHaveLength(2)
    expect(db.query.mock.calls[0][0]).toMatch(/from transactions/i)
    expect(db.query.mock.calls[0][0]).toMatch(/order by created_at desc/i)
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
})
