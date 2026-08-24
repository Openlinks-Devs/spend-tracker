import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InboxPage } from './InboxPage'
import { ApiError, emailsApi } from '@/lib/api'
import type { EmailListResponse, EmailLogItem } from '@/types'

// A getter rather than a plain value, so each test can pick the build mode
// without re-importing the page module.
let isMockModeBuild = false
vi.mock('@/lib/appMode', () => ({
  get isMockMode() {
    return isMockModeBuild
  },
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    emailsApi: {
      list: vi.fn(),
      retry: vi.fn(),
    },
  }
})

function emailLogItem(overrides: Partial<EmailLogItem> = {}): EmailLogItem {
  return {
    message_id: 'message-1',
    connection_id: 'connection-1',
    account_email: 'misael@gmail.com',
    sender: 'Bank <no-reply@bank.com>',
    subject: 'Your card was charged',
    email_date: '2026-08-12T10:00:00.000Z',
    received_at: '2026-08-12T10:01:00.000Z',
    verdict: 'imported',
    attempts: 1,
    transaction: { id: 'transaction-1', description: 'Coffee', amount: -12.5, currency: 'USD' },
    ...overrides,
  }
}

function emailListResponse(items: EmailLogItem[], total = items.length): EmailListResponse {
  return { items, total, limit: 50, offset: 0 }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/inbox']}>
        <InboxPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.clearAllMocks()
  isMockModeBuild = false
})

describe('InboxPage', () => {
  it('lists an email with its sender, subject and account', async () => {
    vi.mocked(emailsApi.list).mockResolvedValue(emailListResponse([emailLogItem()]))

    renderPage()

    expect(await screen.findByText('Your card was charged')).toBeInTheDocument()
    expect(screen.getByText(/Bank <no-reply@bank.com>/)).toBeInTheDocument()
    expect(screen.getByText(/misael@gmail\.com/)).toBeInTheDocument()
  })

  it('renders the agreed label for every verdict', async () => {
    const verdictLabels: Array<[EmailLogItem['verdict'], string]> = [
      ['imported', 'Imported'],
      ['not_transaction', 'Not a transaction'],
      ['not_configured', 'No accounts or categories set up'],
      ['extract_failed', 'Could not read the details'],
      ['failed', 'Processing failed'],
      ['unknown', 'Unknown'],
    ]
    vi.mocked(emailsApi.list).mockResolvedValue(
      emailListResponse(
        verdictLabels.map(([verdict], index) =>
          emailLogItem({
            message_id: `message-${index}`,
            verdict,
            transaction: verdict === 'imported' ? emailLogItem().transaction : null,
          }),
        ),
      ),
    )

    renderPage()

    await waitFor(() => expect(screen.getByText('Imported')).toBeInTheDocument())
    for (const [, label] of verdictLabels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('links an imported row to its transaction', async () => {
    vi.mocked(emailsApi.list).mockResolvedValue(emailListResponse([emailLogItem()]))

    renderPage()

    const transactionLink = await screen.findByRole('link', { name: /Coffee/ })
    expect(transactionLink).toHaveAttribute('href', '/transactions/transaction-1')
  })

  // ON DELETE SET NULL orphans the link when the transaction is deleted, so an
  // imported row can have no transaction. A dead link would be worse than none.
  it('does not render a dead link for an imported row whose transaction is gone', async () => {
    vi.mocked(emailsApi.list).mockResolvedValue(
      emailListResponse([emailLogItem({ transaction: null })]),
    )

    renderPage()

    await waitFor(() => expect(screen.getByText('Imported')).toBeInTheDocument())
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/transaction was deleted/i)).toBeInTheDocument()
  })

  // Sender and subject are cleared after 30 days, and historical rows never had
  // them. Both render as unavailable rather than as blank space.
  it('marks a cleared sender and subject as unavailable', async () => {
    vi.mocked(emailsApi.list).mockResolvedValue(
      emailListResponse([
        emailLogItem({
          sender: null,
          subject: null,
          email_date: null,
          verdict: 'unknown',
          transaction: null,
        }),
      ]),
    )

    renderPage()

    await waitFor(() => expect(screen.getByText('Unknown')).toBeInTheDocument())
    expect(screen.getAllByText(/no longer available/i).length).toBeGreaterThan(0)
  })

  it('explains the mock-mode 503 instead of showing a raw error', async () => {
    isMockModeBuild = true
    vi.mocked(emailsApi.list).mockRejectedValue(new ApiError('connections_require_live_mode', 503))

    renderPage()

    expect(await screen.findByText(/mock mode/i)).toBeInTheDocument()
  })

  // A signed-in browser can never hit the mock-mode 503, so a 503 there is a
  // real outage and must not be explained away as a build-mode limitation.
  it('reports a 503 as an error in a live build', async () => {
    vi.mocked(emailsApi.list).mockRejectedValue(new ApiError('Service unavailable', 503))

    renderPage()

    expect(await screen.findByText('Service unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/mock mode/i)).toBeNull()
  })

  it('shows the empty state when nothing has been processed yet', async () => {
    vi.mocked(emailsApi.list).mockResolvedValue(emailListResponse([]))

    renderPage()

    expect(await screen.findByText(/no emails processed yet/i)).toBeInTheDocument()
  })

  it('offers load more only while more emails remain', async () => {
    vi.mocked(emailsApi.list).mockResolvedValue(emailListResponse([emailLogItem()], 120))

    renderPage()

    expect(await screen.findByRole('button', { name: /load more/i })).toBeInTheDocument()
  })

  // Raising the limit starts a new query, which has no data of its own while it
  // fails, so a naive error branch replaces the loaded emails with an error
  // line. The rows the user was reading must survive a failed load more.
  it('keeps the loaded emails on screen when load more fails', async () => {
    vi.mocked(emailsApi.list)
      .mockResolvedValueOnce(emailListResponse([emailLogItem()], 120))
      .mockRejectedValueOnce(new ApiError('Service unavailable', 503))

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /load more/i }))

    await waitFor(() => expect(screen.getByText(/could not load more emails/i)).toBeInTheDocument())
    expect(screen.getByText('Your card was charged')).toBeInTheDocument()
  })
})

