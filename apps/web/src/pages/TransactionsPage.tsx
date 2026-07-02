import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TransactionFormDialog } from '@/components/transactions/TransactionFormDialog'
import {
  useCreateTransaction,
  useDeleteTransaction,
  useTransactions,
  useUpdateTransaction,
} from '@/hooks/useTransactions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import type { NewTransaction, Transaction, TransactionUpdate } from '@/types'

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong'
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
  const [formError, setFormError] = useState<string | null>(null)

  const accounts = accountsQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const transactions = transactionsQuery.data ?? []

  const accountNameById = useMemo(() => {
    const lookup = new Map<string, string>()
    for (const account of accounts) {
      lookup.set(account.id, account.name)
    }
    return lookup
  }, [accounts])

  const categoryNameById = useMemo(() => {
    const lookup = new Map<string, string>()
    for (const category of categories) {
      lookup.set(category.id, category.name)
    }
    return lookup
  }, [categories])

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
      { transactionId, payload },
      {
        onSuccess: () => setIsDialogOpen(false),
        onError: (error) => setFormError(toErrorMessage(error)),
      },
    )
  }

  function handleDelete(transaction: Transaction) {
    const confirmed = window.confirm(`Delete transaction "${transaction.description}"?`)
    if (!confirmed) return
    deleteTransaction.mutate(transaction.id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">Create, edit, and remove transactions</p>
        </div>
        <Button onClick={openCreateDialog} disabled={accounts.length === 0 || categories.length === 0}>
          <Plus className="h-4 w-4" />
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="font-medium">{transaction.description}</TableCell>
                    <TableCell>
                      {accountNameById.get(transaction.account_id) ?? transaction.account_id}
                    </TableCell>
                    <TableCell>
                      {transaction.category_id
                        ? categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
                        : 'Uncategorized'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {transaction.tags.length > 0 ? transaction.tags.join(', ') : '-'}
                    </TableCell>
                    <TableCell>{formatDate(transaction.created_at)}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(transaction.amount) || 0, transaction.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(transaction)}
                          aria-label="Edit transaction"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(transaction)}
                          aria-label="Delete transaction"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
