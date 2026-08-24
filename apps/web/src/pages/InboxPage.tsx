import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useEmails, useRetryEmail } from '@/hooks/useEmails'
import { isMockMode } from '@/lib/appMode'
import { ApiError, toErrorMessage } from '@/lib/api'
import { cn, formatCurrency, formatDate, formatTime } from '@/lib/utils'
import type { EmailListResponse, EmailLogItem, EmailVerdict } from '@/types'

const PAGE_SIZE = 50
// GET /api/emails clamps limit to 200, so the growing-limit list tops out there.
const MAX_LOADED_EMAILS = 200

// Shared word for word with the Android client so the two surfaces describe the
// same outcome identically.
const VERDICT_LABELS: Record<EmailVerdict, string> = {
  imported: 'Imported',
  not_transaction: 'Not a transaction',
  not_configured: 'No accounts or categories set up',
  extract_failed: 'Could not read the details',
  failed: 'Processing failed',
  unknown: 'Unknown',
}

// Only a real processing failure is a problem the user can act on.
// `not_transaction` is the overwhelmingly common outcome, since the poller runs
// every arriving email through the detector, so it must read as routine.
//
// The same two verdicts are the retryable ones the backend accepts
// (RETRYABLE_VERDICTS in connections/retryEmail.ts), so a row that reads as a
// problem is exactly a row that offers the Retry button.
const PROBLEM_VERDICTS: ReadonlySet<EmailVerdict> = new Set<EmailVerdict>([
  'failed',
  'extract_failed',
])

// Backend reasons, turned into something the user can act on. Anything else
// falls back to the raw message from the API.
const RETRY_ERROR_MESSAGES: Record<string, string> = {
  connection_needs_reauth: 'Reconnect the Gmail account first.',
  verdict_not_retryable: 'This email can no longer be retried.',
  email_not_found: 'This email is no longer available.',
  retry_failed: 'The retry did not go through. Try again in a moment.',
}

function toRetryErrorMessage(error: unknown): string {
  const message = toErrorMessage(error)
  return RETRY_ERROR_MESSAGES[message] ?? message
}

function formatTimestamp(value: string): string {
  return `${formatDate(value)} at ${formatTime(value)}`
}

function EmailRow({ email }: { email: EmailLogItem }) {
  const isProblem = PROBLEM_VERDICTS.has(email.verdict)
  const retry = useRetryEmail()
  return (
    <li className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-0.5">
        {email.subject ? (
          <p className="truncate text-sm font-medium">{email.subject}</p>
        ) : (
          <p className="truncate text-sm font-medium text-muted-foreground">
            Subject no longer available
          </p>
        )}
        <p className="truncate text-xs text-muted-foreground">
          {email.sender ?? 'Sender no longer available'}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {email.account_email} ·{' '}
          {email.email_date ? formatTimestamp(email.email_date) : `Processed ${formatTimestamp(email.received_at)}`}
        </p>
      </div>
      <div className="shrink-0 space-y-0.5 sm:text-right">
        <p className={cn('text-xs font-medium', isProblem ? 'text-destructive' : 'text-muted-foreground')}>
          {VERDICT_LABELS[email.verdict]}
        </p>
        {email.verdict === 'imported' ? (
          email.transaction ? (
            <Link
              to={`/transactions/${email.transaction.id}`}
              className="block truncate text-xs font-medium underline-offset-4 hover:underline"
            >
              {email.transaction.description} ·{' '}
              {formatCurrency(email.transaction.amount, email.transaction.currency)}
            </Link>
          ) : (
            // The link column is ON DELETE SET NULL, so an imported row can
            // outlive its transaction. Say so rather than offer a dead link.
            <p className="text-xs text-muted-foreground">The transaction was deleted.</p>
          )
        ) : null}
        {email.verdict === 'failed' && email.attempts > 1 ? (
          <p className="text-xs text-muted-foreground">Tried {email.attempts} times</p>
        ) : null}
        {isProblem ? (
          <div className="space-y-1 sm:flex sm:flex-col sm:items-end">
            <Button
              variant="outline"
              size="sm"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate({ connectionId: email.connection_id, messageId: email.message_id })
              }
            >
              {retry.isPending ? 'Retrying...' : 'Retry'}
            </Button>
            {retry.error ? (
              <p className="text-xs text-destructive">{toRetryErrorMessage(retry.error)}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}

export function InboxPage() {
  // Growing-limit pagination, like the transactions list: "Load more" raises the
  // requested limit rather than paging through offsets.
  const [limit, setLimit] = useState(PAGE_SIZE)
  const emailsQuery = useEmails({ limit, offset: 0 })

  // "Load more" raises the limit, which is a new query key, and a query that
  // errors on its first fetch has no data at all: keepPreviousData is dropped
  // along with it. Holding the last page that did load means a failed "Load
  // more" adds an error line instead of wiping the emails already on screen.
  const lastLoadedPage = useRef<EmailListResponse | null>(null)
  if (emailsQuery.data) lastLoadedPage.current = emailsQuery.data
  const loadedPage = emailsQuery.data ?? lastLoadedPage.current

  const emails = loadedPage?.items ?? []
  const total = loadedPage?.total ?? 0
  const hasLoadedEmails = emails.length > 0
  const canLoadMore = emails.length < total && emails.length < MAX_LOADED_EMAILS
  const isCapReached = emails.length >= MAX_LOADED_EMAILS && total > emails.length
  // Connections key off a real user row, so the backend answers 503 in mock
  // mode. Only a mock build can be in that position: a browser signed in
  // through Better Auth reads a 503 as a real outage, and claiming mock mode
  // there would hide it.
  const isMockModeUnavailable =
    isMockMode && emailsQuery.error instanceof ApiError && emailsQuery.error.status === 503

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Every email the importer processed, newest first, and what it decided.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {emailsQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading emails...</p>
          ) : isMockModeUnavailable ? (
            <p className="p-6 text-sm text-muted-foreground">
              The inbox is unavailable in mock mode, because processed emails belong to a real
              linked Gmail account.
            </p>
          ) : emailsQuery.isError && !hasLoadedEmails ? (
            <p className="p-6 text-sm text-destructive">{toErrorMessage(emailsQuery.error)}</p>
          ) : !hasLoadedEmails ? (
            <p className="p-6 text-sm text-muted-foreground">
              No emails processed yet. Link a Gmail account to start importing.
            </p>
          ) : (
            <ul className="divide-y">
              {emails.map((email) => (
                <EmailRow key={`${email.connection_id}:${email.message_id}`} email={email} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {emailsQuery.isError && hasLoadedEmails ? (
        <p className="text-center text-sm text-destructive">
          Could not load more emails. {toErrorMessage(emailsQuery.error)}
        </p>
      ) : null}

      {canLoadMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => setLimit((previousLimit) => previousLimit + PAGE_SIZE)}
            disabled={emailsQuery.isFetching}
          >
            {emailsQuery.isFetching ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      ) : null}

      {isCapReached ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing the most recent {MAX_LOADED_EMAILS} emails.
        </p>
      ) : null}
    </div>
  )
}
