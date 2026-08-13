import { useState } from 'react'
import { Link } from 'react-router'
import { IconAlertTriangle, IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import type { Connection } from '@/types'

interface ConnectionAlertProps {
  brokenConnections: Connection[]
}

/**
 * Tells the user, from wherever they happen to be, that a linked Gmail account
 * stopped importing. The Integrations screen shows the same state, but nobody
 * opens that screen unprompted, which is the whole problem this solves.
 *
 * Dismissal is deliberately in-memory: it survives client-side navigation and
 * resets on reload, so a broken account cannot be silenced for good while it is
 * still costing the user transactions.
 */
export function ConnectionAlert({ brokenConnections }: ConnectionAlertProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || brokenConnections.length === 0) return null

  const accountList = brokenConnections.map((connection) => connection.external_id).join(', ')

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3 md:px-6"
    >
      <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {brokenConnections.length === 1
            ? `${accountList} stopped importing transactions.`
            : `These accounts stopped importing transactions: ${accountList}.`}
        </p>
        <p className="text-sm text-muted-foreground">
          SpendTracker lost access and needs you to link the account again.
        </p>
      </div>
      <Link
        to="/integrations"
        className="shrink-0 text-sm font-medium text-destructive underline underline-offset-4"
      >
        Reconnect
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <IconX className="h-4 w-4" />
      </Button>
    </div>
  )
}
