import { useEffect, useState } from 'react'
import { IconSearch } from '@tabler/icons-react'
import { Input } from '@/components/ui/input'
import { useTransactionFilters } from '@/hooks/useTransactionFilters'

const SEARCH_DEBOUNCE_MS = 300

export function SearchBar() {
  const { filters, setFilters } = useTransactionFilters()
  const [query, setQuery] = useState(filters.q)

  // Re-sync the local input when filters.q changes from outside this component
  // (a chip removing the search term, or "Clear all" resetting the filters).
  useEffect(() => {
    setQuery(filters.q)
  }, [filters.q])

  // Debounce the write so we only touch the URL 300ms after the user stops
  // typing. The guard avoids writing when local state already matches filters,
  // which is the case right after an external sync.
  useEffect(() => {
    if (query === filters.q) return
    const timeoutId = setTimeout(() => setFilters({ q: query }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeoutId)
  }, [query, filters.q, setFilters])

  return (
    <div className="relative">
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search transactions"
        aria-label="Search transactions"
        className="pl-9"
      />
    </div>
  )
}
