import { useInfiniteQuery } from '@tanstack/react-query'
import { listTransactionsPage, transactionsApi } from '@/lib/api'
import type { NewTransaction, Transaction, TransactionFilters, TransactionUpdate } from '@/types'
import { createResourceHooks } from './createResourceHooks'

const transactionHooks = createResourceHooks<Transaction, NewTransaction, TransactionUpdate>(
  'transactions',
  transactionsApi,
)

export const useTransactions = transactionHooks.useList
export const useCreateTransaction = transactionHooks.useCreate
export const useUpdateTransaction = transactionHooks.useUpdate
export const useDeleteTransaction = transactionHooks.useRemove

// Cursor-paginated ledger. The key starts with 'transactions' so the CRUD
// mutations above invalidate these pages too.
export function useTransactionsInfinite(filters: TransactionFilters) {
  return useInfiniteQuery({
    queryKey: ['transactions', 'infinite', filters],
    queryFn: ({ pageParam }) => listTransactionsPage(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  })
}
