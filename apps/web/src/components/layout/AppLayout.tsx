import { NavLink, Outlet, useLocation } from 'react-router'
import { IconLayoutDashboard, IconReceipt, IconWallet, IconTags } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

// Dashboard and Transactions share the same filter query string; carrying the
// current location.search across those two links keeps filters applied when the
// user switches between them. Accounts and Categories stay bare.
const navigationItems = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard, end: true, preservesFilters: true },
  { to: '/transactions', label: 'Transactions', icon: IconReceipt, end: false, preservesFilters: true },
  { to: '/accounts', label: 'Accounts', icon: IconWallet, end: false, preservesFilters: false },
  { to: '/categories', label: 'Categories', icon: IconTags, end: false, preservesFilters: false },
]

export function AppLayout() {
  const location = useLocation()
  const navigationTarget = (navigationItem: (typeof navigationItems)[number]) =>
    navigationItem.preservesFilters
      ? { pathname: navigationItem.to, search: location.search }
      : navigationItem.to

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 flex-col border-r bg-background md:flex">
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
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-4 border-b bg-background px-6 md:hidden">
          <span className="text-lg font-semibold">SpendTracker</span>
          <nav className="flex gap-2 overflow-x-auto">
            {navigationItems.map((navigationItem) => (
              <NavLink
                key={navigationItem.to}
                to={navigationTarget(navigationItem)}
                end={navigationItem.end}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {navigationItem.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
