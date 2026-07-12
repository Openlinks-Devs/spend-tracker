import { useEffect, useMemo, useState, type FormEvent } from 'react'
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
import { useCurrencies } from '@/hooks/useCurrencies'
import { useSettings } from '@/hooks/useSettings'
import { cn, toDatetimeLocalValue } from '@/lib/utils'
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
  existingPayees: string[]
  payeeCategoryHistory: Record<string, string>
  transaction: Transaction | null
  isSubmitting: boolean
  errorMessage: string | null
  onCreate: (payload: NewTransaction) => void
  onUpdate: (transactionId: string, payload: TransactionUpdate) => void
}

interface TransactionFormState {
  type: TransactionType
  description: string
  amount: string
  currency: string
  accountId: string
  categoryId: string
  toAccountId: string
  toAmount: string
  payee: string
  notes: string
  baseAmount: string
  tags: string
  date: string
}

const typeOptions: { value: TransactionType; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

const textareaClassName =
  'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

function parseTags(rawTags: string): string[] {
  return rawTags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

function firstCategoryIdForType(categories: Category[], type: TransactionType): string {
  return categories.find((category) => category.type === type)?.id ?? ''
}

export function TransactionFormDialog({
  open,
  onOpenChange,
  accounts,
  categories,
  existingPayees,
  payeeCategoryHistory,
  transaction,
  isSubmitting,
  errorMessage,
  onCreate,
  onUpdate,
}: TransactionFormDialogProps) {
  const isEditing = transaction !== null
  const currenciesQuery = useCurrencies()
  const settingsQuery = useSettings()
  const currencies = currenciesQuery.data ?? []
  const baseCurrencyCode = settingsQuery.data?.base_currency_code ?? 'PEN'

  const [formState, setFormState] = useState<TransactionFormState>(() => ({
    type: 'expense',
    description: '',
    amount: '',
    currency: 'PEN',
    accountId: '',
    categoryId: '',
    toAccountId: '',
    toAmount: '',
    payee: '',
    notes: '',
    baseAmount: '',
    tags: '',
    date: '',
  }))

  useEffect(() => {
    if (!open) return
    if (transaction) {
      setFormState({
        type: transaction.type,
        description: transaction.description,
        amount: String(Math.abs(transaction.amount ?? 0)),
        currency: transaction.currency,
        accountId: transaction.account_id,
        categoryId: transaction.category_id ?? '',
        toAccountId: transaction.to_account_id ?? '',
        toAmount: transaction.to_amount !== null ? String(Math.abs(transaction.to_amount)) : '',
        payee: transaction.payee ?? '',
        notes: transaction.notes ?? '',
        baseAmount:
          transaction.base_amount !== null ? String(Math.abs(transaction.base_amount)) : '',
        tags: transaction.tags.join(', '),
        date: toDatetimeLocalValue(transaction.occurred_at),
      })
    } else {
      const firstAccount = accounts[0]
      setFormState({
        type: 'expense',
        description: '',
        amount: '',
        currency: firstAccount?.currency ?? 'PEN',
        accountId: firstAccount?.id ?? '',
        categoryId: firstCategoryIdForType(categories, 'expense'),
        toAccountId: '',
        toAmount: '',
        payee: '',
        notes: '',
        baseAmount: '',
        tags: '',
        date: toDatetimeLocalValue(new Date()),
      })
    }
  }, [open, transaction, accounts, categories])

  const categoriesForType = useMemo(
    () => categories.filter((category) => category.type === formState.type),
    [categories, formState.type],
  )

  const destinationAccounts = useMemo(
    () => accounts.filter((account) => account.id !== formState.accountId),
    [accounts, formState.accountId],
  )

  const isTransfer = formState.type === 'transfer'
  const isForeign = formState.currency !== baseCurrencyCode

  function handleTypeChange(nextType: TransactionType) {
    setFormState((current) => ({
      ...current,
      type: nextType,
      categoryId:
        nextType === 'transfer' ? '' : firstCategoryIdForType(categories, nextType),
      toAccountId: nextType === 'transfer' ? current.toAccountId : '',
      toAmount: nextType === 'transfer' ? current.toAmount : '',
    }))
  }

  function handleAccountChange(nextAccountId: string) {
    const nextAccount = accounts.find((account) => account.id === nextAccountId)
    setFormState((current) => ({
      ...current,
      accountId: nextAccountId,
      currency: nextAccount?.currency ?? current.currency,
      toAccountId: current.toAccountId === nextAccountId ? '' : current.toAccountId,
    }))
  }

  function handleDestinationAccountChange(nextAccountId: string) {
    const destination = accounts.find((account) => account.id === nextAccountId)
    setFormState((current) => ({
      ...current,
      toAccountId: nextAccountId,
      // Same-currency transfers just repeat the amount, per the transfer contract.
      toAmount:
        destination && destination.currency === current.currency && current.amount
          ? current.amount
          : current.toAmount,
    }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const occurredAt = formState.date ? new Date(formState.date).toISOString() : undefined
    const amount = Math.abs(Number(formState.amount))
    const baseAmountOverride =
      isForeign && formState.baseAmount.trim() !== ''
        ? Math.abs(Number(formState.baseAmount))
        : undefined
    const common = {
      description: formState.description,
      amount,
      currency: formState.currency,
      account_id: formState.accountId,
      type: formState.type,
      tags: parseTags(formState.tags),
      payee: formState.payee.trim() || null,
      notes: formState.notes.trim() || null,
      occurred_at: occurredAt,
      base_amount: baseAmountOverride,
    }
    const payload: NewTransaction = isTransfer
      ? {
          ...common,
          category_id: null,
          to_account_id: formState.toAccountId,
          to_amount: Math.abs(Number(formState.toAmount)),
        }
      : { ...common, category_id: formState.categoryId }

    if (isEditing && transaction) {
      onUpdate(transaction.id, payload)
      return
    }
    onCreate(payload)
  }

  const missingDestination =
    isTransfer && (!formState.toAccountId || !formState.toAmount)
  const missingCategory = !isTransfer && !formState.categoryId
  const submitDisabled = !formState.accountId || missingDestination || missingCategory

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit transaction' : 'New transaction'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update any detail of this transaction.'
              : 'Record an expense, income, or transfer.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-1 rounded-md border p-1" role="group" aria-label="Transaction type">
            {typeOptions.map((typeOption) => (
              <Button
                key={typeOption.value}
                type="button"
                variant={formState.type === typeOption.value ? 'default' : 'ghost'}
                size="sm"
                className="flex-1"
                aria-pressed={formState.type === typeOption.value}
                onClick={() => handleTypeChange(typeOption.value)}
              >
                {typeOption.label}
              </Button>
            ))}
          </div>

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
                min="0"
                value={formState.amount}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, amount: event.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transaction-currency">Currency</Label>
              <Select
                value={formState.currency}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, currency: value }))
                }
              >
                <SelectTrigger id="transaction-currency" aria-label="Currency">
                  <SelectValue placeholder="Currency" />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code}>
                      {currency.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transaction-account">Account</Label>
            <Select value={formState.accountId} onValueChange={handleAccountChange}>
              <SelectTrigger id="transaction-account" aria-label="Account">
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

          {isTransfer ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="transaction-destination-account">Destination account</Label>
                <Select
                  value={formState.toAccountId}
                  onValueChange={handleDestinationAccountChange}
                >
                  <SelectTrigger
                    id="transaction-destination-account"
                    aria-label="Destination account"
                  >
                    <SelectValue placeholder="Select an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {destinationAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transaction-destination-amount">Destination amount</Label>
                <Input
                  id="transaction-destination-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.toAmount}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, toAmount: event.target.value }))
                  }
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="transaction-category">Category</Label>
              <Select
                key={formState.type}
                value={formState.categoryId}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, categoryId: value }))
                }
              >
                <SelectTrigger id="transaction-category" aria-label="Category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categoriesForType.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="transaction-payee">Payee</Label>
            <Input
              id="transaction-payee"
              list="transaction-payee-options"
              value={formState.payee}
              onChange={(event) => {
                const nextPayee = event.target.value
                setFormState((current) => {
                  // Pre-fill the last category used for this payee when the
                  // typed or selected value exactly matches a known payee.
                  // Transfers have no category field, so leave those alone.
                  const lastCategoryId = payeeCategoryHistory[nextPayee]
                  return {
                    ...current,
                    payee: nextPayee,
                    categoryId:
                      current.type !== 'transfer' && lastCategoryId
                        ? lastCategoryId
                        : current.categoryId,
                  }
                })
              }}
              placeholder="Merchant name"
            />
            <datalist id="transaction-payee-options">
              {existingPayees.map((payee) => (
                <option key={payee} value={payee} />
              ))}
            </datalist>
          </div>

          {isForeign ? (
            <div className="space-y-2">
              <Label htmlFor="transaction-base-amount">
                Amount in {baseCurrencyCode} (override)
              </Label>
              <Input
                id="transaction-base-amount"
                type="number"
                step="0.01"
                min="0"
                value={formState.baseAmount}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, baseAmount: event.target.value }))
                }
                placeholder="Leave blank to convert automatically"
              />
              {isEditing &&
              transaction &&
              transaction.base_amount !== null &&
              transaction.currency !== baseCurrencyCode ? (
                <p className="text-xs text-muted-foreground">
                  {baseCurrencyCode} {Math.abs(transaction.base_amount).toFixed(2)} at{' '}
                  {transaction.rate_used}
                </p>
              ) : null}
            </div>
          ) : null}

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

          <div className="space-y-2">
            <Label htmlFor="transaction-notes">Notes</Label>
            <textarea
              id="transaction-notes"
              className={cn(textareaClassName)}
              value={formState.notes}
              onChange={(event) =>
                setFormState((current) => ({ ...current, notes: event.target.value }))
              }
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
            <Button type="submit" loading={isSubmitting} disabled={submitDisabled}>
              {isEditing ? 'Save changes' : 'Create transaction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
