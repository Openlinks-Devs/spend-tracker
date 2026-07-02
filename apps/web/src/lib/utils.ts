import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Intl formatters are relatively expensive to construct, so cache one per
// currency and reuse a single date formatter across the many table cells that
// render on every list re-render.
const currencyFormatters = new Map<string, Intl.NumberFormat>()

function currencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = currencyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency })
    currencyFormatters.set(currency, formatter)
  }
  return formatter
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export function formatCurrency(amount: number, currency: string): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0
  const currencyCode = currency || 'USD'
  try {
    return currencyFormatter(currencyCode).format(safeAmount)
  } catch {
    return `${safeAmount.toFixed(2)} ${currencyCode}`
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return dateFormatter.format(parsed)
}

// Builds an id -> name lookup shared by the dashboard and transactions tables.
export function toNameById<Item extends { id: string; name: string }>(
  items: Item[] | undefined,
): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const item of items ?? []) {
    lookup.set(item.id, item.name)
  }
  return lookup
}
