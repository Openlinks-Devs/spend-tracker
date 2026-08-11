import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { itemCurrencyTooltip } from '@/lib/chartTooltip'
import { chartThemeFor } from '@/lib/echartsTheme'
import { useIsDarkTheme } from '@/hooks/useTheme'
import type { TagRow } from '@/types'

interface TagBarChartProps {
  rows: TagRow[]
  currency: string
  onSelect?: (tag: string) => void
}

// "Top tags" means top tags. Rendering every tag crushed the labels into an
// unreadable stack and let one long-tail bar set a scale that flattened the rest.
const TOP_TAGS_SHOWN = 12

export function TagBarChart({ rows, currency, onSelect }: TagBarChartProps) {
  const theme = chartThemeFor(useIsDarkTheme())
  const option = useMemo(() => {
    const sortedRows = [...rows]
      .sort((firstRow, secondRow) => secondRow.spend - firstRow.spend)
      .slice(0, TOP_TAGS_SHOWN)
    return {
      // Every bar is the same measure (spend) and the axis already names the
      // tag, so one colour. A rainbow here implied the tags were different
      // kinds of thing, and reused hues once there were more tags than slots.
      tooltip: { trigger: 'item' as const, formatter: itemCurrencyTooltip(currency) },
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
          itemStyle: { color: theme.spend, borderRadius: [0, 4, 4, 0] },
          data: sortedRows.map((tagRow) => ({ value: tagRow.spend, tag: tagRow.tag })),
        },
      ],
    }
  }, [rows, currency, theme])
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
