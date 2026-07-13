import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import type { AccountRow } from '@/types'

// Net can be positive (money in) or negative (money out), so bars are colored by
// sign rather than by the categorical palette: green for a positive net, red for
// a negative one.
const POSITIVE_NET_COLOR = '#16a34a'
const NEGATIVE_NET_COLOR = '#dc2626'

interface AccountNetChartProps {
  rows: AccountRow[]
  accountNameById: Map<string, string>
}

export function AccountNetChart({ rows, accountNameById }: AccountNetChartProps) {
  const option = useMemo(() => {
    const sortedRows = [...rows].sort((firstRow, secondRow) => secondRow.net - firstRow.net)
    return {
      tooltip: { trigger: 'item' as const },
      grid: { left: 110, right: 24, top: 24, bottom: 64 },
      xAxis: { type: 'value' as const, axisLabel: { rotate: 60 } },
      yAxis: {
        type: 'category' as const,
        inverse: true,
        data: sortedRows.map(
          (accountRow) => accountNameById.get(accountRow.accountId) ?? accountRow.accountId,
        ),
      },
      series: [
        {
          type: 'bar' as const,
          data: sortedRows.map((accountRow) => ({
            value: accountRow.net,
            itemStyle: { color: accountRow.net >= 0 ? POSITIVE_NET_COLOR : NEGATIVE_NET_COLOR },
          })),
        },
      ],
    }
  }, [rows, accountNameById])
  return <EChart option={option} height={288} />
}
