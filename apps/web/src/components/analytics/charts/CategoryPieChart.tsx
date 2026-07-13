import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { palette } from '@/lib/echartsTheme'
import type { CategoryRow } from '@/types'

interface CategoryPieChartProps {
  rows: CategoryRow[]
  categoryNameById: Map<string, string>
  onSelect?: (categoryId: string) => void
}

export function CategoryPieChart({ rows, categoryNameById, onSelect }: CategoryPieChartProps) {
  const option = useMemo(
    () => ({
      color: palette,
      tooltip: { trigger: 'item' as const, formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie' as const,
          radius: ['45%', '70%'],
          data: rows
            .filter((categoryRow) => categoryRow.spend > 0)
            .map((categoryRow) => ({
              value: categoryRow.spend,
              name: categoryNameById.get(categoryRow.categoryId) ?? 'Uncategorized',
              categoryId: categoryRow.categoryId,
            })),
        },
      ],
    }),
    [rows, categoryNameById],
  )
  return (
    <EChart
      option={option}
      height={288}
      onEvents={{
        click: (params) => {
          const clicked = params.data as { categoryId?: string } | undefined
          if (onSelect && clicked?.categoryId) onSelect(clicked.categoryId)
        },
      }}
    />
  )
}
