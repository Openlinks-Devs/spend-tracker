import { useSearchParams } from 'react-router'
import {
  IconBrandGoogle,
  IconMail,
  IconSparkles,
  IconTags,
  IconDatabase,
  IconChartBar,
  IconBrandTelegram,
  IconLock,
  IconCoins,
  IconArrowDown,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { signIn } from '@/lib/authClient'

// The pipeline is a genuine ordered sequence, which is what earns the numbering:
// each step consumes the previous one's output.
const pipelineSteps = [
  {
    title: 'Connect your inbox',
    body: 'Link the Gmail account your bank already writes to. SpendTracker reads only what arrives after you connect.',
    icon: IconMail,
  },
  {
    title: 'Find the notifications',
    body: 'Every new message is checked against the shapes banks actually use, so receipts get through and newsletters do not.',
    icon: IconSparkles,
  },
  {
    title: 'Pull out the numbers',
    body: 'Amount, currency, merchant, date and account come out as structured fields, then get a category and tags.',
    icon: IconTags,
  },
  {
    title: 'Keep the row, drop the mail',
    body: 'The transaction is stored against your account. The message itself is never kept, only the id that marks it as already read.',
    icon: IconDatabase,
  },
]

const capabilities = [
  {
    title: 'Soles and dollars, side by side',
    body: 'Balances stay in the currency they were spent in. Nothing is silently converted at a rate you did not choose.',
    icon: IconCoins,
  },
  {
    title: 'Spending you can actually read',
    body: 'A daily heatmap, spend over time, and breakdowns by category, tag and account. Click any day to see the transactions behind it.',
    icon: IconChartBar,
  },
  {
    title: 'Told, not just recorded',
    body: 'Link Telegram and each new transaction arrives as a message the moment it lands.',
    icon: IconBrandTelegram,
  },
  {
    title: 'Your ledger is yours',
    body: 'Every account, category and transaction is scoped to your user and enforced by the database, not by convention.',
    icon: IconLock,
  },
]

function signInWithGoogle() {
  signIn.social({ provider: 'google', callbackURL: '/' })
}

export function LandingPage() {
  const [searchParams] = useSearchParams()
  const hasError = searchParams.has('error')

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <span className="text-lg font-semibold tracking-tight">SpendTracker</span>
          <nav className="flex items-center gap-6">
            <a
              href="#how"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              How it works
            </a>
            <Button type="button" size="sm" onClick={signInWithGoogle}>
              Sign in
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-6 pb-20 pt-16 sm:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                Your bank already emails you every purchase.
                <span className="block text-muted-foreground">This turns them into a ledger.</span>
              </h1>
              <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
                SpendTracker watches the notifications your bank sends to Gmail, pulls out the
                amount, merchant and date, and files each one under a category. No receipts to
                photograph, no statements to import.
              </p>

              {hasError ? (
                <p className="mt-6 text-sm text-destructive">
                  That account is not authorized to use SpendTracker.
                </p>
              ) : null}

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button type="button" size="lg" onClick={signInWithGoogle}>
                  <IconBrandGoogle className="h-4 w-4" />
                  Sign in with Google
                </Button>
                <span className="text-sm text-muted-foreground">
                  Reads new mail only. Never sends any.
                </span>
              </div>
            </div>

            {/* The signature: the actual transformation this product performs, shown with
                the same row styling the transactions list uses. */}
            <div className="lg:pl-4">
              <div className="rounded-lg border bg-card p-4 shadow-xs">
                <p className="mb-3 text-sm text-muted-foreground">What your bank sends</p>
                <div className="rounded-md bg-muted/60 p-4 font-mono text-[13px] leading-relaxed text-foreground">
                  <div className="text-muted-foreground">notificaciones@bcp.com.pe</div>
                  <div className="mt-2">
                    Consumo con Tarjeta de Crédito BCP en DLC*RIDES. N° operación 0000207113 por
                    S/ 10.90 el 07/08/2026 22:12.
                  </div>
                </div>
              </div>

              <div className="flex justify-center py-3" aria-hidden="true">
                <IconArrowDown className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="rounded-lg border bg-card shadow-xs">
                <p className="px-4 pb-1 pt-4 text-sm text-muted-foreground">What you get</p>
                <div className="flex items-start justify-between gap-4 px-4 pb-4 pt-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      Consumo con Tarjeta de Crédito BCP en DLC*RIDES
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      10:12 PM &middot; Taxi &middot; BCP Visa Oro
                    </p>
                    <p className="mt-1 text-xs" style={{ color: '#2a78d6' }}>
                      #rides #taxi #transporte
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">-S/ 10.90</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* scroll-mt clears the sticky header when the nav anchor jumps here. */}
        <section id="how" className="scroll-mt-16 border-t bg-muted/30">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <h2 className="text-2xl font-semibold tracking-tight">
              From inbox to ledger, in four steps
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Each step runs on what the one before it produced.
            </p>
            <ol className="mt-10 grid gap-8 sm:grid-cols-2">
              {pipelineSteps.map((step, index) => {
                const StepIcon = step.icon
                return (
                  <li key={step.title} className="flex gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background text-sm font-medium tabular-nums">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-medium">
                        <StepIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {step.title}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {step.body}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-2xl font-semibold tracking-tight">Once it is in there</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            {capabilities.map((capability) => {
              const CapabilityIcon = capability.icon
              return (
                <div key={capability.title}>
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <CapabilityIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {capability.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {capability.body}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto max-w-5xl px-6 py-20 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              Start with the mail you already have
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Connect Gmail and the next notification your bank sends becomes your first row.
              Access is limited to approved accounts.
            </p>
            <div className="mt-8 flex justify-center">
              <Button type="button" size="lg" onClick={signInWithGoogle}>
                <IconBrandGoogle className="h-4 w-4" />
                Sign in with Google
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="font-medium text-foreground">SpendTracker</span>
          {/* Plain anchors, not react-router links: these are standalone static
              documents in public/, served by the same origin but outside the SPA.
              Google's OAuth verification also expects the privacy policy to be
              reachable from the page that requests consent. */}
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <a href="/privacy.html" className="transition-colors hover:text-foreground">
              Privacy policy
            </a>
            <a
              href="/terms-and-conditions.html"
              className="transition-colors hover:text-foreground"
            >
              Terms and conditions
            </a>
            <a
              href="mailto:contact@openlinks.app"
              className="transition-colors hover:text-foreground"
            >
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
