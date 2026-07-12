import { lazy, Suspense, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TransactionListItem } from '@/components/transactions/TransactionListItem'
import { useTransactions } from '@/hooks/useTransactions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { formatCurrency, toNameById } from '@/lib/utils'
import type { Transaction } from '@/types'

// echarts is heavy; load it only when the categories tab first renders.
const SpendingByCategory = lazy(() =>
  import('@/components/SpendingByCategory').then((module) => ({
    default: module.SpendingByCategory,
  })),
)

interface CurrencySummary {
  currency: string
  netBalance: number
  totalSpend: number
}

function summarizeByCurrency(transactions: Transaction[]): CurrencySummary[] {
  const byCurrency = new Map<string, { netBalance: number; totalSpend: number }>()
  for (const transaction of transactions) {
    const currency = transaction.currency || 'USD'
    const summary = byCurrency.get(currency) ?? { netBalance: 0, totalSpend: 0 }
    summary.netBalance += transaction.amount
    if (transaction.amount < 0) {
      summary.totalSpend += Math.abs(transaction.amount)
    }
    byCurrency.set(currency, summary)
  }
  return Array.from(byCurrency.entries())
    .map(([currency, sums]) => ({ currency, ...sums }))
    .sort((first, second) => second.totalSpend - first.totalSpend)
}

export function DashboardPage() {
  const transactionsQuery = useTransactions()
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()

  const transactions = useMemo(() => transactionsQuery.data ?? [], [transactionsQuery.data])

  const accountNameById = useMemo(() => toNameById(accountsQuery.data), [accountsQuery.data])

  const categoryNameById = useMemo(
    () => toNameById(categoriesQuery.data),
    [categoriesQuery.data],
  )

  const currencySummaries = useMemo(() => summarizeByCurrency(transactions), [transactions])

  const recentTransactions = useMemo(() => transactions.slice(0, 8), [transactions])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your accounts and spending</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Net balance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {currencySummaries.map((summary) => (
              <div key={summary.currency} className="text-2xl font-semibold tabular-nums">
                {formatCurrency(summary.netBalance, summary.currency)}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total spend
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {currencySummaries.map((summary) => (
              <div key={summary.currency} className="text-2xl font-semibold tabular-nums">
                {formatCurrency(summary.totalSpend, summary.currency)}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="recent">
            <TabsList>
              <TabsTrigger value="recent">Recent transactions</TabsTrigger>
              <TabsTrigger value="categories">Spending by category</TabsTrigger>
            </TabsList>
            <TabsContent value="recent">
              {transactionsQuery.isLoading ? (
                <p className="py-6 text-sm text-muted-foreground">Loading transactions...</p>
              ) : recentTransactions.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No transactions yet.</p>
              ) : (
                <ul className="-mx-6 divide-y">
                  {recentTransactions.map((transaction) => (
                    <TransactionListItem
                      key={transaction.id}
                      transaction={transaction}
                      accountName={
                        accountNameById.get(transaction.account_id) ?? transaction.account_id
                      }
                      categoryName={
                        transaction.category_id
                          ? categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
                          : 'Uncategorized'
                      }
                      baseCurrencyCode="PEN"
                      showDate
                    />
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="categories">
              {transactions.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No spending recorded yet.</p>
              ) : (
                <Suspense
                  fallback={<p className="py-6 text-sm text-muted-foreground">Loading charts...</p>}
                >
                  <SpendingByCategory
                    transactions={transactions}
                    categoryNameById={categoryNameById}
                  />
                </Suspense>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
