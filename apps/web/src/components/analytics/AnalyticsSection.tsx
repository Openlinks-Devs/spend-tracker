import { useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CurrencySwitcher } from '@/components/analytics/CurrencySwitcher'
import { SummaryTiles } from '@/components/analytics/SummaryTiles'
import { CategoryPieChart } from '@/components/analytics/charts/CategoryPieChart'
import { IncomeExpenseChart } from '@/components/analytics/charts/IncomeExpenseChart'
import { SpendCalendarHeatmap } from '@/components/analytics/charts/SpendCalendarHeatmap'
import { SpendingOverTimeChart } from '@/components/analytics/charts/SpendingOverTimeChart'
import { TagBarChart } from '@/components/analytics/charts/TagBarChart'
import { useCategories } from '@/hooks/useCategories'
import { useTransactionAnalytics } from '@/hooks/useTransactionAnalytics'
import { toSearchParams, type TransactionFilterState } from '@/lib/filterParams'
import { toErrorMessage } from '@/lib/api'
import { toNameById } from '@/lib/utils'
import type { SummaryRow } from '@/types'

const DEFAULT_DISPLAY_CURRENCY = 'USD'

// Picks the currency the ledger uses the most: the summary row with the highest
// transaction count. Falls back to the first row (all rows have equal or zero
// count) and finally to a sensible default when there is no summary at all.
export function mostUsedCurrency(summary: SummaryRow[]): string {
  if (summary.length === 0) return DEFAULT_DISPLAY_CURRENCY
  let mostUsedRow = summary[0]
  for (const summaryRow of summary) {
    if (summaryRow.count > mostUsedRow.count) {
      mostUsedRow = summaryRow
    }
  }
  return mostUsedRow.currency
}

// Honors an explicit currency preference only while that currency still appears
// in the summary. Another filter can remove the preferred currency entirely, so
// falling back to the most-used currency keeps the charts populated instead of
// stranding the view on an empty currency the switcher no longer offers.
export function resolveDisplayCurrency(
  currencyPreference: string | undefined,
  summary: SummaryRow[],
): string {
  const hasPreferredCurrency =
    currencyPreference !== undefined &&
    summary.some((summaryRow) => summaryRow.currency === currencyPreference)
  return hasPreferredCurrency ? currencyPreference : mostUsedCurrency(summary)
}

type AnalyticsBucket = 'day' | 'week' | 'month'

