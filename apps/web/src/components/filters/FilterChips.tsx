import { useMemo } from 'react'
import { IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useTransactionFilters } from '@/hooks/useTransactionFilters'
import { toNameById } from '@/lib/utils'

const RANGE_LABELS: Record<string, string> = {
  'last-3-months': 'Last 3 months',
  'this-year': 'This year',
  all: 'All time',
  custom: 'Custom range',
}

const TYPE_LABELS: Record<'income' | 'expense', string> = {
  income: 'Income',
  expense: 'Expense',
}

interface FilterChipProps {
  label: string
  onRemove: () => void
}

function FilterChip({ label, onRemove }: FilterChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs">
      <span>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconX className="h-3 w-3" />
      </button>
    </span>
  )
}

export function FilterChips() {
  const { filters, setFilters, resetFilters } = useTransactionFilters()

  const accounts = useAccounts().data ?? []
  const categories = useCategories().data ?? []

  const accountNameById = useMemo(() => toNameById(accounts), [accounts])
  const categoryNameById = useMemo(() => toNameById(categories), [categories])

  const hasActiveFilter =
    filters.q.trim() !== '' ||
    filters.range !== 'this-month' ||
    filters.accounts.length > 0 ||
    filters.categories.length > 0 ||
    filters.tags.length > 0 ||
    typeof filters.min === 'number' ||
    typeof filters.max === 'number' ||
    filters.type !== 'all'

  if (!hasActiveFilter) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.q.trim() !== '' ? (
        <FilterChip label={`Search: ${filters.q}`} onRemove={() => setFilters({ q: '' })} />
      ) : null}

      {filters.range !== 'this-month' ? (
        <FilterChip
          label={RANGE_LABELS[filters.range] ?? filters.range}
          onRemove={() => setFilters({ range: 'this-month', from: undefined, to: undefined })}
        />
      ) : null}

      {filters.accounts.map((accountId) => (
        <FilterChip
          key={`account-${accountId}`}
          label={accountNameById.get(accountId) ?? accountId}
          onRemove={() =>
            setFilters({
              accounts: filters.accounts.filter((selectedId) => selectedId !== accountId),
            })
          }
        />
      ))}

      {filters.categories.map((categoryId) => (
        <FilterChip
          key={`category-${categoryId}`}
          label={categoryNameById.get(categoryId) ?? categoryId}
          onRemove={() =>
            setFilters({
              categories: filters.categories.filter((selectedId) => selectedId !== categoryId),
            })
          }
        />
      ))}

      {filters.tags.map((tag) => (
        <FilterChip
          key={`tag-${tag}`}
          label={tag}
          onRemove={() =>
            setFilters({ tags: filters.tags.filter((selectedTag) => selectedTag !== tag) })
          }
        />
      ))}

      {typeof filters.min === 'number' ? (
        <FilterChip label={`Min: ${filters.min}`} onRemove={() => setFilters({ min: undefined })} />
      ) : null}

      {typeof filters.max === 'number' ? (
        <FilterChip label={`Max: ${filters.max}`} onRemove={() => setFilters({ max: undefined })} />
      ) : null}

      {filters.type !== 'all' ? (
        <FilterChip
          label={TYPE_LABELS[filters.type]}
          onRemove={() => setFilters({ type: 'all' })}
        />
      ) : null}

      <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
        Clear all
      </Button>
    </div>
  )
}
