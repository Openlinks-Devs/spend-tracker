import { IconArrowsExchange, IconPencil, IconTrash } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { cn, formatDate, formatTime } from '@/lib/utils'
import {
  formatTransactionAmount,
  formatTransferAmount,
  formatTransferRoute,
} from '@/lib/transactionAmount'
import type { Transaction } from '@/types'

interface TransactionListItemProps {
  transaction: Transaction
  accountName: string
  categoryName: string
  baseCurrencyCode: string
  /** Destination account name, used only for transfer rows. */
  toAccountName?: string
  /** Destination account currency, used only for transfer rows. */
  toAccountCurrency?: string | null
  /** Show the calendar date instead of the time of day (for ungrouped lists). */
  showDate?: boolean
  onEdit?: (transaction: Transaction) => void
  onDelete?: (transaction: Transaction) => void
}

export function TransactionListItem({
  transaction,
  accountName,
  categoryName,
  baseCurrencyCode,
  toAccountName,
  toAccountCurrency,
  showDate = false,
  onEdit,
  onDelete,
}: TransactionListItemProps) {
  const isTransfer = transaction.type === 'transfer'
  const isIncome = transaction.type === 'income'
  const whenLabel = showDate
    ? formatDate(transaction.occurred_at)
    : formatTime(transaction.occurred_at)
  const hasActions = Boolean(onEdit || onDelete)

  const detailLine = isTransfer
    ? formatTransferRoute(accountName, toAccountName ?? transaction.to_account_id ?? '')
    : `${categoryName} · ${accountName}`

  const amountLabel = isTransfer
    ? formatTransferAmount(
        transaction.amount,
        transaction.currency,
        transaction.to_amount,
        toAccountCurrency ?? null,
      )
    : formatTransactionAmount(
        transaction.amount,
        transaction.currency,
        transaction.base_amount,
        baseCurrencyCode,
      )

  return (
    <li className="flex items-start justify-between gap-4 px-6 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {isTransfer ? <IconArrowsExchange className="h-4 w-4 text-muted-foreground" /> : null}
          {transaction.description}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {whenLabel} · {detailLine}
        </p>
        {transaction.payee ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{transaction.payee}</p>
        ) : null}
        {transaction.tags.length > 0 ? (
          <p className="mt-1 truncate text-xs text-muted-foreground/80">
            {transaction.tags.map((tag) => `#${tag}`).join(' ')}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            'text-sm font-medium tabular-nums',
            isTransfer && 'text-muted-foreground',
            isIncome && 'text-emerald-600 dark:text-emerald-400',
          )}
        >
          {isTransfer ? '' : isIncome ? '+' : '-'}
          {amountLabel}
        </span>
        {hasActions ? (
          <div className="-mr-2 flex gap-0.5">
            {onEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => onEdit(transaction)}
                aria-label="Edit transaction"
              >
                <IconPencil className="h-4 w-4" />
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => onDelete(transaction)}
                aria-label="Delete transaction"
              >
                <IconTrash className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}
