import { formatDayLabel, toDayKey } from '@/lib/utils'
import type { Transaction } from '@/types'

export interface TransactionDayGroup {
  dayKey: string
  dayLabel: string
  transactions: Transaction[]
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
