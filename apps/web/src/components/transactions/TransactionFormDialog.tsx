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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Account, Category, NewTransaction, Transaction, TransactionUpdate } from '@/types'

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
}

const emptyFormState: TransactionFormState = {
  description: '',
  amount: '',
  currency: 'USD',
  accountId: '',
  categoryId: '',
  tags: '',
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
        categoryId: transaction.category_id,
        tags: transaction.tags.join(', '),
      })
    } else {
      setFormState({
        ...emptyFormState,
        accountId: accounts[0]?.id ?? '',
        categoryId: categories[0]?.id ?? '',
        currency: accounts[0]?.currency ?? 'USD',
      })
    }
  }, [open, transaction, accounts, categories])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isEditing && transaction) {
      onUpdate(transaction.id, {
        description: formState.description,
        category_id: formState.categoryId,
        tags: parseTags(formState.tags),
      })
      return
    }
    onCreate({
      description: formState.description,
      amount: Number(formState.amount),
      currency: formState.currency,
      account_id: formState.accountId,
      category_id: formState.categoryId,
      tags: parseTags(formState.tags),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit transaction' : 'New transaction'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the description, category, or tags for this transaction.'
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
                disabled={isEditing}
                required={!isEditing}
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
                disabled={isEditing}
                required={!isEditing}
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
              disabled={isEditing}
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

          {isEditing ? (
            <p className="text-sm text-muted-foreground">
              Amount, currency, and account cannot be changed after a transaction is created.
            </p>
          ) : null}

          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                !formState.categoryId ||
                (!isEditing && !formState.accountId)
              }
            >
              {isSubmitting ? 'Saving...' : isEditing ? 'Save changes' : 'Create transaction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
