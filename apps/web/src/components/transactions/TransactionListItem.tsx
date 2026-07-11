import { IconPencil, IconTrash } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency, formatDate, formatTime } from '@/lib/utils'
import type { Transaction } from '@/types'

interface TransactionListItemProps {
  transaction: Transaction
  accountName: string
  categoryName: string
  /** Show the calendar date instead of the time of day (for ungrouped lists). */
  showDate?: boolean
  onEdit?: (transaction: Transaction) => void
  onDelete?: (transaction: Transaction) => void
}

export function TransactionListItem({
  transaction,
  accountName,
  categoryName,
  showDate = false,
  onEdit,
  onDelete,
}: TransactionListItemProps) {
  const isIncome = transaction.amount > 0
  const whenLabel = showDate
    ? formatDate(transaction.created_at)
    : formatTime(transaction.created_at)
  const hasActions = Boolean(onEdit || onDelete)

  return (
    <li className="flex items-start justify-between gap-4 px-6 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{transaction.description}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {whenLabel} · {categoryName} · {accountName}
        </p>
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
            isIncome && 'text-emerald-600 dark:text-emerald-400',
          )}
        >
          {isIncome ? '+' : ''}
          {formatCurrency(transaction.amount, transaction.currency)}
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
