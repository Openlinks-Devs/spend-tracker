import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { formatCurrency, formatDayLabel } from '@/lib/utils'
import type { SeriesRow } from '@/types'

interface SpendCalendarHeatmapProps {
  rows: SeriesRow[]
  currency: string
}

const MONTHS_SHOWN = 6

// Zero-padded local calendar-day key (YYYY-MM-DD) that the ECharts calendar
// coordinate system expects. toDayKey in lib/utils is unpadded, so build it here.
function toCalendarDayKey(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// The calendar-day key MONTHS_SHOWN months before the given key. The time suffix
// forces local parsing so the shift does not cross a day boundary in the user's
// timezone.
function monthsBeforeKey(dayKey: string, months: number): string {
  const date = new Date(`${dayKey}T00:00:00`)
  date.setMonth(date.getMonth() - months)
  return toCalendarDayKey(date)
}

export function SpendCalendarHeatmap({ rows, currency }: SpendCalendarHeatmapProps) {
  const option = useMemo(() => {
    const dailySpend = rows.map((seriesRow) => ({
      dayKey: toCalendarDayKey(new Date(seriesRow.bucketStart)),
      spend: seriesRow.spend,
    }))
    // Cap the calendar to the last MONTHS_SHOWN months so a long ledger history
    // does not shrink the cells to an unreadable size. Anchor on the most recent
    // day in the data (not today) so the window always lands on populated cells.
    // Zero-padded keys sort and compare lexically, so string ordering is safe.
    const sortedKeys = dailySpend.map((entry) => entry.dayKey).sort()
    const rangeEnd = sortedKeys[sortedKeys.length - 1]
    const rangeStart = rangeEnd ? monthsBeforeKey(rangeEnd, MONTHS_SHOWN) : sortedKeys[0]
    const recentSpend = dailySpend.filter((entry) => entry.dayKey >= rangeStart)
    const maxSpend = recentSpend.reduce((runningMax, entry) => Math.max(runningMax, entry.spend), 0)

    return {
      tooltip: {
        trigger: 'item' as const,
        // Calendar-heatmap items carry value as [dayKey, spend]. The raw '{c}'
        // template renders that array verbatim, so format the day and amount
        // instead. dayKey is a local YYYY-MM-DD, appended with a time so it
        // parses as local rather than UTC (which would shift the day back).
        formatter: (params: { value: [string, number] }) => {
          const [dayKey, spend] = params.value
          return `${formatDayLabel(`${dayKey}T00:00:00`)}<br/>${formatCurrency(spend, currency)}`
        },
      },
      visualMap: {
        min: 0,
        max: maxSpend > 0 ? maxSpend : 1,
        calculable: true,
        orient: 'horizontal' as const,
        left: 'center' as const,
        bottom: 0,
      },
      calendar: {
        range: rangeStart === rangeEnd ? rangeStart : [rangeStart, rangeEnd],
        cellSize: ['auto', 16] as [string, number],
        top: 24,
        left: 32,
        right: 16,
      },
      series: [
        {
          type: 'heatmap' as const,
          coordinateSystem: 'calendar' as const,
          data: recentSpend.map((entry) => [entry.dayKey, entry.spend] as [string, number]),
        },
      ],
    }
  }, [rows, currency])

  if (rows.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        No spending data for this period.
      </div>
    )
  }

  return <EChart option={option} height={288} />
}
