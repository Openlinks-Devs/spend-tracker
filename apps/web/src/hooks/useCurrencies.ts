import { useQuery } from '@tanstack/react-query'
import { currenciesApi } from '@/lib/api'

const currenciesKey = ['currencies'] as const

// The ISO 4217 list never changes within a session.
export function useCurrencies() {
  return useQuery({
    queryKey: currenciesKey,
    queryFn: currenciesApi.list,
    staleTime: Infinity,
  })
}
