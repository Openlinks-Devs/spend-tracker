import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { connectionsApi } from '@/lib/api'

const connectionsKey = ['connections'] as const

export function useConnections() {
  return useQuery({ queryKey: connectionsKey, queryFn: connectionsApi.list })
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
