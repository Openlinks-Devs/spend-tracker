import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { palette } from '@/lib/echartsTheme'
import type { TagRow } from '@/types'

interface TagBarChartProps {
  rows: TagRow[]
  onSelect?: (tag: string) => void
}

export function TagBarChart({ rows, onSelect }: TagBarChartProps) {
  const option = useMemo(() => {
    const sortedRows = [...rows].sort((firstRow, secondRow) => secondRow.spend - firstRow.spend)
    return {
      color: palette,
      tooltip: { trigger: 'item' as const },
      grid: { left: 96, right: 24, top: 24, bottom: 64 },
      xAxis: { type: 'value' as const, axisLabel: { rotate: 60 } },
      yAxis: {
        type: 'category' as const,
        inverse: true,
        data: sortedRows.map((tagRow) => tagRow.tag),
      },
      series: [
        {
          type: 'bar' as const,
          data: sortedRows.map((tagRow) => ({ value: tagRow.spend, tag: tagRow.tag })),
        },
      ],
    }
  }, [rows])
  return (
    <EChart
      option={option}
      height={288}
      onEvents={{
        click: (params) => {
          const clicked = params.data as { tag?: string } | undefined
          if (onSelect && clicked?.tag) onSelect(clicked.tag)
        },
      }}
    />
  )
}
