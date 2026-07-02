import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ResourceApi } from '@/lib/api'

// The list-query + create/update/delete-mutation set is identical for every CRUD
// resource; only the query key and the api object differ. This factory builds
// the four hooks once so each resource module is a one-line binding.
export function createResourceHooks<Entity, NewEntity, UpdateEntity>(
  key: string,
  api: ResourceApi<Entity, NewEntity, UpdateEntity>,
) {
  const queryKey = [key] as const

  function useList() {
    return useQuery({ queryKey, queryFn: api.list })
  }

  function useCreate() {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: (payload: NewEntity) => api.create(payload),
      onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    })
  }

  function useUpdate() {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: ({ id, payload }: { id: string; payload: UpdateEntity }) => api.update(id, payload),
      onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    })
  }

  function useRemove() {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: (id: string) => api.remove(id),
      onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    })
  }

  return { useList, useCreate, useUpdate, useRemove }
}
