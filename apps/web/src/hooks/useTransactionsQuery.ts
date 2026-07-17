import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { transactionsAnalyticsApi, type TransactionListPage } from '@/lib/api'
import { toListRequestParams, type TransactionFilterState } from '@/lib/filterParams'

export function useTransactionsQuery(filters: TransactionFilterState, page: TransactionListPage) {
  const queryString = toListRequestParams(filters).toString()
  return useQuery({
    queryKey: ['transactions', 'list', queryString, page.limit, page.offset, page.sort],
    queryFn: () => transactionsAnalyticsApi.listFiltered(filters, page),
    placeholderData: keepPreviousData,
  })
}
