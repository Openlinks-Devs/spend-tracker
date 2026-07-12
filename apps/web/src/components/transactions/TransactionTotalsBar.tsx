import { formatCurrency } from '@/lib/utils'
import type { TransactionTotals } from '@/types'

interface TransactionTotalsBarProps {
  totals: TransactionTotals | null
  baseCurrencyCode: string
}

export function TransactionTotalsBar({ totals, baseCurrencyCode }: TransactionTotalsBarProps) {
  if (!totals) return null
  const transactionsLabel = totals.count === 1 ? '1 transaction' : `${totals.count} transactions`
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/40 px-4 py-2 text-sm">
      <span className="font-medium">{transactionsLabel}</span>
      {totals.by_currency.map((currencySum) => (
        <span key={currencySum.currency} className="tabular-nums text-muted-foreground">
          {formatCurrency(currencySum.sum, currencySum.currency)}
        </span>
      ))}
      <span className="ml-auto font-medium tabular-nums">
        {totals.base.sum === null
          ? `${baseCurrencyCode} total unavailable: missing rates`
          : formatCurrency(totals.base.sum, baseCurrencyCode)}
      </span>
    </div>
  )
}
