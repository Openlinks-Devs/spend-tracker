import { useMemo } from 'react'
import { EChart } from '@/components/EChart'
import { itemCurrencyTooltip } from '@/lib/chartTooltip'
import { INCOME_COLOR, SPEND_COLOR } from '@/lib/echartsTheme'
import type { AccountRow } from '@/types'

// Net can be positive (money in) or negative (money out), so bars are coloured by
// sign - the same polarity pair the income/spend chart uses, so one colour means
// one thing across the dashboard. The previous green/red pair was replaced
// because it measured protan ΔE 5.0: red-green colourblind viewers could not
// tell a positive account from a negative one.

interface AccountNetChartProps {
  rows: AccountRow[]
  currency: string
  accountNameById: Map<string, string>
}

export function AccountNetChart({ rows, currency, accountNameById }: AccountNetChartProps) {
  const option = useMemo(() => {
    const sortedRows = [...rows].sort((firstRow, secondRow) => secondRow.net - firstRow.net)
    return {
      tooltip: { trigger: 'item' as const, formatter: itemCurrencyTooltip(currency) },
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
            itemStyle: { color: accountRow.net >= 0 ? INCOME_COLOR : SPEND_COLOR },
          })),
        },
      ],
    }
  }, [rows, currency, accountNameById])
  return <EChart option={option} height={288} />
}
