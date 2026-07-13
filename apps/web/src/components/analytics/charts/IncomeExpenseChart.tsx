import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { palette } from '@/lib/echartsTheme'
import { formatDate } from '@/lib/utils'
import type { SeriesRow } from '@/types'

interface IncomeExpenseChartProps {
  rows: SeriesRow[]
}

export function IncomeExpenseChart({ rows }: IncomeExpenseChartProps) {
  const option = useMemo(
    () => ({
      color: palette,
      tooltip: { trigger: 'axis' as const },
      legend: { data: ['Income', 'Spend', 'Net'] },
      grid: { left: 48, right: 16, top: 48, bottom: 40 },
      xAxis: {
        type: 'category' as const,
        data: rows.map((seriesRow) => formatDate(seriesRow.bucketStart)),
      },
      yAxis: { type: 'value' as const },
      series: [
        {
          name: 'Income',
          type: 'bar' as const,
          data: rows.map((seriesRow) => seriesRow.income),
        },
        {
          name: 'Spend',
          type: 'bar' as const,
          data: rows.map((seriesRow) => seriesRow.spend),
        },
        {
          name: 'Net',
          type: 'line' as const,
          data: rows.map((seriesRow) => seriesRow.net),
        },
      ],
    }),
    [rows],
  )
  return <EChart option={option} height={288} />
}
