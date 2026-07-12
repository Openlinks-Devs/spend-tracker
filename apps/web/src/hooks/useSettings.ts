import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/lib/api'

const settingsKey = ['settings'] as const

export function useSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: settingsApi.get,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: settingsApi.update,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKey }),
  })
}
