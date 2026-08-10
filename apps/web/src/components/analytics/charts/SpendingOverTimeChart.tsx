import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { SPEND_COLOR } from '@/lib/echartsTheme'
import { formatDate } from '@/lib/utils'
import type { SeriesRow } from '@/types'

interface SpendingOverTimeChartProps {
  rows: SeriesRow[]
  onSelect?: (window: { from: string; to: string }) => void
}

// Derives the exclusive end of a bucket. Prefers the next bucket's start; when
// the clicked bucket is the last one it extends by the interval between the two
// most recent buckets so the window still covers a full period.
function resolveBucketEnd(rows: SeriesRow[], index: number): string {
  const nextRow = rows[index + 1]
  if (nextRow) return nextRow.bucketStart
  const currentStart = new Date(rows[index].bucketStart).getTime()
  const previousRow = rows[index - 1]
  if (!previousRow) return rows[index].bucketStart
  const interval = currentStart - new Date(previousRow.bucketStart).getTime()
  return new Date(currentStart + interval).toISOString()
}

export function SpendingOverTimeChart({ rows, onSelect }: SpendingOverTimeChartProps) {
  const option = useMemo(
    () => ({
      // One series, and it is spend - so it wears the spend colour, not the
      // first slot of the identity palette (which is why it used to be blue).
      tooltip: { trigger: 'axis' as const },
      grid: { left: 48, right: 16, top: 24, bottom: 40 },
      xAxis: {
        type: 'category' as const,
        data: rows.map((seriesRow) => formatDate(seriesRow.bucketStart)),
      },
      yAxis: { type: 'value' as const },
      series: [
        {
          type: 'bar' as const,
          itemStyle: { color: SPEND_COLOR, borderRadius: [4, 4, 0, 0] },
          data: rows.map((seriesRow, bucketIndex) => ({
            value: seriesRow.spend,
            window: { from: seriesRow.bucketStart, to: resolveBucketEnd(rows, bucketIndex) },
          })),
        },
      ],
    }),
    [rows],
  )
  return (
    <EChart
      option={option}
      height={288}
      onEvents={{
        click: (params) => {
          const clicked = params.data as { window?: { from: string; to: string } } | undefined
          if (onSelect && clicked?.window) onSelect(clicked.window)
        },
      }}
    />
  )
}
