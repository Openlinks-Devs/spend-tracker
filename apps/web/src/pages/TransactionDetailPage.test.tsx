import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransactionDetailPage } from './TransactionDetailPage'
import { ApiError, transactionsApi } from '@/lib/api'
import type { Transaction } from '@/types'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    transactionsApi: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    accountsApi: { ...actual.accountsApi, list: vi.fn().mockResolvedValue([]) },
    categoriesApi: { ...actual.categoriesApi, list: vi.fn().mockResolvedValue([]) },
  }
})

const transaction: Transaction = {
  id: 'transaction-1',
  description: 'Coffee at the corner shop',
  amount: -12.5,
  currency: 'USD',
  account_id: 'account-1',
  category_id: 'category-1',
  tags: ['coffee'],
  created_at: '2026-08-12T10:00:00.000Z',
  updated_at: null,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/transactions/transaction-1']}>
        <Routes>
          <Route path="/transactions/:transactionId" element={<TransactionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('TransactionDetailPage', () => {
  it('shows the transaction description, amount and tags', async () => {
    vi.mocked(transactionsApi.get).mockResolvedValue(transaction)

    renderPage()

    expect(await screen.findByText('Coffee at the corner shop')).toBeInTheDocument()
    expect(screen.getByText(/\$12\.50/)).toBeInTheDocument()
    expect(screen.getByText('coffee')).toBeInTheDocument()
    expect(transactionsApi.get).toHaveBeenCalledWith('transaction-1')
  })

  // A deleted transaction reached from an inbox row must say so rather than
  // leaving a blank screen or a generic request-failed message.
  it('says the transaction was not found on a 404', async () => {
    vi.mocked(transactionsApi.get).mockRejectedValue(new ApiError('Not found', 404))

    renderPage()

    expect(await screen.findByText(/transaction was not found/i)).toBeInTheDocument()
  })

  it('surfaces other failures as an error message', async () => {
    vi.mocked(transactionsApi.get).mockRejectedValue(new ApiError('Server exploded', 500))

    renderPage()

    expect(await screen.findByText('Server exploded')).toBeInTheDocument()
  })
})