const BUCKET_OPTIONS: { value: AnalyticsBucket; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

interface AnalyticsSectionProps {
  filters: TransactionFilterState
  setFilters: (next: Partial<TransactionFilterState>) => void
  listRoute?: string
}

interface ChartCardProps {
  title: string
  className?: string
  children: ReactNode
}

function ChartCard({ title, className, children }: ChartCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function AnalyticsSection({
  filters,
  setFilters,
  listRoute = '/transactions',
}: AnalyticsSectionProps) {
  const [bucket, setBucket] = useState<AnalyticsBucket>('month')
  const location = useLocation()
  const navigate = useNavigate()

  // A chart drill-down should land the user on the filtered list. When the list
  // is already on-screen (the transactions page), filter in place; otherwise
  // navigate to the list route carrying the merged filters in the URL so the
  // full filtered view opens with them applied.
  const applyDrillDown = (partial: Partial<TransactionFilterState>) => {
    if (location.pathname === listRoute) {
      setFilters(partial)
      return
    }
    const nextFilters = { ...filters, ...partial }
    navigate(`${listRoute}?${toSearchParams(nextFilters).toString()}`)
  }

  // The over-time/income-expense series follow the selected bucket, while the
  // heatmap always needs day granularity. When bucket is already 'day' both
  // hooks resolve to the same query key, so React Query serves one shared
  // request rather than issuing a duplicate.
  const primaryAnalytics = useTransactionAnalytics(filters, bucket)
  const dayAnalytics = useTransactionAnalytics(filters, 'day')

  const categoriesQuery = useCategories()
  const categoryNameById = useMemo(
    () => toNameById(categoriesQuery.data),
    [categoriesQuery.data],
  )

  const summary = useMemo(() => primaryAnalytics.data?.summary ?? [], [primaryAnalytics.data])

  const displayCurrency = resolveDisplayCurrency(filters.currency, summary)

  const currencies = useMemo(
    () => Array.from(new Set(summary.map((summaryRow) => summaryRow.currency))),
    [summary],
  )

  // Every aggregate is grouped by currency; a chart only makes sense for one
  // currency at a time, so narrow each array to the currency on display.
  const seriesForCurrency = useMemo(
    () =>
      (primaryAnalytics.data?.series ?? []).filter(
        (seriesRow) => seriesRow.currency === displayCurrency,
      ),
    [primaryAnalytics.data, displayCurrency],
  )
  const categoriesForCurrency = useMemo(
    () =>
      (primaryAnalytics.data?.byCategory ?? []).filter(
        (categoryRow) => categoryRow.currency === displayCurrency,
      ),
    [primaryAnalytics.data, displayCurrency],
  )
  const tagsForCurrency = useMemo(
    () =>
      (primaryAnalytics.data?.byTag ?? []).filter((tagRow) => tagRow.currency === displayCurrency),
    [primaryAnalytics.data, displayCurrency],
  )
  const daySeriesForCurrency = useMemo(
    () =>
      (dayAnalytics.data?.series ?? []).filter(
        (seriesRow) => seriesRow.currency === displayCurrency,
      ),
    [dayAnalytics.data, displayCurrency],
  )

  const summaryForCurrency = useMemo(
    () => summary.filter((summaryRow) => summaryRow.currency === displayCurrency),
    [summary, displayCurrency],
  )

  const isLoading = primaryAnalytics.isLoading
  const hasData = summary.length > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {BUCKET_OPTIONS.map((bucketOption) => (
            <Button
              key={bucketOption.value}
              type="button"
              variant={bucket === bucketOption.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBucket(bucketOption.value)}
            >
              {bucketOption.label}
            </Button>
          ))}
        </div>
        <CurrencySwitcher
          currencies={currencies}
          value={displayCurrency}
          onChange={(currency) => setFilters({ currency })}
        />
      </div>

      {primaryAnalytics.isError ? (
        <p className="py-6 text-sm text-destructive">{toErrorMessage(primaryAnalytics.error)}</p>
      ) : isLoading ? (
        <p className="py-6 text-sm text-muted-foreground">Loading analytics...</p>
      ) : !hasData ? (
        <p className="py-6 text-sm text-muted-foreground">
          No analytics data for the selected filters.
        </p>
      ) : (
        <>
          <SummaryTiles summary={summaryForCurrency} currency={displayCurrency} />

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Spending over time">
              <SpendingOverTimeChart
                rows={seriesForCurrency}
                onSelect={(window) =>
                  applyDrillDown({ range: 'custom', from: window.from, to: window.to })
                }
              />
            </ChartCard>
            <ChartCard title="Income vs spend">
              <IncomeExpenseChart rows={seriesForCurrency} />
            </ChartCard>
            <ChartCard title="Spending by category">
              <CategoryPieChart
                rows={categoriesForCurrency}
                categoryNameById={categoryNameById}
                onSelect={(categoryId) => applyDrillDown({ categories: [categoryId] })}
              />
            </ChartCard>
            <ChartCard title="Top tags">
              <TagBarChart
                rows={tagsForCurrency}
                onSelect={(tag) => applyDrillDown({ tags: [tag], tagMatch: 'any' })}
              />
            </ChartCard>
            <ChartCard title="Daily spending" className="lg:col-span-2">
              <SpendCalendarHeatmap rows={daySeriesForCurrency} />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  )
}
