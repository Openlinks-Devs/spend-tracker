import { useQuery } from '@tanstack/react-query'
import { tagsApi } from '@/lib/api'

const tagsKey = ['tags'] as const

export function useTags() {
  return useQuery({
    queryKey: tagsKey,
    queryFn: tagsApi.list,
  })
}
