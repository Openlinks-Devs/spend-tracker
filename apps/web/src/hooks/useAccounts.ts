import { accountsApi } from '@/lib/api'
import type { Account, AccountUpdate, NewAccount } from '@/types'
import { createResourceHooks } from './createResourceHooks'

const accountHooks = createResourceHooks<Account, NewAccount, AccountUpdate>('accounts', accountsApi)

export const useAccounts = accountHooks.useList
export const useCreateAccount = accountHooks.useCreate
export const useUpdateAccount = accountHooks.useUpdate
export const useDeleteAccount = accountHooks.useRemove
