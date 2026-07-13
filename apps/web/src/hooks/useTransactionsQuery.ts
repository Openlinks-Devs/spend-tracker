import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { transactionsAnalyticsApi, type TransactionListPage } from '@/lib/api'
import { toRequestParams, type TransactionFilterState } from '@/lib/filterParams'

export function useTransactionsQuery(filters: TransactionFilterState, page: TransactionListPage) {
  const queryString = toRequestParams(filters).toString()
  return useQuery({
    queryKey: ['transactions', 'list', queryString, page.limit, page.offset, page.sort],
    queryFn: () => transactionsAnalyticsApi.listFiltered(filters, page),
    placeholderData: keepPreviousData,
  })
}
