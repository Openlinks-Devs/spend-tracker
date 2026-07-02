import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { categoriesApi } from '@/lib/api'
import type { CategoryUpdate, NewCategory } from '@/types'

const categoriesKey = ['categories'] as const

export function useCategories() {
  return useQuery({
    queryKey: categoriesKey,
    queryFn: categoriesApi.list,
  })
}

export function useCreateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: NewCategory) => categoriesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKey })
    },
  })
}

export function useUpdateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ categoryId, payload }: { categoryId: string; payload: CategoryUpdate }) =>
      categoriesApi.update(categoryId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKey })
    },
  })
}

export function useDeleteCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (categoryId: string) => categoriesApi.remove(categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKey })
    },
  })
}
