import { useEffect, useMemo, useState } from 'react'
import { IconArrowsExchange, IconPlus } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FilterChips } from '@/components/filters/FilterChips'
import { FilterPanel } from '@/components/filters/FilterPanel'
import { SearchBar } from '@/components/filters/SearchBar'
import { TransactionFormDialog } from '@/components/transactions/TransactionFormDialog'
import { TransferFormDialog } from '@/components/transactions/TransferFormDialog'
import { TransactionListItem } from '@/components/transactions/TransactionListItem'
import {
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
} from '@/hooks/useTransactions'
import { useCreateTransfer } from '@/hooks/useTransfer'
import { useTransactionFilters } from '@/hooks/useTransactionFilters'
import { useTransactionsQuery } from '@/hooks/useTransactionsQuery'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { toSearchParams } from '@/lib/filterParams'
import { formatCurrency, formatDayLabel, toDayKey, toNameById } from '@/lib/utils'
import { toErrorMessage } from '@/lib/api'
import type { NewTransaction, Transaction, TransactionUpdate, TransferInput } from '@/types'

const PAGE_SIZE = 50
// GET /api/transactions clamps limit to 200, so the growing-limit list tops out
// there. Beyond that the user narrows the results with filters or search.
const MAX_LOADED_TRANSACTIONS = 200

interface DayGroup {
  dayKey: string
  dayLabel: string
  netByCurrency: Map<string, number>
  transactions: Transaction[]
}

function groupTransactionsByDay(transactions: Transaction[]): DayGroup[] {
  const sorted = [...transactions].sort(
    (first, second) =>
      new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
  )
  const groups: DayGroup[] = []
  for (const transaction of sorted) {
    const dayKey = toDayKey(transaction.created_at)
    let group = groups[groups.length - 1]
    if (!group || group.dayKey !== dayKey) {
      group = {
        dayKey,
        dayLabel: formatDayLabel(transaction.created_at),
        netByCurrency: new Map(),
        transactions: [],
      }
      groups.push(group)
    }
    group.transactions.push(transaction)
    group.netByCurrency.set(
      transaction.currency,
      (group.netByCurrency.get(transaction.currency) ?? 0) + transaction.amount,
    )
  }
  return groups
}

function formatDayNet(netByCurrency: Map<string, number>): string {
  return Array.from(netByCurrency.entries())
    .map(([currency, net]) => formatCurrency(net, currency))
    .join(' · ')
}

