import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { IconPlus } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FilterBar } from '@/components/transactions/FilterBar'
import { TransactionFormDialog } from '@/components/transactions/TransactionFormDialog'
import { TransactionListItem } from '@/components/transactions/TransactionListItem'
import { TransactionTotalsBar } from '@/components/transactions/TransactionTotalsBar'
import {
  useCreateTransaction,
  useDeleteTransaction,
  useTransactionsInfinite,
  useUpdateTransaction,
} from '@/hooks/useTransactions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useCurrencies } from '@/hooks/useCurrencies'
import { useSettings } from '@/hooks/useSettings'
import { filtersToSearchParams, searchParamsToFilters } from '@/lib/filterParams'
import { toNameById } from '@/lib/utils'
import { groupTransactionsByDay } from '@/lib/groupTransactions'
import { toErrorMessage } from '@/lib/api'
import type { NewTransaction, Transaction, TransactionFilters, TransactionUpdate } from '@/types'

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => searchParamsToFilters(searchParams), [searchParams])

  function applyFilters(nextFilters: TransactionFilters) {
    setSearchParams(filtersToSearchParams(nextFilters), { replace: true })
  }

  const transactionsQuery = useTransactionsInfinite(filters)
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()
  const currenciesQuery = useCurrencies()
  const settingsQuery = useSettings()

  const createTransaction = useCreateTransaction()
  const updateTransaction = useUpdateTransaction()
  const deleteTransaction = useDeleteTransaction()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const accounts = accountsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const currencies = currenciesQuery.data ?? []
  const baseCurrencyCode = settingsQuery.data?.base_currency_code ?? 'PEN'

  const items = useMemo(
    () => transactionsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [transactionsQuery.data],
  )
  const totals = transactionsQuery.data?.pages[0]?.totals ?? null

  const accountNameById = useMemo(() => toNameById(accounts), [accounts])
  const categoryNameById = useMemo(() => toNameById(categories), [categories])

  const existingPayees = useMemo(() => {
    const seen = new Set<string>()
    for (const transaction of items) {
      if (transaction.payee) seen.add(transaction.payee)
    }
    return Array.from(seen).sort()
  }, [items])

  // Most recent transaction per payee wins: items are already ordered
  // newest first (occurred_at desc), so the first category_id seen for a
  // payee is kept and later, older duplicates are skipped.
  const payeeCategoryHistory = useMemo(() => {
    const history: Record<string, string> = {}
    for (const transaction of items) {
      if (transaction.payee && transaction.category_id && !(transaction.payee in history)) {
        history[transaction.payee] = transaction.category_id
      }
    }
    return history
  }, [items])

  const dayGroups = useMemo(() => groupTransactionsByDay(items), [items])

  function openCreateDialog() {
    setEditingTransaction(null)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(transaction: Transaction) {
    setEditingTransaction(transaction)
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
        <Button onClick={openCreateDialog} disabled={accounts.length === 0}>
          <IconPlus className="h-4 w-4" />
          New transaction
        </Button>
      </div>

      <FilterBar
        filters={filters}
        onChange={applyFilters}
        accounts={accounts}
        categories={categories}
        currencies={currencies}
      />

      <TransactionTotalsBar totals={totals} baseCurrencyCode={baseCurrencyCode} />

      <Card>
        <CardContent className="p-0">
          {transactionsQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading transactions...</p>
          ) : transactionsQuery.isError ? (
            <p className="p-6 text-sm text-destructive">
              {toErrorMessage(transactionsQuery.error)}
            </p>
          ) : items.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No transactions match these filters.</p>
          ) : (
            <div>
              {dayGroups.map((dayGroup) => (
                <section key={dayGroup.dayKey} className="border-b last:border-b-0">
                  <header className="border-b bg-muted/40 px-6 py-2">
                    <h2 className="text-sm font-medium">{dayGroup.dayLabel}</h2>
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
                          transaction.category_id
                            ? categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
                            : 'Uncategorized'
                        }
                        baseCurrencyCode={baseCurrencyCode}
                        toAccountName={
                          transaction.to_account_id
                            ? accountNameById.get(transaction.to_account_id) ?? transaction.to_account_id
                            : undefined
                        }
                        onEdit={openEditDialog}
                        onDelete={openDeleteDialog}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {transactionsQuery.hasNextPage ? (
                <div className="flex justify-center p-4">
                  <Button
                    type="button"
                    variant="outline"
                    loading={transactionsQuery.isFetchingNextPage}
                    onClick={() => transactionsQuery.fetchNextPage()}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

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
        existingPayees={existingPayees}
        payeeCategoryHistory={payeeCategoryHistory}
        transaction={editingTransaction}
        isSubmitting={createTransaction.isPending || updateTransaction.isPending}
        errorMessage={formError}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
