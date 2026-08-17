import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { emailsApi, type EmailListPage } from '@/lib/api'

/**
 * The processed-email log, newest first.
 *
 * The page is part of the query key, and `keepPreviousData` keeps the current
 * rows on screen while a wider page loads, matching useTransactionsQuery.
 */
export function useEmails(page: EmailListPage) {
  return useQuery({
    queryKey: ['emails', 'list', page.limit, page.offset],
    queryFn: () => emailsApi.list(page),
    placeholderData: keepPreviousData,
  })
}
