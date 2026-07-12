import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from '@/pages/DashboardPage'
import { stubApiFetch } from '@/test/apiStub'
import { makeTransaction } from '@/test/factories'
import { formatCurrency } from '@/lib/utils'
import type { TransactionTotals } from '@/types'

// Intl currency output uses non-breaking spaces; testing-library normalizes
// them to plain spaces in the DOM, so the matcher must match that.
function visibleCurrency(amount: number, currency: string): string {
  return formatCurrency(amount, currency).replace(/\s/g, ' ')
}

const loadedTransactions = [
  makeTransaction({ type: 'expense', amount: -10, currency: 'PEN', base_amount: -10 }),
  makeTransaction({ type: 'income', amount: 500, currency: 'PEN', base_amount: 500 }),
]

function renderDashboard(totals: TransactionTotals) {
  const apiStub = stubApiFetch([
    {
      match: '/transactions',
      data: (url: string) =>
        url.includes('limit=1&') || url.endsWith('limit=1')
          ? { items: loadedTransactions.slice(0, 1), next_cursor: null, totals }
          : { items: loadedTransactions, next_cursor: null, totals },
    },
    { match: '/accounts', data: [{ id: 'acc-1', name: 'Cash', type: 'cash', currency: 'PEN' }] },
    { match: '/categories', data: [{ id: 'cat-1', name: 'Food', type: 'expense' }] },
    { match: '/settings', data: { id: 1, base_currency_code: 'PEN' } },
  ])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  )
  return apiStub
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DashboardPage totals', () => {
  it('shows the authoritative backend net balance, not the loaded-items sum', async () => {
    renderDashboard({
      count: 350,
      by_currency: [
        { currency: 'PEN', sum: 1234.5 },
        { currency: 'USD', sum: -80 },
      ],
      base: { currency: 'PEN', sum: 937.25 },
    })
    // 937.25 can only come from totals.base.sum; the two loaded items sum to 490.
    await waitFor(() =>
      expect(screen.getByText(visibleCurrency(937.25, 'PEN'))).toBeInTheDocument(),
    )
    expect(screen.getByText(visibleCurrency(-80, 'USD'))).toBeInTheDocument()
  })

  it('shows a missing-rates notice when the backend base sum is null', async () => {
    renderDashboard({
      count: 350,
      by_currency: [{ currency: 'PEN', sum: 1234.5 }],
      base: { currency: 'PEN', sum: null },
    })
    await waitFor(() =>
      expect(screen.getByText('PEN total unavailable: missing rates')).toBeInTheDocument(),
    )
  })

  it('notes that Total spend is based on a subset when more transactions exist', async () => {
    renderDashboard({
      count: 350,
      by_currency: [{ currency: 'PEN', sum: 1234.5 }],
      base: { currency: 'PEN', sum: 937.25 },
    })
    await waitFor(() =>
      expect(
        screen.getByText('Based on the 2 most recent of 350 transactions.'),
      ).toBeInTheDocument(),
    )
  })

  it('shows no truncation note when every transaction was loaded', async () => {
    renderDashboard({
      count: 2,
      by_currency: [{ currency: 'PEN', sum: 490 }],
      base: { currency: 'PEN', sum: 490 },
    })
    await waitFor(() =>
      expect(screen.getAllByText(visibleCurrency(490, 'PEN')).length).toBeGreaterThan(0),
    )
    expect(screen.queryByText(/most recent of/)).not.toBeInTheDocument()
  })
})
