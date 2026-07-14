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
import { toDatetimeLocalValue } from '@/lib/utils'
import type { Account, Category, TransferInput } from '@/types'

// A transfer defaults its two legs to the "Balance" categories: money leaves the
// source under "Balance -" and lands in the destination under "Balance +".
const OUT_CATEGORY_NAME = 'Balance -'
const IN_CATEGORY_NAME = 'Balance +'

interface TransferFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: Account[]
  categories: Category[]
  isSubmitting: boolean
  errorMessage: string | null
  onSubmit: (payload: TransferInput) => void
}

interface TransferFormState {
  fromAccountId: string
  toAccountId: string
  fromAmount: string
  toAmount: string
  fromCategoryId: string
  toCategoryId: string
  description: string
  tags: string
  date: string
}

const emptyFormState: TransferFormState = {
  fromAccountId: '',
  toAccountId: '',
  fromAmount: '',
  toAmount: '',
  fromCategoryId: '',
  toCategoryId: '',
  description: '',
  tags: 'transfer',
  date: '',
}

function parseTags(rawTags: string): string[] {
  return rawTags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

export function TransferFormDialog({
  open,
  onOpenChange,
  accounts,
  categories,
  isSubmitting,
  errorMessage,
  onSubmit,
}: TransferFormDialogProps) {
  const categoryIdByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const category of categories) map.set(category.name, category.id)
    return map
  }, [categories])
  const accountById = useMemo(() => {
    const map = new Map<string, Account>()
    for (const account of accounts) map.set(account.id, account)
    return map
  }, [accounts])

  const [formState, setFormState] = useState<TransferFormState>(emptyFormState)
  // Once the user edits the received amount, stop mirroring the sent amount into
  // it (same-currency transfers usually match; fees/exchange make them differ).
  const [receivedEdited, setReceivedEdited] = useState(false)

  useEffect(() => {
    if (!open) return
    setReceivedEdited(false)
    setFormState({
      fromAccountId: accounts[0]?.id ?? '',
      toAccountId: accounts[1]?.id ?? accounts[0]?.id ?? '',
      fromAmount: '',
      toAmount: '',
      fromCategoryId: categoryIdByName.get(OUT_CATEGORY_NAME) ?? categories[0]?.id ?? '',
      toCategoryId: categoryIdByName.get(IN_CATEGORY_NAME) ?? categories[0]?.id ?? '',
      description: '',
      tags: 'transfer',
      date: toDatetimeLocalValue(new Date()),
    })
  }, [open, accounts, categories, categoryIdByName])

  const fromAccount = accountById.get(formState.fromAccountId)
  const toAccount = accountById.get(formState.toAccountId)
  const fromCurrency = fromAccount?.currency ?? ''
  const toCurrency = toAccount?.currency ?? ''
  const sameAccount =
    Boolean(formState.fromAccountId) && formState.fromAccountId === formState.toAccountId
  const fromAmountValue = Number(formState.fromAmount)
  const toAmountValue = Number(formState.toAmount)
  const canSubmit =
    formState.fromAmount !== '' &&
    formState.toAmount !== '' &&
    fromAmountValue > 0 &&
    toAmountValue > 0 &&
    Boolean(formState.fromAccountId && formState.toAccountId) &&
    Boolean(formState.fromCategoryId && formState.toCategoryId) &&
    !sameAccount

  function updateSentAmount(value: string) {
    setFormState((current) => {
      const mirror = !receivedEdited && fromCurrency === toCurrency
      return { ...current, fromAmount: value, toAmount: mirror ? value : current.toAmount }
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!fromAccount || !toAccount || !canSubmit) return
    const createdAt = formState.date ? new Date(formState.date).toISOString() : undefined
    onSubmit({
      from_account_id: fromAccount.id,
      to_account_id: toAccount.id,
      from_amount: fromAmountValue,
      to_amount: toAmountValue,
      from_currency: fromCurrency,
      to_currency: toCurrency,
      from_category_id: formState.fromCategoryId,
      to_category_id: formState.toCategoryId,
      from_description: formState.description || `Transfer to ${toAccount.name}`,
      to_description: formState.description || `Transfer from ${fromAccount.name}`,
      tags: parseTags(formState.tags),
      created_at: createdAt,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer between accounts</DialogTitle>
          <DialogDescription>
            Records two transactions: money out of the source and into the destination. The amounts
            can differ (fees) and the currencies can differ (exchange).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="transfer-from-account">From account</Label>
              <Select
                value={formState.fromAccountId}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, fromAccountId: value }))
                }
              >
                <SelectTrigger id="transfer-from-account">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="transfer-to-account">To account</Label>
              <Select
                value={formState.toAccountId}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, toAccountId: value }))
                }
              >
                <SelectTrigger id="transfer-to-account">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {sameAccount ? (
            <p className="text-sm text-destructive">Pick two different accounts.</p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="transfer-from-amount">
                Amount sent{fromCurrency ? ` (${fromCurrency})` : ''}
              </Label>
              <Input
                id="transfer-from-amount"
                type="number"
                step="0.01"
                min="0"
                value={formState.fromAmount}
                onChange={(event) => updateSentAmount(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transfer-to-amount">
                Amount received{toCurrency ? ` (${toCurrency})` : ''}
              </Label>
              <Input
                id="transfer-to-amount"
                type="number"
                step="0.01"
                min="0"
                value={formState.toAmount}
                onChange={(event) => {
                  setReceivedEdited(true)
                  setFormState((current) => ({ ...current, toAmount: event.target.value }))
                }}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="transfer-from-category">Category (out)</Label>
              <Select
                value={formState.fromCategoryId}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, fromCategoryId: value }))
                }
              >
                <SelectTrigger id="transfer-from-category">
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
              <Label htmlFor="transfer-to-category">Category (in)</Label>
              <Select
                value={formState.toCategoryId}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, toCategoryId: value }))
                }
              >
                <SelectTrigger id="transfer-to-category">
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-date">Date</Label>
            <DateTimePicker
              id="transfer-date"
              value={formState.date}
              onChange={(date) => setFormState((current) => ({ ...current, date }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-description">Description (optional)</Label>
            <Input
              id="transfer-description"
              value={formState.description}
              onChange={(event) =>
                setFormState((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="Defaults to 'Transfer to/from {account}'"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-tags">Tags</Label>
            <Input
              id="transfer-tags"
              value={formState.tags}
              onChange={(event) =>
                setFormState((current) => ({ ...current, tags: event.target.value }))
              }
              placeholder="Comma separated"
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
            <Button type="submit" loading={isSubmitting} disabled={!canSubmit}>
              Create transfer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
