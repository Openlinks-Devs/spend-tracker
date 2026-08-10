import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { withOtherBucket } from '@/lib/echartsTheme'
import type { CategoryRow } from '@/types'

interface CategoryPieChartProps {
  rows: CategoryRow[]
  categoryNameById: Map<string, string>
  onSelect?: (categoryId: string) => void
}

export function CategoryPieChart({ rows, categoryNameById, onSelect }: CategoryPieChartProps) {
  const option = useMemo(() => {
    // A pie has no axis, so colour is the only thing identifying a slice - which
    // makes it the one chart here that genuinely needs distinct hues. It is also
    // where cycling did real damage: every category with spend was handed to an
    // 8-hue palette, and with 43 categories ECharts wrapped around, so the 1st
    // and 9th slice were the same colour. Cap at the palette length and fold the
    // tail into one neutral "Other" slice instead.
    const spending = rows
      .filter((categoryRow) => categoryRow.spend > 0)
      .sort((firstRow, secondRow) => secondRow.spend - firstRow.spend)
    const categoryIdByName = new Map(
      spending.map((categoryRow) => [
        categoryNameById.get(categoryRow.categoryId) ?? 'Uncategorized',
        categoryRow.categoryId,
      ]),
    )
    const slices = withOtherBucket(
      spending,
      (categoryRow) => categoryRow.spend,
      (categoryRow) => categoryNameById.get(categoryRow.categoryId) ?? 'Uncategorized',
    )

    return {
      tooltip: { trigger: 'item' as const, formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie' as const,
          radius: ['45%', '70%'],
          // 2px surface gap between segments, so adjacent slices stay separable
          // even when two hues are close.
          itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
          data: slices.map((slice) => ({
            value: slice.value,
            name: slice.name,
            itemStyle: { color: slice.color },
            // The aggregated bucket is not one category, so it is not clickable.
            categoryId: categoryIdByName.get(slice.name),
          })),
        },
      ],
    }
  }, [rows, categoryNameById])
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
