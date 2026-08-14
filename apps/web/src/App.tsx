import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { TransactionsPage } from '@/pages/TransactionsPage'
import { TransactionDetailPage } from '@/pages/TransactionDetailPage'
import { InboxPage } from '@/pages/InboxPage'
import { AccountsPage } from '@/pages/AccountsPage'
import { CategoriesPage } from '@/pages/CategoriesPage'
import { IntegrationsPage } from '@/pages/IntegrationsPage'
import { LoginPage } from '@/pages/LoginPage'
import { LandingPage } from '@/pages/LandingPage'
import { useSession } from '@/lib/authClient'
// In mock mode the backend synthesizes a demo session for every request, so
// there is no real Better Auth session for the web app to check. Skip the login
// gate entirely (e.g. for LAN preview from a phone, where Google sign-in cannot
// complete against a raw LAN IP).
import { isMockMode } from '@/lib/appMode'

export function App() {
  return (
    <BrowserRouter>
      {isMockMode ? <MainRoutes /> : <AuthenticatedApp />}
    </BrowserRouter>
  )
}

function AuthenticatedApp() {
  const { data: session, isPending } = useSession()
  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    )
  }
  // Signed out, the site is the public landing page. Deep links (/transactions,
  // a shared filter URL) go to the landing page too rather than 404ing, so the
  // sign-in prompt is always one click away; the app routes come back once
  // there is a session.
  if (!session) {
    return (
      <Routes>
        <Route index element={<LandingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    )
  }
  return <MainRoutes />
}

function MainRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="transactions/:transactionId" element={<TransactionDetailPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