export function TransactionsPage() {
  const { filters } = useTransactionFilters()
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()

  const createTransaction = useCreateTransaction()
  const updateTransaction = useUpdateTransaction()
  const deleteTransaction = useDeleteTransaction()
  const createTransfer = useCreateTransfer()

  // Growing-limit pagination: "Load more" raises the requested limit, and the
  // limit resets whenever the active filters change so a new query starts small.
  const [limit, setLimit] = useState(PAGE_SIZE)
  const queryString = useMemo(() => toSearchParams(filters).toString(), [filters])
  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [queryString])

  const listQuery = useTransactionsQuery(filters, { limit, offset: 0 })

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [duplicatingTransaction, setDuplicatingTransaction] = useState<Transaction | null>(null)
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isTransferOpen, setIsTransferOpen] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)

  const accounts = accountsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const transactions = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0

  const accountNameById = useMemo(() => toNameById(accounts), [accounts])
  const categoryNameById = useMemo(() => toNameById(categories), [categories])

  const dayGroups = useMemo(() => groupTransactionsByDay(transactions), [transactions])

  const canLoadMore = transactions.length < total && transactions.length < MAX_LOADED_TRANSACTIONS
  const isCapReached = transactions.length >= MAX_LOADED_TRANSACTIONS && total > transactions.length

  function openCreateDialog() {
    setEditingTransaction(null)
    setDuplicatingTransaction(null)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(transaction: Transaction) {
    setEditingTransaction(transaction)
    setDuplicatingTransaction(null)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function openDuplicateDialog(transaction: Transaction) {
    setEditingTransaction(null)
    setDuplicatingTransaction(transaction)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function handleCreate(payload: NewTransaction) {
    setFormError(null)
    createTransaction.mutate(payload, {
      onSuccess: () => setIsDialogOpen(false),
      onError: (error) => setFormError(toErrorMessage(error)),
    })
  }

  function handleUpdate(transactionId: string, payload: TransactionUpdate) {
    setFormError(null)
    updateTransaction.mutate(
      { id: transactionId, payload },
      {
        onSuccess: () => setIsDialogOpen(false),
        onError: (error) => setFormError(toErrorMessage(error)),
      },
    )
  }

  function openTransferDialog() {
    setTransferError(null)
    setIsTransferOpen(true)
  }

  function handleTransfer(payload: TransferInput) {
    setTransferError(null)
    createTransfer.mutate(payload, {
      onSuccess: () => setIsTransferOpen(false),
      onError: (error) => setTransferError(toErrorMessage(error)),
    })
  }

  function openDeleteDialog(transaction: Transaction) {
    setDeleteError(null)
    setDeletingTransaction(transaction)
  }

  function handleConfirmDelete() {
    if (!deletingTransaction) return
    setDeleteError(null)
    deleteTransaction.mutate(deletingTransaction.id, {
      onSuccess: () => setDeletingTransaction(null),
      onError: (error) => setDeleteError(toErrorMessage(error)),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">Create, edit, and remove transactions</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={openTransferDialog}
            disabled={accounts.length < 2 || categories.length === 0}
          >
            <IconArrowsExchange className="h-4 w-4" />
            Transfer
          </Button>
          <Button
            onClick={openCreateDialog}
            disabled={accounts.length === 0 || categories.length === 0}
          >
            <IconPlus className="h-4 w-4" />
            New transaction
          </Button>
        </div>
      </div>

      {accounts.length === 0 || categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add at least one account and one category before creating transactions.
        </p>
      ) : null}

      <div className="space-y-3">
        <SearchBar />
        <FilterPanel />
        <FilterChips />
      </div>

      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading transactions...</p>
          ) : listQuery.isError ? (
            <p className="p-6 text-sm text-destructive">{toErrorMessage(listQuery.error)}</p>
          ) : transactions.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div>
              {dayGroups.map((dayGroup) => (
                <section key={dayGroup.dayKey} className="border-b last:border-b-0">
                  <header className="flex items-baseline justify-between gap-4 border-b bg-muted/40 px-6 py-2">
                    <h2 className="text-sm font-medium">{dayGroup.dayLabel}</h2>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatDayNet(dayGroup.netByCurrency)}
                    </span>
                  </header>
                  <ul className="divide-y">
                    {dayGroup.transactions.map((transaction) => (
                      <TransactionListItem
                        key={transaction.id}
                        transaction={transaction}
                        accountName={
                          accountNameById.get(transaction.account_id) ?? transaction.account_id
                        }
                        categoryName={
                          categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
                        }
                        onEdit={openEditDialog}
                        onDuplicate={openDuplicateDialog}
                        onDelete={openDeleteDialog}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canLoadMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => setLimit((previousLimit) => previousLimit + PAGE_SIZE)}
            disabled={listQuery.isFetching}
          >
            {listQuery.isFetching ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      ) : null}

      {isCapReached ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing the first {MAX_LOADED_TRANSACTIONS} transactions. Refine the filters to narrow
          the results.
        </p>
      ) : null}

      <ConfirmDialog
        open={deletingTransaction !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingTransaction(null)
        }}
        title="Delete transaction?"
        description={
          deletingTransaction
            ? `"${deletingTransaction.description}" will be permanently removed.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        isPending={deleteTransaction.isPending}
        errorMessage={deleteError}
      />

      <TransactionFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        accounts={accounts}
        categories={categories}
        transaction={editingTransaction}
        template={duplicatingTransaction}
        isSubmitting={createTransaction.isPending || updateTransaction.isPending}
        errorMessage={formError}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
      />

      <TransferFormDialog
        open={isTransferOpen}
        onOpenChange={setIsTransferOpen}
        accounts={accounts}
        categories={categories}
        isSubmitting={createTransfer.isPending}
        errorMessage={transferError}
        onSubmit={handleTransfer}
      />
    </div>
  )
}