describe('InboxPage retry', () => {
  it('offers Retry on a failed email and re-imports it on click', async () => {
    const failedEmail = emailLogItem({ verdict: 'failed', transaction: null, attempts: 3 })
    vi.mocked(emailsApi.list).mockResolvedValue(emailListResponse([failedEmail]))
    vi.mocked(emailsApi.retry).mockResolvedValue({
      email: { ...failedEmail, verdict: 'imported' },
    })
    renderPage()

    const retryButton = await screen.findByRole('button', { name: 'Retry' })
    fireEvent.click(retryButton)

    await waitFor(() =>
      expect(emailsApi.retry).toHaveBeenCalledWith('connection-1', 'message-1'),
    )
  })

  it('offers Retry on an extract_failed email', async () => {
    vi.mocked(emailsApi.list).mockResolvedValue(
      emailListResponse([emailLogItem({ verdict: 'extract_failed', transaction: null })]),
    )
    renderPage()

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('does not offer Retry on an imported or routine email', async () => {
    vi.mocked(emailsApi.list).mockResolvedValue(
      emailListResponse([
        emailLogItem({ verdict: 'imported' }),
        emailLogItem({
          message_id: 'message-2',
          subject: 'Weekly newsletter',
          verdict: 'not_transaction',
          transaction: null,
        }),
      ]),
    )
    renderPage()

    await screen.findByText('Weekly newsletter')
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('explains a parked connection instead of showing the raw error', async () => {
    vi.mocked(emailsApi.list).mockResolvedValue(
      emailListResponse([emailLogItem({ verdict: 'failed', transaction: null })]),
    )
    vi.mocked(emailsApi.retry).mockRejectedValue(new ApiError('connection_needs_reauth', 409))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Reconnect the Gmail account first.')).toBeInTheDocument()
  })
})
