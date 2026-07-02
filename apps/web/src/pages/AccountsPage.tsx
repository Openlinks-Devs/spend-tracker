import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useAccounts,
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
} from '@/hooks/useAccounts'
import { ApiError } from '@/lib/api'
import type { Account } from '@/types'

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}

interface AccountFormState {
  name: string
  type: string
  currency: string
}

const emptyFormState: AccountFormState = { name: '', type: 'checking', currency: 'USD' }

export function AccountsPage() {
  const accountsQuery = useAccounts()
  const createAccount = useCreateAccount()
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [formState, setFormState] = useState<AccountFormState>(emptyFormState)
  const [formError, setFormError] = useState<string | null>(null)

  const accounts = accountsQuery.data ?? []
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
      setFormState(emptyFormState)
    }
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
        { accountId: editingAccount.id, payload: formState },
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

  function handleDelete(account: Account) {
    const confirmed = window.confirm(`Delete account "${account.name}"?`)
    if (!confirmed) return
    deleteAccount.mutate(account.id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">Manage the accounts you track</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">{account.name}</TableCell>
                    <TableCell>{account.type}</TableCell>
                    <TableCell>{account.currency}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(account)}
                          aria-label="Edit account"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(account)}
                          aria-label="Delete account"
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
                <Input
                  id="account-currency"
                  value={formState.currency}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      currency: event.target.value.toUpperCase(),
                    }))
                  }
                  maxLength={3}
                  required
                />
              </div>
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createAccount.isPending || updateAccount.isPending}>
                {createAccount.isPending || updateAccount.isPending
                  ? 'Saving...'
                  : isEditing
                    ? 'Save changes'
                    : 'Create account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
