import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { axisCurrencyTooltip } from '@/lib/chartTooltip'
import { INCOME_COLOR, SPEND_COLOR, NET_COLOR } from '@/lib/echartsTheme'
import { formatDate } from '@/lib/utils'
import type { SeriesRow } from '@/types'

interface IncomeExpenseChartProps {
  rows: SeriesRow[]
  currency: string
}

export function IncomeExpenseChart({ rows, currency }: IncomeExpenseChartProps) {
  const option = useMemo(
    () => ({
      // Colours are pinned per series, not taken from the categorical palette by
      // index. Income and spend are opposite poles of one measure, so they carry
      // the reserved polarity pair; picking them off an identity palette is what
      // used to paint spend green.
      tooltip: { trigger: 'axis' as const, formatter: axisCurrencyTooltip(currency) },
      legend: { data: ['Income', 'Spend', 'Net'], top: 0 },
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
          itemStyle: { color: INCOME_COLOR, borderRadius: [4, 4, 0, 0] },
          data: rows.map((seriesRow) => seriesRow.income),
        },
        {
          name: 'Spend',
          type: 'bar' as const,
          itemStyle: { color: SPEND_COLOR, borderRadius: [4, 4, 0, 0] },
          data: rows.map((seriesRow) => seriesRow.spend),
        },
        {
          // Neutral ink, and a line rather than a bar, so net reads as the
          // derived midpoint of the two poles instead of a third category.
          name: 'Net',
          type: 'line' as const,
          itemStyle: { color: NET_COLOR },
          lineStyle: { color: NET_COLOR, width: 2 },
          symbolSize: 8,
          data: rows.map((seriesRow) => seriesRow.net),
        },
      ],
    }),
    [rows, currency],
  )
  return <EChart option={option} height={288} />
}
