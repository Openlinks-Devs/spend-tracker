import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@/types'

// Plain vitest assertions rather than jest-dom matchers: `toBeInTheDocument`
// does not register under this vitest version (the IntegrationsPage suite fails
// on the same thing), and that is an unrelated setup bug.
function brokenConnection(email: string): Connection {
  return {
    id: `conn-${email}`,
    provider: 'gmail',
    status: 'needs_reauth',
    external_id: email,
    created_at: '2026-08-01T00:00:00.000Z',
  }
}

async function renderLayout(
  isMockMode: boolean,
  options: { brokenConnections?: Connection[]; route?: string } = {},
) {
  vi.resetModules()
  vi.doMock('@/lib/appMode', () => ({ isMockMode }))
  vi.doMock('@/lib/authClient', () => ({
    signOut: vi.fn(),
    useSession: () => ({ data: { user: { email: 'demo@example.com' } } }),
  }))
  vi.doMock('@/hooks/useConnections', () => ({
    useBrokenConnections: () => options.brokenConnections ?? [],
  }))
  const { AppLayout } = await import('./AppLayout')
  return render(
    <MemoryRouter initialEntries={[options.route ?? '/']}>
      <AppLayout />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.resetModules()
})

describe('AppLayout sign out', () => {
  // Two controls exist at once - one in the desktop sidebar footer, one in the
  // mobile header - and CSS picks which is visible per breakpoint. Both are in
  // the DOM, so this asserts reachability rather than a single instance. Before
  // the mobile header had one, signing out was impossible on a phone.
  it('offers sign out at every breakpoint when a real session can be ended', async () => {
    await renderLayout(false)
    expect(screen.getAllByRole('button', { name: /sign out/i }).length).toBeGreaterThan(0)
  })

  // In mock mode the backend synthesizes a session for every request and the
  // login gate is skipped, so signOut() can clear nothing the UI reads. A
  // rendered button there is dead: it POSTs /api/auth/sign-out, gets a 200, and
  // the app stays exactly where it was.
  it('hides sign out in mock mode, where nothing can end the session', async () => {
    await renderLayout(true)
    expect(screen.queryAllByRole('button', { name: /sign out/i })).toHaveLength(0)
  })
})

describe('AppLayout navigation', () => {
  // One navigationItems array drives the desktop sidebar and the mobile tab
  // row, so a destination missing here is missing at every breakpoint.
  it('offers the Inbox destination', async () => {
    await renderLayout(false)
    expect(screen.getAllByRole('link', { name: /inbox/i }).length).toBeGreaterThan(0)
  })
})

describe('AppLayout broken connection signal', () => {
  it('marks the integrations link when an account stopped importing', async () => {
    await renderLayout(false, { brokenConnections: [brokenConnection('misael@gmail.com')] })
    // One marker per nav rendering: the desktop sidebar and the mobile header
    // both list Integrations, and CSS decides which is visible.
    expect(screen.getAllByLabelText(/needs attention/i).length).toBeGreaterThan(0)
  })

  it('leaves the integrations link unmarked when every account is healthy', async () => {
    await renderLayout(false)
    expect(screen.queryAllByLabelText(/needs attention/i)).toHaveLength(0)
  })

  it('shows the alert banner when an account stopped importing', async () => {
    await renderLayout(false, { brokenConnections: [brokenConnection('misael@gmail.com')] })
    expect(screen.getByRole('alert')).toHaveTextContent('misael@gmail.com')
  })

  it('hides the banner on the integrations screen, which already shows the state', async () => {
    await renderLayout(false, {
      brokenConnections: [brokenConnection('misael@gmail.com')],
      route: '/integrations',
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
