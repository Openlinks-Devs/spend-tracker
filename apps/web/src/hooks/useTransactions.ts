import { transactionsApi } from '@/lib/api'
import type { NewTransaction, Transaction, TransactionUpdate } from '@/types'
import { createResourceHooks } from './createResourceHooks'

const transactionHooks = createResourceHooks<Transaction, NewTransaction, TransactionUpdate>(
  'transactions',
  transactionsApi,
)

export const useTransactions = transactionHooks.useList
export const useCreateTransaction = transactionHooks.useCreate
export const useUpdateTransaction = transactionHooks.useUpdate
export const useDeleteTransaction = transactionHooks.useRemove
