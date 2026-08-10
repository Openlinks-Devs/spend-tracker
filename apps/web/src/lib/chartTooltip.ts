import { formatCurrency } from '@/lib/utils'

// Chart tooltips were printing raw series values, so a summed bucket surfaced as
// "37636.219999999994" - binary floating point doing what it always does once you
// add a column of decimal amounts. These are money, so they are formatted with
// the same helper the rest of the app uses, which also settles thousands
// separators and the S/ symbol for soles.

interface TooltipParam {
  name?: string
  seriesName?: string
  axisValueLabel?: string
  marker?: string
  percent?: number
  value?: unknown
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  // Calendar-heatmap items carry [dayKey, value]; bar/pie items carry a number.
  if (Array.isArray(value)) return toNumber(value[value.length - 1])
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Tooltip for `trigger: 'item'` charts (pie slices, single bars). */
export function itemCurrencyTooltip(currency: string, options: { percent?: boolean } = {}) {
  return (params: TooltipParam) => {
    const amount = formatCurrency(toNumber(params.value), currency)
    const share =
      options.percent && typeof params.percent === 'number' ? ` (${params.percent}%)` : ''
    return `${params.name ?? ''}: ${amount}${share}`
  }
}

/** Tooltip for `trigger: 'axis'` charts, which receive one param per series. */
export function axisCurrencyTooltip(currency: string) {
  return (params: TooltipParam | TooltipParam[]) => {
    const seriesRows = Array.isArray(params) ? params : [params]
    if (seriesRows.length === 0) return ''
    const header = seriesRows[0].axisValueLabel ?? seriesRows[0].name ?? ''
    const lines = seriesRows.map(
      (row) =>
        `${row.marker ?? ''} ${row.seriesName ?? ''}: ${formatCurrency(toNumber(row.value), currency)}`,
    )
    return [header, ...lines].join('<br/>')
  }
}
