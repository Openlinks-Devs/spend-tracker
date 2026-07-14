import { useMutation, useQueryClient } from '@tanstack/react-query'
import { transfersApi } from '@/lib/api'
import type { TransferInput } from '@/types'

// A transfer writes two transactions, so it invalidates the same caches a
// create does: every 'transactions'-prefixed query (list + analytics) and the
// tag list (a transfer may introduce a new tag).
export function useCreateTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: TransferInput) => transfersApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}
