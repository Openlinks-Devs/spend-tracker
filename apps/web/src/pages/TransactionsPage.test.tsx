import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransactionsPage } from '@/pages/TransactionsPage'
import { stubApiFetch } from '@/test/apiStub'
import { makeTransaction } from '@/test/factories'
import type { TransactionTotals } from '@/types'

const totals: TransactionTotals = {
  count: 1,
  by_currency: [{ currency: 'PEN', sum: -10 }],
  base: { currency: 'PEN', sum: -10 },
}

function renderPage(initialUrl: string) {
  const apiStub = stubApiFetch([
    {
      match: '/transactions',
      data: { items: [makeTransaction({ payee: 'Wong' })], next_cursor: null, totals },
    },
    { match: '/accounts', data: [{ id: 'acc-1', name: 'Cash', type: 'cash', currency: 'PEN' }] },
    { match: '/categories', data: [{ id: 'cat-1', name: 'Food', type: 'expense' }] },
    {
      match: '/currencies',
      data: [{ code: 'PEN', name: 'Sol', symbol: 'S/', decimal_places: 2 }],
    },
    { match: '/settings', data: { id: 1, base_currency_code: 'PEN' } },
  ])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/transactions" element={<TransactionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return apiStub
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TransactionsPage URL filters', () => {
  it('reads filters from the URL, maps them to the API call, and shows chips', async () => {
    const apiStub = renderPage('/transactions?type=expense&search=coffee')

    await waitFor(() => {
      const transactionsCall = apiStub
        .requestedUrls()
        .find((url) => url.includes('/transactions') && url.includes('type=expense'))
      expect(transactionsCall).toBeDefined()
      expect(transactionsCall).toContain('search=coffee')
    })

    expect(screen.getByText('Type: expense')).toBeInTheDocument()
    expect(screen.getByText('Search: coffee')).toBeInTheDocument()
  })
})
