import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationsPage } from './IntegrationsPage'
import { connectionsApi } from '@/lib/api'
import type { Connection } from '@/types'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    connectionsApi: {
      list: vi.fn(),
      remove: vi.fn(),
      gmailLinkUrl: vi.fn(),
      telegramPairCode: vi.fn(),
    },
  }
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/integrations']}>
        <IntegrationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.mocked(connectionsApi.list).mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the link Gmail and connect Telegram actions', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: /link gmail/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connect telegram/i })).toBeInTheDocument()
  })

  it('shows a listed gmail connection with its email and a remove button', async () => {
    const gmailConnection: Connection = {
      id: 'connection-1',
      provider: 'gmail',
      status: 'active',
      external_id: 'user@example.com',
      created_at: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(connectionsApi.list).mockResolvedValue([gmailConnection])

    renderPage()

    await waitFor(() => expect(screen.getByText('user@example.com')).toBeInTheDocument())
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove connection/i })).toBeInTheDocument()
  })
})
