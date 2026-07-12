import { useEffect, useState, type FormEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toDatetimeLocalValue } from '@/lib/utils'
import type {
  Account,
  Category,
  NewTransaction,
  Transaction,
  TransactionType,
  TransactionUpdate,
} from '@/types'

interface TransactionFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: Account[]
  categories: Category[]
  transaction: Transaction | null
  isSubmitting: boolean
  errorMessage: string | null
  onCreate: (payload: NewTransaction) => void
  onUpdate: (transactionId: string, payload: TransactionUpdate) => void
}

interface TransactionFormState {
  description: string
  amount: string
  currency: string
  accountId: string
  categoryId: string
  tags: string
  date: string
}

const emptyFormState: TransactionFormState = {
  description: '',
  amount: '',
  currency: 'USD',
  accountId: '',
  categoryId: '',
  tags: '',
  date: '',
}

function parseTags(rawTags: string): string[] {
  return rawTags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

export function TransactionFormDialog({
  open,
  onOpenChange,
  accounts,
  categories,
  transaction,
  isSubmitting,
  errorMessage,
  onCreate,
  onUpdate,
}: TransactionFormDialogProps) {
  const isEditing = transaction !== null
  const [formState, setFormState] = useState<TransactionFormState>(emptyFormState)

  useEffect(() => {
    if (!open) return
    if (transaction) {
      setFormState({
        description: transaction.description,
        amount: String(transaction.amount ?? ''),
        currency: transaction.currency,
        accountId: transaction.account_id,
        categoryId: transaction.category_id ?? '',
        tags: transaction.tags.join(', '),
        date: toDatetimeLocalValue(transaction.occurred_at),
      })
    } else {
      setFormState({
        ...emptyFormState,
        accountId: accounts[0]?.id ?? '',
        categoryId: categories[0]?.id ?? '',
        currency: accounts[0]?.currency ?? 'USD',
        date: toDatetimeLocalValue(new Date()),
      })
    }
  }, [open, transaction, accounts, categories])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const occurredAt = formState.date ? new Date(formState.date).toISOString() : undefined
    const signedAmount = Number(formState.amount)
    const bridgeType: TransactionType = signedAmount >= 0 ? 'income' : 'expense'
    const payload = {
      description: formState.description,
      amount: Math.abs(signedAmount),
      currency: formState.currency,
      account_id: formState.accountId,
      category_id: formState.categoryId,
      tags: parseTags(formState.tags),
      type: bridgeType,
      occurred_at: occurredAt,
    }
    if (isEditing && transaction) {
      onUpdate(transaction.id, payload)
      return
    }
    onCreate(payload)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit transaction' : 'New transaction'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update any detail of this transaction.'
              : 'Record a new transaction with amount, account, and category.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="transaction-description">Description</Label>
            <Input
              id="transaction-description"
              value={formState.description}
              onChange={(event) =>
                setFormState((current) => ({ ...current, description: event.target.value }))
              }
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="transaction-amount">Amount</Label>
              <Input
                id="transaction-amount"
                type="number"
                step="0.01"
                value={formState.amount}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, amount: event.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transaction-currency">Currency</Label>
              <Input
                id="transaction-currency"
                value={formState.currency}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    currency: event.target.value.toUpperCase(),
                  }))
                }
                required
                maxLength={3}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transaction-account">Account</Label>
            <Select
              value={formState.accountId}
              onValueChange={(value) =>
                setFormState((current) => ({ ...current, accountId: value }))
              }
            >
              <SelectTrigger id="transaction-account">
                <SelectValue placeholder="Select an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transaction-category">Category</Label>
            <Select
              value={formState.categoryId}
              onValueChange={(value) =>
                setFormState((current) => ({ ...current, categoryId: value }))
              }
            >
              <SelectTrigger id="transaction-category">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transaction-date">Date</Label>
            <DateTimePicker
              id="transaction-date"
              value={formState.date}
              onChange={(date) => setFormState((current) => ({ ...current, date }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="transaction-tags">Tags</Label>
            <Input
              id="transaction-tags"
              value={formState.tags}
              onChange={(event) =>
                setFormState((current) => ({ ...current, tags: event.target.value }))
              }
              placeholder="Comma separated, for example: groceries, monthly"
            />
          </div>

          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={!formState.categoryId || !formState.accountId}
            >
              {isEditing ? 'Save changes' : 'Create transaction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
