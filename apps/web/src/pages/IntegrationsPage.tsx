import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  IconBrandGmail,
  IconBrandTelegram,
  IconTrash,
  IconRefresh,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  useConnections,
  useGmailLinkUrl,
  useRemoveConnection,
  useTelegramPairCode,
} from '@/hooks/useConnections'
import { ApiError, toErrorMessage } from '@/lib/api'
import type { Connection } from '@/types'

const STATUS_LABELS: Record<Connection['status'], string> = {
  active: 'Active',
  needs_reauth: 'Needs re-authentication',
  disabled: 'Disabled',
}

export function IntegrationsPage() {
  const [searchParams] = useSearchParams()
  const connectionsQuery = useConnections()
  const removeConnection = useRemoveConnection()
  const gmailLink = useGmailLinkUrl()
  const telegramPair = useTelegramPairCode()

  const connections = connectionsQuery.data ?? []
  const justLinked = searchParams.get('linked') === 'gmail'
  const linkErrorCode = searchParams.get('error')

  const premiumRequired = gmailLink.error instanceof ApiError && gmailLink.error.status === 402

  const banner = useMemo(() => {
    if (justLinked) return { tone: 'success' as const, text: 'Gmail account linked.' }
    if (linkErrorCode === 'no_refresh_token')
      return {
        tone: 'error' as const,
        text: 'Google returned no refresh token. Remove SpendTracker at myaccount.google.com and retry.',
      }
    if (linkErrorCode) return { tone: 'error' as const, text: 'Linking failed. Please try again.' }
    return null
  }, [justLinked, linkErrorCode])

  function startGmailLink() {
    gmailLink.mutate(undefined, {
      onSuccess: ({ url }) => {
        window.location.href = url
      },
    })
  }

  function startTelegramPair() {
    telegramPair.mutate(undefined, {
      onSuccess: ({ deepLink }) => {
        window.open(deepLink, '_blank', 'noopener')
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Link your Gmail to import transactions automatically and Telegram to get notifications.
          Imports start from the moment you link; there is no history backfill.
        </p>
      </div>

      {banner ? (
        <p className={banner.tone === 'success' ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
          {banner.text}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button onClick={startGmailLink} loading={gmailLink.isPending}>
          <IconBrandGmail className="h-4 w-4" />
          Link Gmail
        </Button>
        <Button variant="outline" onClick={startTelegramPair} loading={telegramPair.isPending}>
          <IconBrandTelegram className="h-4 w-4" />
          Connect Telegram
        </Button>
      </div>

      {premiumRequired ? (
        <p className="text-sm text-muted-foreground">
          The free plan includes one Gmail account. Upgrade to premium to link more.
        </p>
      ) : gmailLink.isError ? (
        <p className="text-sm text-destructive">{toErrorMessage(gmailLink.error)}</p>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {connectionsQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading integrations...</p>
          ) : connections.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nothing linked yet.</p>
          ) : (
            <ul className="divide-y">
              {connections.map((connection) => (
                <li key={connection.id} className="flex items-center justify-between gap-4 px-6 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {connection.provider === 'gmail' ? connection.external_id : 'Telegram'}
                    </p>
                    {connection.status === 'needs_reauth' ? (
                      // Naming the state is not enough: "Needs re-authentication"
                      // reads as housekeeping, while the actual cost is silently
                      // missing transactions.
                      <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                        <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Not importing transactions. Link the account again.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {STATUS_LABELS[connection.status]}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    {connection.provider === 'gmail' && connection.status === 'needs_reauth' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={startGmailLink}
                        aria-label="Re-authenticate"
                      >
                        <IconRefresh className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => removeConnection.mutate(connection.id)}
                      aria-label="Remove connection"
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
