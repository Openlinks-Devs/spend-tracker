import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import type { SummaryRow } from '@/types'

export interface SummaryTilesProps {
  summary: SummaryRow[]
  currency: string
}

const zeroedSummaryRow = { income: 0, spend: 0, net: 0, count: 0 }

export function SummaryTiles({ summary, currency }: SummaryTilesProps) {
  const summaryRow = summary.find((row) => row.currency === currency) ?? {
    currency,
    ...zeroedSummaryRow,
  }

  const income = formatCurrency(summaryRow.income, currency)
  const spend = formatCurrency(summaryRow.spend, currency)
  const net = formatCurrency(summaryRow.net, currency)
  const count = summaryRow.count

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Income</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{income}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Spend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{spend}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Net</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{net}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Count</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{count}</div>
        </CardContent>
      </Card>
    </div>
  )
}
