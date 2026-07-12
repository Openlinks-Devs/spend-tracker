import { describe, expect, it } from 'vitest'
import { summarizeCategorySpend, summarizeTransactions } from '@/lib/dashboardSummary'
import { makeTransaction } from '@/test/factories'

describe('summarizeTransactions', () => {
  it('sums base_amount excluding transfers and reports per-currency detail', () => {
    const transactions = [
      makeTransaction({ type: 'expense', amount: -20, currency: 'USD', base_amount: -74.8 }),
      makeTransaction({ type: 'income', amount: 500, currency: 'PEN', base_amount: 500 }),
      makeTransaction({
        type: 'transfer',
        amount: -100,
        currency: 'PEN',
        base_amount: -100,
        category_id: null,
        to_account_id: 'acc-2',
        to_amount: 100,
      }),
    ]
    const summary = summarizeTransactions(transactions, 'PEN')
    expect(summary.baseNetBalance).toBeCloseTo(425.2)
    expect(summary.baseTotalSpend).toBeCloseTo(74.8)
    expect(summary.hasIncompleteRates).toBe(false)
    const usd = summary.byCurrency.find((row) => row.currency === 'USD')
    expect(usd?.totalSpend).toBeCloseTo(20)
    const pen = summary.byCurrency.find((row) => row.currency === 'PEN')
    expect(pen?.netBalance).toBeCloseTo(500)
  })

  it('flags incomplete rates when a non-transfer row has no base_amount', () => {
    const transactions = [
      makeTransaction({ type: 'expense', amount: -20, currency: 'USD', base_amount: null }),
    ]
    const summary = summarizeTransactions(transactions, 'PEN')
    expect(summary.hasIncompleteRates).toBe(true)
    expect(summary.baseTotalSpend).toBeCloseTo(0)
  })
})

describe('summarizeCategorySpend', () => {
  it('aggregates absolute base_amount per category for expenses in range', () => {
    const categoryNameById = new Map([
      ['cat-food', 'Food'],
      ['cat-transport', 'Transport'],
    ])
    const transactions = [
      makeTransaction({
        type: 'expense',
        category_id: 'cat-food',
        base_amount: -30,
        occurred_at: '2026-07-05T12:00:00.000Z',
      }),
      makeTransaction({
        type: 'expense',
        category_id: 'cat-food',
        base_amount: -10,
        occurred_at: '2026-07-06T12:00:00.000Z',
      }),
      makeTransaction({
        type: 'expense',
        category_id: 'cat-transport',
        base_amount: -25,
        occurred_at: '2026-06-01T12:00:00.000Z',
      }),
    ]
    const spends = summarizeCategorySpend(transactions, categoryNameById, {
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: null,
    })
    expect(spends).toEqual([{ categoryName: 'Food', total: 40 }])
  })
})
