import type { Transaction } from '@/types'

export interface CurrencyBreakdown {
  currency: string
  netBalance: number
  totalSpend: number
}

export interface DashboardSummary {
  baseCurrencyCode: string
  baseNetBalance: number
  baseTotalSpend: number
  hasIncompleteRates: boolean
  byCurrency: CurrencyBreakdown[]
}

// Transfers move money between own accounts, so they are excluded from both the
// base totals and the per-currency income/expense breakdown.
export function summarizeTransactions(
  transactions: Transaction[],
  baseCurrencyCode: string,
): DashboardSummary {
  let baseNetBalance = 0
  let baseTotalSpend = 0
  let hasIncompleteRates = false
  const byCurrency = new Map<string, CurrencyBreakdown>()

  for (const transaction of transactions) {
    if (transaction.type === 'transfer') continue

    if (transaction.base_amount === null) {
      hasIncompleteRates = true
    } else {
      baseNetBalance += transaction.base_amount
      if (transaction.type === 'expense') {
        baseTotalSpend += Math.abs(transaction.base_amount)
      }
    }

    const currency = transaction.currency || baseCurrencyCode
    const breakdown = byCurrency.get(currency) ?? { currency, netBalance: 0, totalSpend: 0 }
    breakdown.netBalance += transaction.amount
    if (transaction.type === 'expense') {
      breakdown.totalSpend += Math.abs(transaction.amount)
    }
    byCurrency.set(currency, breakdown)
  }

  return {
    baseCurrencyCode,
    baseNetBalance,
    baseTotalSpend,
    hasIncompleteRates,
    byCurrency: Array.from(byCurrency.values()).sort(
      (first, second) => second.totalSpend - first.totalSpend,
    ),
  }
}

export function summarizeCategorySpend(
  transactions: Transaction[],
  categoryNameById: Map<string, string>,
  range: { start: Date | null; end: Date | null },
): { categoryName: string; total: number }[] {
  const totals = new Map<string, number>()
  for (const transaction of transactions) {
    if (transaction.type !== 'expense' || transaction.base_amount === null) continue
    const occurredAt = new Date(transaction.occurred_at)
    if (range.start && occurredAt < range.start) continue
    if (range.end && occurredAt >= range.end) continue
    const categoryName = categoryNameById.get(transaction.category_id ?? '') ?? 'Uncategorized'
    totals.set(categoryName, (totals.get(categoryName) ?? 0) + Math.abs(transaction.base_amount))
  }
  return Array.from(totals.entries())
    .map(([categoryName, total]) => ({ categoryName, total }))
    .sort((first, second) => second.total - first.total)
}
