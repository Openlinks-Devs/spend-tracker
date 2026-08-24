import { keepPreviousData, useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
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

/**
 * Retry one failed email.
 *
 * The whole list is invalidated rather than the returned row patched into it:
 * a retry that imports the email creates a transaction, so the verdict, the
 * attempt count and the transaction link all change together, and the pages
 * currently on screen are keyed by limit.
 */
export function useRetryEmail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, messageId }: { connectionId: string; messageId: string }) =>
      emailsApi.retry(connectionId, messageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] })
      // An imported retry writes a transaction, so the lists that show it are
      // stale too.
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}
