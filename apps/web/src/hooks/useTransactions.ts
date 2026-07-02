import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { transactionsApi } from '@/lib/api'
import type { NewTransaction, TransactionUpdate } from '@/types'

const transactionsKey = ['transactions'] as const

export function useTransactions() {
  return useQuery({
    queryKey: transactionsKey,
    queryFn: transactionsApi.list,
  })
}

export function useCreateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: NewTransaction) => transactionsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionsKey })
    },
  })
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ transactionId, payload }: { transactionId: string; payload: TransactionUpdate }) =>
      transactionsApi.update(transactionId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionsKey })
    },
  })
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (transactionId: string) => transactionsApi.remove(transactionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionsKey })
    },
  })
}
