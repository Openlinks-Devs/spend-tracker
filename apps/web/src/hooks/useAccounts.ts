import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accountsApi } from '@/lib/api'
import type { AccountUpdate, NewAccount } from '@/types'

const accountsKey = ['accounts'] as const

export function useAccounts() {
  return useQuery({
    queryKey: accountsKey,
    queryFn: accountsApi.list,
  })
}

export function useCreateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: NewAccount) => accountsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountsKey })
    },
  })
}

export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, payload }: { accountId: string; payload: AccountUpdate }) =>
      accountsApi.update(accountId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountsKey })
    },
  })
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (accountId: string) => accountsApi.remove(accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountsKey })
    },
  })
}
