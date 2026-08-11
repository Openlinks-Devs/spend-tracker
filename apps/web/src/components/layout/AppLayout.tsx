import { NavLink, Outlet, useLocation } from 'react-router'
import {
  IconLayoutDashboard,
  IconReceipt,
  IconWallet,
  IconTags,
  IconPlug,
  IconLogout,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { signOut, useSession } from '@/lib/authClient'
import { isMockMode } from '@/lib/appMode'
import { ThemeToggle } from '@/components/ThemeToggle'

// Dashboard and Transactions share the same filter query string; carrying the
// current location.search across those two links keeps filters applied when the
// user switches between them. Accounts and Categories stay bare.
const navigationItems = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard, end: true, preservesFilters: true },
  { to: '/transactions', label: 'Transactions', icon: IconReceipt, end: false, preservesFilters: true },
  { to: '/accounts', label: 'Accounts', icon: IconWallet, end: false, preservesFilters: false },
  { to: '/categories', label: 'Categories', icon: IconTags, end: false, preservesFilters: false },
  { to: '/integrations', label: 'Integrations', icon: IconPlug, end: false, preservesFilters: false },
]

export function AppLayout() {
  const location = useLocation()
  const { data: session } = useSession()
  // Guard `user` as well as `session`: a session can come back truthy but
  // without a user (a misrouted /api/auth call, a partial response), and an
  // unguarded read there blanks the whole app with a render exception.
  const userEmail = session?.user?.email
  const navigationTarget = (navigationItem: (typeof navigationItems)[number]) =>
    navigationItem.preservesFilters
      ? { pathname: navigationItem.to, search: location.search }
      : navigationItem.to

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sticky and viewport-height: the footer holds the theme control and sign
          out, and without this the sidebar grew with the page, stranding both at
          the bottom of a long dashboard instead of keeping them in reach. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex h-16 items-center border-b px-6">
          <span className="text-lg font-semibold">SpendTracker</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {navigationItems.map((navigationItem) => {
            const NavigationIcon = navigationItem.icon
            return (
              <NavLink
                key={navigationItem.to}
                to={navigationTarget(navigationItem)}
                end={navigationItem.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <NavigationIcon className="h-4 w-4" />
                {navigationItem.label}
              </NavLink>
            )
          })}
        </nav>
        {/* Mock mode has no session to end: the backend answers every request
            with a synthesized one and App skips the login gate, so signOut()
            would return 200 and change nothing on screen. Hide the control
            rather than ship a button that cannot work. Mock mode also has no
            session to read an email from, so the whole footer goes with it
            instead of leaving an empty bordered strip. */}
        <div className="border-t p-3">
          <ThemeToggle className="w-full justify-center" />
        </div>
        {isMockMode ? null : (
          <div className="flex flex-col gap-2 border-t p-3">
            {userEmail ? <span className="truncate px-3 text-sm text-muted-foreground">{userEmail}</span> : null}
            <Button
              type="button"
              variant="ghost"
              className="justify-start gap-3 px-3"
              onClick={() => signOut()}
            >
              <IconLogout className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        )}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Two rows on small screens. Cramming the wordmark and five links onto
            one line clipped the last item ("Integrations" rendered as "I") and
            left no room for the account, so signing out was impossible on a
            phone - the sidebar footer that holds it is desktop-only. */}
        <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur md:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <span className="truncate text-lg font-semibold tracking-tight">SpendTracker</span>
            <div className="flex min-w-0 items-center gap-2">
              <ThemeToggle />
              {isMockMode ? null : (
                <>
                {userEmail ? (
                  <span className="max-w-[9rem] truncate text-xs text-muted-foreground">
                    {userEmail}
                  </span>
                ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 px-2"
                    onClick={() => signOut()}
                    aria-label="Sign out"
                  >
                    <IconLogout className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
          {/* Horizontal scroll is the honest answer for five destinations on a
              narrow screen; the edge fade tells you there is more to reach. */}
          <nav className="-mb-px flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {navigationItems.map((navigationItem) => (
              <NavLink
                key={navigationItem.to}
                to={navigationTarget(navigationItem)}
                end={navigationItem.end}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                {navigationItem.label}
              </NavLink>
            ))}
          </nav>
        </header>
        {/* min-w-0 so wide children (chart canvases, long descriptions) shrink
            here instead of stretching the page. Tighter gutters on phones:
            p-6 spent 48px of a 390px screen on empty margin. */}
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
