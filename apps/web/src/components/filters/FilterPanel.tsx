import { useState } from 'react'
import { IconFilter } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { DateTimePicker } from '@/components/ui/date-time-picker'
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
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useTags } from '@/hooks/useTags'
import { useTransactionFilters } from '@/hooks/useTransactionFilters'
import { toDatetimeLocalValue } from '@/lib/utils'
import type { TransactionFilterState } from '@/lib/filterParams'

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-3-months', label: 'Last 3 months' },
  { value: 'this-year', label: 'This year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

const TYPE_OPTIONS: { value: TransactionFilterState['type']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
]

// Converts an ISO string filter value into the datetime-local format the
// picker expects, treating an unset filter as an empty picker.
function toPickerValue(isoValue: string | undefined): string {
  return isoValue ? toDatetimeLocalValue(isoValue) : ''
}

// Turns a datetime-local picker value back into an ISO string, or undefined
// when the picker is cleared.
function toIsoValue(pickerValue: string): string | undefined {
  return pickerValue ? new Date(pickerValue).toISOString() : undefined
}

// Parses a number input into a stored filter value: blank clears the filter,
// while any finite number (including 0) is preserved.
function toAmountValue(rawValue: string): number | undefined {
  if (rawValue.trim() === '') return undefined
  const parsedValue = Number(rawValue)
  return Number.isFinite(parsedValue) ? parsedValue : undefined
}

export function FilterPanel() {
  const { filters, setFilters } = useTransactionFilters()
  const [isOpen, setIsOpen] = useState(false)

  const accounts = useAccounts().data ?? []
  const categories = useCategories().data ?? []
  const tags = useTags().data ?? []
  // Distinct currencies across the user's accounts, so the filter only offers
  // currencies that actually exist in the ledger.
  const currencyOptions = Array.from(new Set(accounts.map((account) => account.currency))).sort()

  function handleRangeChange(range: string) {
    // Leaving a preset behind clears any lingering custom bounds so the two
    // never disagree; entering "custom" keeps whatever bounds are set.
    if (range === 'custom') {
      setFilters({ range })
    } else {
      setFilters({ range, from: undefined, to: undefined })
    }
  }

  function toggleAccount(accountId: string) {
    const nextAccounts = filters.accounts.includes(accountId)
      ? filters.accounts.filter((selectedId) => selectedId !== accountId)
      : [...filters.accounts, accountId]
    setFilters({ accounts: nextAccounts })
  }

  function toggleCategory(categoryId: string) {
    const nextCategories = filters.categories.includes(categoryId)
      ? filters.categories.filter((selectedId) => selectedId !== categoryId)
      : [...filters.categories, categoryId]
    setFilters({ categories: nextCategories })
  }

  function toggleTag(tag: string) {
    const nextTags = filters.tags.includes(tag)
      ? filters.tags.filter((selectedTag) => selectedTag !== tag)
      : [...filters.tags, tag]
    setFilters({ tags: nextTags })
  }

  const accountsLabel =
    filters.accounts.length > 0 ? `Accounts (${filters.accounts.length})` : 'Accounts'
  const categoriesLabel =
    filters.categories.length > 0 ? `Categories (${filters.categories.length})` : 'Categories'
  const tagsLabel = filters.tags.length > 0 ? `Tags (${filters.tags.length})` : 'Tags'

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen((previousOpen) => !previousOpen)}
        aria-expanded={isOpen}
      >
        <IconFilter className="h-4 w-4" />
        Filters
      </Button>

      {isOpen ? (
        <div className="grid gap-4 rounded-md border bg-card p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Date range</Label>
            <Select value={filters.range} onValueChange={handleRangeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select a range" />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((rangeOption) => (
                  <SelectItem key={rangeOption.value} value={rangeOption.value}>
                    {rangeOption.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              {TYPE_OPTIONS.map((typeOption) => (
                <Button
                  key={typeOption.value}
                  type="button"
                  variant={filters.type === typeOption.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilters({ type: typeOption.value })}
                >
                  {typeOption.label}
                </Button>
              ))}
            </div>
          </div>

          {filters.range === 'custom' ? (
            <>
              <div className="space-y-1.5">
                <Label>From</Label>
                <DateTimePicker
                  value={toPickerValue(filters.from)}
                  onChange={(pickerValue) => setFilters({ from: toIsoValue(pickerValue) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <DateTimePicker
                  value={toPickerValue(filters.to)}
                  onChange={(pickerValue) => setFilters({ to: toIsoValue(pickerValue) })}
                />
              </div>
            </>
          ) : null}

          <div className="space-y-1.5">
            <Label>Accounts</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-start font-normal">
                  {accountsLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-72 overflow-y-auto">
                {accounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No accounts yet.</p>
                ) : (
                  <div className="space-y-2">
                    {accounts.map((account) => (
                      <label key={account.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={filters.accounts.includes(account.id)}
                          onChange={() => toggleAccount(account.id)}
                        />
                        <span>{account.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label>Categories</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-start font-normal">
                  {categoriesLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-72 overflow-y-auto">
                {categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No categories yet.</p>
                ) : (
                  <div className="space-y-2">
                    {categories.map((category) => (
                      <label key={category.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={filters.categories.includes(category.id)}
                          onChange={() => toggleCategory(category.id)}
                        />
                        <span>{category.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label>Tags</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-start font-normal">
                  {tagsLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-72 overflow-y-auto">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Match</span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={filters.tagMatch === 'any' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFilters({ tagMatch: 'any' })}
                    >
                      Any
                    </Button>
                    <Button
                      type="button"
                      variant={filters.tagMatch === 'all' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFilters({ tagMatch: 'all' })}
                    >
                      All
                    </Button>
                  </div>
                </div>
                {tags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tags yet.</p>
                ) : (
                  <div className="space-y-2">
                    {tags.map((tag) => (
                      <label key={tag} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={filters.tags.includes(tag)}
                          onChange={() => toggleTag(tag)}
                        />
                        <span>{tag}</span>
                      </label>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Select
              value={filters.currency ?? 'all'}
              onValueChange={(value) =>
                setFilters({ currency: value === 'all' ? undefined : value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All currencies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All currencies</SelectItem>
                {currencyOptions.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Amount</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                value={filters.min ?? ''}
                onChange={(event) => setFilters({ min: toAmountValue(event.target.value) })}
                placeholder="Min"
                aria-label="Minimum amount"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <Input
                type="number"
                inputMode="decimal"
                value={filters.max ?? ''}
                onChange={(event) => setFilters({ max: toAmountValue(event.target.value) })}
                placeholder="Max"
                aria-label="Maximum amount"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
