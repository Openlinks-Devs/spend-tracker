import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { connectionsApi } from '@/lib/api'

const connectionsKey = ['connections'] as const

export function useConnections() {
  return useQuery({ queryKey: connectionsKey, queryFn: connectionsApi.list })
}

/**
 * The linked Gmail accounts that lost access and stopped importing.
 *
 * `disabled` is deliberately not included: that status means the connection is
 * over the plan's account cap, which is a billing state the user cannot repair
 * by reconnecting. This matches where the backend's Telegram alert draws the
 * same line.
 *
 * Shares the ['connections'] cache entry with useConnections, so the layout,
 * the alert and the Integrations page together cost one request.
 */
export function useBrokenConnections() {
  const connectionsQuery = useConnections()
  return (connectionsQuery.data ?? []).filter(
    (connection) => connection.provider === 'gmail' && connection.status === 'needs_reauth',
  )
}

export function useRemoveConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) => connectionsApi.remove(connectionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionsKey }),
  })
}

// Linking navigates away (Google) or out of the app (Telegram); the list is
// refreshed when the user lands back on /integrations.
export function useGmailLinkUrl() {
  return useMutation({ mutationFn: connectionsApi.gmailLinkUrl })
}

export function useTelegramPairCode() {
  return useMutation({ mutationFn: connectionsApi.telegramPairCode })
}
