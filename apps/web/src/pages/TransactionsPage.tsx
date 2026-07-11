import { useMemo, useState } from 'react'
import { IconPlus } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TransactionFormDialog } from '@/components/transactions/TransactionFormDialog'
import { TransactionListItem } from '@/components/transactions/TransactionListItem'
import {
  useCreateTransaction,
  useDeleteTransaction,
  useTransactions,
  useUpdateTransaction,
} from '@/hooks/useTransactions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { formatCurrency, formatDayLabel, toDayKey, toNameById } from '@/lib/utils'
import { toErrorMessage } from '@/lib/api'
import type { NewTransaction, Transaction, TransactionUpdate } from '@/types'

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
  const transactionsQuery = useTransactions()
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()

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
  const transactions = transactionsQuery.data ?? []

  const accountNameById = useMemo(() => toNameById(accounts), [accounts])

  const categoryNameById = useMemo(() => toNameById(categories), [categories])

  const dayGroups = useMemo(() => groupTransactionsByDay(transactions), [transactions])

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
        <Button onClick={openCreateDialog} disabled={accounts.length === 0 || categories.length === 0}>
          <IconPlus className="h-4 w-4" />
          New transaction
        </Button>
      </div>

      {accounts.length === 0 || categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add at least one account and one category before creating transactions.
        </p>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {transactionsQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading transactions...</p>
          ) : transactionsQuery.isError ? (
            <p className="p-6 text-sm text-destructive">
              {toErrorMessage(transactionsQuery.error)}
            </p>
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
        isSubmitting={createTransaction.isPending || updateTransaction.isPending}
        errorMessage={formError}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
