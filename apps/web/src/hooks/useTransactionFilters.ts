import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { parseFilterParams, toSearchParams, EMPTY_FILTERS, type TransactionFilterState } from '@/lib/filterParams'

export function useTransactionFilters() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseFilterParams(searchParams), [searchParams])
  const setFilters = useCallback(
    (next: Partial<TransactionFilterState>) => setSearchParams(toSearchParams({ ...filters, ...next })),
    [filters, setSearchParams],
  )
  const resetFilters = useCallback(() => setSearchParams(toSearchParams(EMPTY_FILTERS)), [setSearchParams])
  return { filters, setFilters, resetFilters }
}
