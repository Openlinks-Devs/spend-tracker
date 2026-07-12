import { useMemo, useState } from 'react'
import { EChart } from '@/components/EChart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { summarizeCategorySpend } from '@/lib/dashboardSummary'
import { formatCurrency } from '@/lib/utils'
import type { EChartsCoreOption } from 'echarts/core'
import type { Transaction } from '@/types'

// Validated categorical palette from the dataviz reference (light mode, 8 slots).
const categoricalPalette = [
  '#2a78d6',
  '#1baf7a',
  '#eda100',
  '#008300',
  '#4a3aa7',
  '#e34948',
  '#e87ba4',
  '#eb6834',
]
const overflowSliceColor = '#9aa1ac'
const chartInk = 'hsl(222.2 84% 4.9%)'

const periodOptions = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3-months', label: 'Last 3 months' },
  { value: 'this-year', label: 'This year' },
  { value: 'all', label: 'All time' },
] as const

type Period = (typeof periodOptions)[number]['value']

interface SpendingByCategoryProps {
  transactions: Transaction[]
  categoryNameById: Map<string, string>
  baseCurrencyCode: string
}

function getPeriodRange(period: Period): { start: Date | null; end: Date | null } {
  const now = new Date()
  switch (period) {
    case 'this-month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null }
    case 'last-month':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 1),
      }
    case 'last-3-months':
      return { start: new Date(now.getFullYear(), now.getMonth() - 2, 1), end: null }
    case 'this-year':
      return { start: new Date(now.getFullYear(), 0, 1), end: null }
    case 'all':
      return { start: null, end: null }
  }
}

export function SpendingByCategory({
  transactions,
  categoryNameById,
  baseCurrencyCode,
}: SpendingByCategoryProps) {
  const [period, setPeriod] = useState<Period>('this-month')

  // Colors follow the category across every period change, ranked by all-time
  // base spend so a category never gets repainted when the period shrinks the set.
  const colorByCategory = useMemo(() => {
    const ranked = summarizeCategorySpend(transactions, categoryNameById, {
      start: null,
      end: null,
    })
    const colors = new Map<string, string>()
    ranked.forEach((categorySpend, index) => {
      colors.set(categorySpend.categoryName, categoricalPalette[index] ?? overflowSliceColor)
    })
    return colors
  }, [transactions, categoryNameById])

  const categorySpends = useMemo(
    () => summarizeCategorySpend(transactions, categoryNameById, getPeriodRange(period)),
    [transactions, categoryNameById, period],
  )

  const hasIncompleteRates = useMemo(
    () =>
      transactions.some(
        (transaction) => transaction.type === 'expense' && transaction.base_amount === null,
      ),
    [transactions],
  )

  const chartOption = useMemo<EChartsCoreOption>(() => {
    const topCategories = categorySpends.slice(0, categoricalPalette.length)
    const overflowTotal = categorySpends
      .slice(categoricalPalette.length)
      .reduce((sum, categorySpend) => sum + categorySpend.total, 0)
    const slices = topCategories.map((categorySpend) => ({
      name: categorySpend.categoryName,
      value: Number(categorySpend.total.toFixed(2)),
      itemStyle: { color: colorByCategory.get(categorySpend.categoryName) ?? overflowSliceColor },
    }))
    if (overflowTotal > 0) {
      slices.push({
        name: 'Other',
        value: Number(overflowTotal.toFixed(2)),
        itemStyle: { color: overflowSliceColor },
      })
    }
    const periodTotal = categorySpends.reduce((sum, categorySpend) => sum + categorySpend.total, 0)
    return {
      tooltip: {
        trigger: 'item',
        valueFormatter: (value: unknown) => formatCurrency(Number(value), baseCurrencyCode),
      },
      title: {
        text: formatCurrency(periodTotal, baseCurrencyCode),
        subtext: 'total spend',
        left: 'center',
        top: '42%',
        textStyle: { fontSize: 18, color: chartInk },
        subtextStyle: { fontSize: 12 },
      },
      series: [
        {
          type: 'pie',
          radius: ['45%', '68%'],
          itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 4 },
          label: { formatter: '{b}  {d}%', color: chartInk },
          data: slices,
        },
      ],
    }
  }, [categorySpends, colorByCategory, baseCurrencyCode])

  return (
    <div className="space-y-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
          <SelectTrigger className="w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodOptions.map((periodOption) => (
              <SelectItem key={periodOption.value} value={periodOption.value}>
                {periodOption.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasIncompleteRates ? (
          <span className="text-xs text-muted-foreground">
            Some expenses are missing rates and are excluded from these totals.
          </span>
        ) : null}
      </div>
      {categorySpends.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">No spending in {baseCurrencyCode} for this period.</p>
      ) : (
        <EChart option={chartOption} height={420} />
      )}
    </div>
  )
}
