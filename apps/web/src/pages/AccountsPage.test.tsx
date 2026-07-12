import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountsPage } from '@/pages/AccountsPage'
import { stubApiFetch } from '@/test/apiStub'

function renderPage() {
  const apiStub = stubApiFetch([
    {
      match: '/accounts',
      data: [{ id: 'acc-1', name: 'Cash', type: 'cash', currency: 'PEN' }],
    },
    {
      match: '/currencies',
      data: [
        { code: 'PEN', name: 'Sol', symbol: 'S/', decimal_places: 2 },
        { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 },
        { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimal_places: 0 },
      ],
    },
    { match: '/settings', data: { id: 1, base_currency_code: 'PEN' } },
  ])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AccountsPage />
    </QueryClientProvider>,
  )
  return apiStub
}

function lastPostBody(apiStub: ReturnType<typeof stubApiFetch>): unknown {
  const calls = apiStub.fetchMock.mock.calls
  const postCall = calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
  if (!postCall) return undefined
  return JSON.parse((postCall[1] as RequestInit).body as string)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AccountsPage account form', () => {
  it('lists catalog currency codes and submits the selected code', async () => {
    const user = userEvent.setup()
    const apiStub = renderPage()

    await waitFor(() => expect(screen.getByText('Cash')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'New account' }))

    await user.click(screen.getByRole('combobox', { name: 'Currency' }))
    expect(await screen.findByRole('option', { name: /USD/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /JPY/ })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /JPY/ }))

    await user.type(screen.getByLabelText('Name'), 'Tokyo Wallet')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      const body = lastPostBody(apiStub) as { currency?: string } | undefined
      expect(body?.currency).toBe('JPY')
    })
  })

  it('defaults the currency to the account being edited', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => expect(screen.getByText('Cash')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Edit account' }))

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('PEN'),
    )
  })
})
