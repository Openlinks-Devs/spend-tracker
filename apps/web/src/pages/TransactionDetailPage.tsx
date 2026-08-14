import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { IconArrowLeft } from '@tabler/icons-react'
import { Card, CardContent } from '@/components/ui/card'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { ApiError, toErrorMessage, transactionsApi } from '@/lib/api'
import { cn, formatCurrency, formatDate, formatTime, toNameById } from '@/lib/utils'

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-6 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm">{value}</span>
    </div>
  )
}

export function TransactionDetailPage() {
  const { transactionId } = useParams<{ transactionId: string }>()
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()

  const transactionQuery = useQuery({
    queryKey: ['transactions', 'detail', transactionId],
    queryFn: () => transactionsApi.get(transactionId as string),
    enabled: Boolean(transactionId),
  })

  const transaction = transactionQuery.data
  // An inbox row can point at a transaction that was deleted since it was
  // imported, so a missing one is an expected outcome, not a broken request.
  const isNotFound = transactionQuery.error instanceof ApiError && transactionQuery.error.status === 404
  const accountName = toNameById(accountsQuery.data).get(transaction?.account_id ?? '')
  const categoryName = toNameById(categoriesQuery.data).get(transaction?.category_id ?? '')

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          to="/transactions"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft className="h-4 w-4" />
          Back to transactions
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {transaction ? transaction.description : 'Transaction'}
        </h1>
      </div>

      <Card>
        <CardContent className="p-0">
          {transactionQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading transaction...</p>
          ) : isNotFound ? (
            <p className="p-6 text-sm text-muted-foreground">
              This transaction was not found. It may have been deleted.
            </p>
          ) : transactionQuery.isError ? (
            <p className="p-6 text-sm text-destructive">{toErrorMessage(transactionQuery.error)}</p>
          ) : transaction ? (
            <div className="divide-y">
              <div className="flex items-baseline justify-between gap-4 px-6 py-3">
                <span className="text-sm text-muted-foreground">Amount</span>
                <span
                  className={cn(
                    'text-sm font-medium tabular-nums',
                    transaction.amount < 0 ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {formatCurrency(transaction.amount, transaction.currency)}
                </span>
              </div>
              <DetailRow label="Account" value={accountName ?? transaction.account_id} />
              <DetailRow label="Category" value={categoryName ?? 'Uncategorized'} />
              <DetailRow
                label="Date"
                value={`${formatDate(transaction.created_at)} at ${formatTime(transaction.created_at)}`}
              />
              {transaction.updated_at ? (
                <DetailRow
                  label="Last edited"
                  value={`${formatDate(transaction.updated_at)} at ${formatTime(transaction.updated_at)}`}
                />
              ) : null}
              <div className="flex items-baseline justify-between gap-4 px-6 py-3">
                <span className="text-sm text-muted-foreground">Tags</span>
                {transaction.tags.length === 0 ? (
                  <span className="text-sm text-muted-foreground">None</span>
                ) : (
                  <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                    {transaction.tags.map((tag) => (
                      <span key={tag} className="text-sm">
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
