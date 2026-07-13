import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { transactionsAnalyticsApi } from '@/lib/api'
import { toRequestParams, type TransactionFilterState } from '@/lib/filterParams'

export function useTransactionAnalytics(filters: TransactionFilterState, bucket: 'day' | 'week' | 'month') {
  const queryString = toRequestParams(filters).toString()
  return useQuery({
    queryKey: ['transactions', 'analytics', bucket, queryString],
    queryFn: () => transactionsAnalyticsApi.analytics(filters, bucket),
    placeholderData: keepPreviousData,
  })
}
