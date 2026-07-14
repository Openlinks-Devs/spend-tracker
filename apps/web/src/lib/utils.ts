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

// Peruvian soles amounts are shown with the "S/" symbol instead of the "PEN"
// currency code, so soles amounts use a plain grouped decimal formatter.
const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})

const dayLabelFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const dayLabelWithYearFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

function isSameDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

export function formatCurrency(amount: number, currency: string): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0
  const currencyCode = currency || 'USD'
  // Soles: show "S/ 1,234.56" (sign ahead of the symbol, like Intl's currency
  // style) instead of "PEN 1,234.56".
  if (currencyCode === 'PEN') {
    const sign = safeAmount < 0 ? '-' : ''
    return `${sign}S/ ${decimalFormatter.format(Math.abs(safeAmount))}`
  }
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

export function formatTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return timeFormatter.format(parsed)
}

export function formatDayLabel(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  const today = new Date()
  if (isSameDay(parsed, today)) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(parsed, yesterday)) return 'Yesterday'
  const formatter =
    parsed.getFullYear() === today.getFullYear() ? dayLabelFormatter : dayLabelWithYearFormatter
  return formatter.format(parsed)
}

// Converts an ISO timestamp to the local "YYYY-MM-DDTHH:mm" value that
// datetime-local inputs require.
export function toDatetimeLocalValue(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

// Local-date key ("2026-7-9") used to group ledger entries by calendar day.
export function toDayKey(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return `${parsed.getFullYear()}-${parsed.getMonth() + 1}-${parsed.getDate()}`
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
