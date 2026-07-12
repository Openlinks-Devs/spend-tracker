import { useMemo, useState } from 'react'
import { EChart } from '@/components/EChart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'
import type { EChartsCoreOption } from 'echarts/core'
import type { Transaction } from '@/types'

// Validated categorical palette from the dataviz reference (light mode, 8 slots).
// Slice labels are always shown, which is the required relief for the three
// hues that sit below 3:1 contrast on a light surface.
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

interface CategorySpend {
  categoryName: string
  total: number
}

interface SpendingByCategoryProps {
  transactions: Transaction[]
  categoryNameById: Map<string, string>
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

export function SpendingByCategory({ transactions, categoryNameById }: SpendingByCategoryProps) {
  const [period, setPeriod] = useState<Period>('this-month')
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null)

  const expenses = useMemo(
    () => transactions.filter((transaction) => transaction.amount < 0),
    [transactions],
  )

  // Currencies ordered by all-time spend so the selector is stable across periods.
  const currencies = useMemo(() => {
    const totals = new Map<string, number>()
    for (const expense of expenses) {
      const currency = expense.currency || 'USD'
      totals.set(currency, (totals.get(currency) ?? 0) + Math.abs(expense.amount))
    }
    return Array.from(totals.entries())
      .sort((first, second) => second[1] - first[1])
      .map(([currency]) => currency)
  }, [expenses])

  const currency = selectedCurrency ?? currencies[0] ?? 'USD'

  // Colors follow the category across every filter change, so a category never
  // gets repainted when the period or currency selection shrinks the set.
  const colorByCategory = useMemo(() => {
    const totals = new Map<string, number>()
    for (const expense of expenses) {
      const categoryName = categoryNameById.get(expense.category_id) ?? 'Uncategorized'
      totals.set(categoryName, (totals.get(categoryName) ?? 0) + Math.abs(expense.amount))
    }
    const ranked = Array.from(totals.entries()).sort((first, second) => second[1] - first[1])
    const colors = new Map<string, string>()
    ranked.forEach(([categoryName], index) => {
      colors.set(categoryName, categoricalPalette[index] ?? overflowSliceColor)
    })
    return colors
  }, [expenses, categoryNameById])

  const categorySpends = useMemo<CategorySpend[]>(() => {
    const { start, end } = getPeriodRange(period)
    const totals = new Map<string, number>()
    for (const expense of expenses) {
      if ((expense.currency || 'USD') !== currency) continue
      const createdAt = new Date(expense.created_at)
      if (start && createdAt < start) continue
      if (end && createdAt >= end) continue
      const categoryName = categoryNameById.get(expense.category_id) ?? 'Uncategorized'
      totals.set(categoryName, (totals.get(categoryName) ?? 0) + Math.abs(expense.amount))
    }
    return Array.from(totals.entries())
      .map(([categoryName, total]) => ({ categoryName, total }))
      .sort((first, second) => second.total - first.total)
  }, [expenses, categoryNameById, period, currency])

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
    const periodTotal = categorySpends.reduce(
      (sum, categorySpend) => sum + categorySpend.total,
      0,
    )
    return {
      tooltip: {
        trigger: 'item',
        valueFormatter: (value: unknown) => formatCurrency(Number(value), currency),
      },
      title: {
        text: formatCurrency(periodTotal, currency),
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
          // 2px surface gap between slices, per mark spec.
          itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 4 },
          label: { formatter: '{b}  {d}%', color: chartInk },
          data: slices,
        },
      ],
    }
  }, [categorySpends, colorByCategory, currency])

  return (
    <div className="space-y-4 py-4">
      <div className="flex flex-wrap gap-3">
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
        <Select value={currency} onValueChange={setSelectedCurrency}>
          <SelectTrigger className="w-28" aria-label="Currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencies.map((currencyOption) => (
              <SelectItem key={currencyOption} value={currencyOption}>
                {currencyOption}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {categorySpends.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No expenses in {currency} for this period.
        </p>
      ) : (
        <EChart option={chartOption} height={420} />
      )}
    </div>
  )
}
