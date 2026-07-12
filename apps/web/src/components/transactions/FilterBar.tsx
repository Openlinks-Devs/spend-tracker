import { useEffect, useMemo, useRef, useState } from 'react'
import { IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  datePresetOptions,
  detectPreset,
  presetRange,
  type DatePreset,
} from '@/lib/datePresets'
import type { Account, Category, Currency, TransactionFilters, TransactionType } from '@/types'

interface FilterBarProps {
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  accounts: Account[]
  categories: Category[]
  currencies: Currency[]
}

const typeSelectOptions: { value: TransactionType | 'all'; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

const tagModeOptions: { value: 'any' | 'all' | 'none'; label: string }[] = [
  { value: 'any', label: 'Any tag' },
  { value: 'all', label: 'All tags' },
  { value: 'none', label: 'No tags' },
]

interface FilterMultiSelectProps {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (selected: string[]) => void
}

function FilterMultiSelect({ label, options, selected, onChange }: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const summary = selected.length === 0 ? `All ${label.toLowerCase()}` : `${selected.length} selected`

  function toggle(optionValue: string) {
    onChange(
      selected.includes(optionValue)
        ? selected.filter((value) => value !== optionValue)
        : [...selected, optionValue],
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={label}>
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="max-h-64 space-y-1 overflow-auto">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface FilterChip {
  key: string
  label: string
  onRemove: () => void
}

export function FilterBar({ filters, onChange, accounts, categories, currencies }: FilterBarProps) {
  const patch = (next: Partial<TransactionFilters>) => onChange({ ...filters, ...next })
  const clearKeys = (keys: (keyof TransactionFilters)[]) => {
    const next = { ...filters }
    for (const key of keys) delete next[key]
    onChange(next)
  }

  const currentPreset = detectPreset({ from: filters.from, to: filters.to })
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  )

  // Debounced free-text search (300ms) so keystrokes do not spam the query.
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '')
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  useEffect(() => {
    setSearchDraft(filters.search ?? '')
  }, [filters.search])
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = searchDraft.trim()
      if ((filtersRef.current.search ?? '') === trimmed) return
      onChange({ ...filtersRef.current, search: trimmed || undefined })
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  function handlePresetChange(nextPreset: DatePreset) {
    if (nextPreset === 'custom') {
      patch({ from: filters.from, to: filters.to })
      return
    }
    const range = presetRange(nextPreset)
    patch({ from: range.from, to: range.to })
  }

  const chips: FilterChip[] = []
  if (currentPreset !== 'all-time') {
    const presetLabel =
      currentPreset === 'custom'
        ? `${filters.from ?? '...'} to ${filters.to ?? '...'}`
        : datePresetOptions.find((option) => option.value === currentPreset)?.label ?? 'Custom'
    chips.push({ key: 'date', label: presetLabel, onRemove: () => clearKeys(['from', 'to']) })
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    const count = filters.accountIds.length
    chips.push({
      key: 'accounts',
      label: count === 1 ? '1 account' : `${count} accounts`,
      onRemove: () => clearKeys(['accountIds']),
    })
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const count = filters.categoryIds.length
    chips.push({
      key: 'categories',
      label:
        count === 1
          ? categoryNameById.get(filters.categoryIds[0]) ?? '1 category'
          : `${count} categories`,
      onRemove: () => clearKeys(['categoryIds']),
    })
  }
  if (filters.uncategorized) {
    chips.push({
      key: 'uncategorized',
      label: 'Uncategorized',
      onRemove: () => clearKeys(['uncategorized']),
    })
  }
  if (filters.tags && filters.tags.length > 0) {
    chips.push({
      key: 'tags',
      label: `${filters.tags.length} tags (${filters.tagMode ?? 'any'})`,
      onRemove: () => clearKeys(['tags', 'tagMode']),
    })
  }
  if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
    chips.push({
      key: 'amount',
      label: `Amount ${filters.amountMin ?? '0'} to ${filters.amountMax ?? '∞'}`,
      onRemove: () => clearKeys(['amountMin', 'amountMax']),
    })
  }
  if (filters.currency) {
    chips.push({
      key: 'currency',
      label: `Currency: ${filters.currency}`,
      onRemove: () => clearKeys(['currency']),
    })
  }
  if (filters.type) {
    chips.push({
      key: 'type',
      label: `Type: ${filters.type}`,
      onRemove: () => clearKeys(['type']),
    })
  }
  if (filters.search) {
    chips.push({
      key: 'search',
      label: `Search: ${filters.search}`,
      onRemove: () => clearKeys(['search']),
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Select value={currentPreset} onValueChange={(value) => handlePresetChange(value as DatePreset)}>
            <SelectTrigger className="w-40" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {datePresetOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {currentPreset === 'custom' ? (
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="filter-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="filter-from"
                type="date"
                className="w-40"
                value={filters.from ?? ''}
                onChange={(event) => patch({ from: event.target.value || undefined })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="filter-to"
                type="date"
                className="w-40"
                value={filters.to ?? ''}
                onChange={(event) => patch({ to: event.target.value || undefined })}
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Accounts</Label>
          <FilterMultiSelect
            label="Accounts"
            options={accounts.map((account) => ({ value: account.id, label: account.name }))}
            selected={filters.accountIds ?? []}
            onChange={(accountIds) =>
              patch({ accountIds: accountIds.length > 0 ? accountIds : undefined })
            }
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Categories</Label>
          <FilterMultiSelect
            label="Categories"
            options={categories.map((category) => ({ value: category.id, label: category.name }))}
            selected={filters.categoryIds ?? []}
            onChange={(categoryIds) =>
              patch({ categoryIds: categoryIds.length > 0 ? categoryIds : undefined })
            }
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.uncategorized ?? false}
            onChange={(event) => patch({ uncategorized: event.target.checked || undefined })}
          />
          Uncategorized only
        </label>

        <div className="space-y-1">
          <Label htmlFor="filter-tags" className="text-xs text-muted-foreground">
            Tags
          </Label>
          <Input
            id="filter-tags"
            className="w-44"
            placeholder="Comma separated"
            value={(filters.tags ?? []).join(', ')}
            onChange={(event) => {
              const tags = event.target.value
                .split(',')
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0)
              patch({ tags: tags.length > 0 ? tags : undefined })
            }}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Tag mode</Label>
          <Select
            value={filters.tagMode ?? 'any'}
            onValueChange={(value) =>
              patch({ tagMode: value === 'any' ? undefined : (value as 'all' | 'none') })
            }
          >
            <SelectTrigger className="w-32" aria-label="Tag mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tagModeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-amount-min" className="text-xs text-muted-foreground">
            Amount
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="filter-amount-min"
              type="number"
              className="w-24"
              placeholder="Min"
              value={filters.amountMin ?? ''}
              onChange={(event) =>
                patch({
                  amountMin: event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
            />
            <Input
              type="number"
              className="w-24"
              placeholder="Max"
              aria-label="Amount max"
              value={filters.amountMax ?? ''}
              onChange={(event) =>
                patch({
                  amountMax: event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Currency</Label>
          <Select
            value={filters.currency ?? 'all'}
            onValueChange={(value) => patch({ currency: value === 'all' ? undefined : value })}
          >
            <SelectTrigger className="w-28" aria-label="Currency filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {currencies.map((currency) => (
                <SelectItem key={currency.code} value={currency.code}>
                  {currency.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select
            value={filters.type ?? 'all'}
            onValueChange={(value) =>
              patch({ type: value === 'all' ? undefined : (value as TransactionType) })
            }
          >
            <SelectTrigger className="w-32" aria-label="Type filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeSelectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-search" className="text-xs text-muted-foreground">
            Search
          </Label>
          <Input
            id="filter-search"
            className="w-52"
            placeholder="Description, payee, notes, tags"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-xs"
            >
              {chip.label}
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={chip.onRemove}
              >
                <IconX className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  )
}
