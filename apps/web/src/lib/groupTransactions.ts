import { formatDayLabel, toDayKey } from '@/lib/utils'
import type { Transaction, TransactionFilters } from '@/types'

export interface TransactionDayGroup {
  dayKey: string
  dayLabel: string
  transactions: Transaction[]
}

// Day grouping only makes sense when the server ordered the list by
// occurred_at; under amount sort the same day would fragment into many groups.
export function shouldGroupByDay(filters: Pick<TransactionFilters, 'sort'>): boolean {
  return (filters.sort ?? 'occurred_at') === 'occurred_at'
}

// Groups an already-ordered list (server returns occurred_at DESC) into
// consecutive calendar-day buckets keyed on occurred_at.
export function groupTransactionsByDay(transactions: Transaction[]): TransactionDayGroup[] {
  const groups: TransactionDayGroup[] = []
  for (const transaction of transactions) {
    const dayKey = toDayKey(transaction.occurred_at)
    let group = groups[groups.length - 1]
    if (!group || group.dayKey !== dayKey) {
      group = { dayKey, dayLabel: formatDayLabel(transaction.occurred_at), transactions: [] }
      groups.push(group)
    }
    group.transactions.push(transaction)
  }
  return groups
}
