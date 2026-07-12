import { useEffect, useState, type FormEvent } from 'react'
import { IconPlus, IconPencil, IconTrash } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useAccounts,
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
} from '@/hooks/useAccounts'
import { useCurrencies } from '@/hooks/useCurrencies'
import { useSettings } from '@/hooks/useSettings'
import { toErrorMessage } from '@/lib/api'
import type { Account } from '@/types'

interface AccountFormState {
  name: string
  type: string
  currency: string
}

export function AccountsPage() {
  const accountsQuery = useAccounts()
  const currenciesQuery = useCurrencies()
  const settingsQuery = useSettings()
  const createAccount = useCreateAccount()
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [formState, setFormState] = useState<AccountFormState>({
    name: '',
    type: 'checking',
    currency: 'PEN',
  })
  const [formError, setFormError] = useState<string | null>(null)

  const accounts = accountsQuery.data ?? []
  const currencies = currenciesQuery.data ?? []
  const baseCurrencyCode = settingsQuery.data?.base_currency_code ?? 'PEN'
  const isEditing = editingAccount !== null

  useEffect(() => {
    if (!isDialogOpen) return
    if (editingAccount) {
      setFormState({
        name: editingAccount.name,
        type: editingAccount.type,
        currency: editingAccount.currency,
      })
    } else {
      setFormState({ name: '', type: 'checking', currency: baseCurrencyCode })
    }
    // baseCurrencyCode only needs to seed the form the moment the dialog opens
    // for a new account, not while the user is editing the currency field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDialogOpen, editingAccount])

  function openCreateDialog() {
    setEditingAccount(null)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(account: Account) {
    setEditingAccount(account)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    if (isEditing && editingAccount) {
      updateAccount.mutate(
        { id: editingAccount.id, payload: formState },
        {
          onSuccess: () => setIsDialogOpen(false),
          onError: (error) => setFormError(toErrorMessage(error)),
        },
      )
      return
    }
    createAccount.mutate(formState, {
      onSuccess: () => setIsDialogOpen(false),
      onError: (error) => setFormError(toErrorMessage(error)),
    })
  }

  function openDeleteDialog(account: Account) {
    setDeleteError(null)
    setDeletingAccount(account)
  }

  function handleConfirmDelete() {
    if (!deletingAccount) return
    setDeleteError(null)
    deleteAccount.mutate(deletingAccount.id, {
      onSuccess: () => setDeletingAccount(null),
      onError: (error) => setDeleteError(toErrorMessage(error)),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">Manage the accounts you track</p>
        </div>
        <Button onClick={openCreateDialog}>
          <IconPlus className="h-4 w-4" />
          New account
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {accountsQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading accounts...</p>
          ) : accountsQuery.isError ? (
            <p className="p-6 text-sm text-destructive">{toErrorMessage(accountsQuery.error)}</p>
          ) : accounts.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <ul className="divide-y">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-4 px-6 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{account.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {account.type} · {account.currency}
                    </p>
                  </div>
                  <div className="-mr-2 flex shrink-0 gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openEditDialog(account)}
                      aria-label="Edit account"
                    >
                      <IconPencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openDeleteDialog(account)}
                      aria-label="Delete account"
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deletingAccount !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingAccount(null)
        }}
        title="Delete account?"
        description={
          deletingAccount ? `"${deletingAccount.name}" will be permanently removed.` : ''
        }
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        isPending={deleteAccount.isPending}
        errorMessage={deleteError}
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit account' : 'New account'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update the account details.' : 'Add an account to track transactions.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account-name">Name</Label>
              <Input
                id="account-name"
                value={formState.name}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="account-type">Type</Label>
                <Input
                  id="account-type"
                  value={formState.type}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, type: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-currency">Currency</Label>
                <Select
                  value={formState.currency}
                  onValueChange={(value) =>
                    setFormState((current) => ({ ...current, currency: value }))
                  }
                >
                  <SelectTrigger id="account-currency" aria-label="Currency">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((currency) => (
                      <SelectItem key={currency.code} value={currency.code}>
                        {currency.code} - {currency.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={createAccount.isPending || updateAccount.isPending}
                onClick={() => setIsDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={createAccount.isPending || updateAccount.isPending}>
                {isEditing ? 'Save changes' : 'Create account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
