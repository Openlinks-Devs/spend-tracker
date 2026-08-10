import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Plain vitest assertions rather than jest-dom matchers: `toBeInTheDocument`
// does not register under this vitest version (the IntegrationsPage suite fails
// on the same thing), and that is an unrelated setup bug.
async function renderLayout(isMockMode: boolean) {
  vi.resetModules()
  vi.doMock('@/lib/appMode', () => ({ isMockMode }))
  vi.doMock('@/lib/authClient', () => ({
    signOut: vi.fn(),
    useSession: () => ({ data: { user: { email: 'demo@example.com' } } }),
  }))
  const { AppLayout } = await import('./AppLayout')
  return render(
    <MemoryRouter initialEntries={['/']}>
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
