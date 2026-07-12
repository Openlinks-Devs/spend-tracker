import { describe, expect, it } from 'vitest'
import { groupTransactionsByDay } from '@/lib/groupTransactions'
import { makeTransaction } from '@/test/factories'

describe('groupTransactionsByDay', () => {
  it('groups consecutive transactions by their occurred_at calendar day', () => {
    const transactions = [
      makeTransaction({ id: 'a', occurred_at: '2026-07-10T18:00:00.000Z' }),
      makeTransaction({ id: 'b', occurred_at: '2026-07-10T09:00:00.000Z' }),
      makeTransaction({ id: 'c', occurred_at: '2026-07-09T22:00:00.000Z' }),
    ]
    const groups = groupTransactionsByDay(transactions)
    expect(groups).toHaveLength(2)
    expect(groups[0].transactions.map((transaction) => transaction.id)).toEqual(['a', 'b'])
    expect(groups[1].transactions.map((transaction) => transaction.id)).toEqual(['c'])
  })

  it('returns no groups for an empty list', () => {
    expect(groupTransactionsByDay([])).toEqual([])
  })
})
