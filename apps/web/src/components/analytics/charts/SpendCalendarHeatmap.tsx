import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import type { SeriesRow } from '@/types'

interface SpendCalendarHeatmapProps {
  rows: SeriesRow[]
}

// Zero-padded local calendar-day key (YYYY-MM-DD) that the ECharts calendar
// coordinate system expects. toDayKey in lib/utils is unpadded, so build it here.
function toCalendarDayKey(isoValue: string): string {
  const parsed = new Date(isoValue)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

export function SpendCalendarHeatmap({ rows }: SpendCalendarHeatmapProps) {
  const option = useMemo(() => {
    const dailySpend = rows.map((seriesRow) => ({
      dayKey: toCalendarDayKey(seriesRow.bucketStart),
      spend: seriesRow.spend,
    }))
    const dayKeys = dailySpend.map((entry) => entry.dayKey).sort()
    const rangeStart = dayKeys[0]
    const rangeEnd = dayKeys[dayKeys.length - 1]
    const maxSpend = dailySpend.reduce((runningMax, entry) => Math.max(runningMax, entry.spend), 0)

    return {
      tooltip: { trigger: 'item' as const, formatter: '{c}' },
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
          data: dailySpend.map((entry) => [entry.dayKey, entry.spend] as [string, number]),
        },
      ],
    }
  }, [rows])

  if (rows.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        No spending data for this period.
      </div>
    )
  }

  return <EChart option={option} height={288} />
}
