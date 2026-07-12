import { lazy, Suspense, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TransactionListItem } from '@/components/transactions/TransactionListItem'
import { useTransactions } from '@/hooks/useTransactions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { useSettings } from '@/hooks/useSettings'
import { summarizeTransactions } from '@/lib/dashboardSummary'
import { formatCurrency, toNameById } from '@/lib/utils'

// echarts is heavy; load it only when the categories tab first renders.
const SpendingByCategory = lazy(() =>
  import('@/components/SpendingByCategory').then((module) => ({
    default: module.SpendingByCategory,
  })),
)

export function DashboardPage() {
  const transactionsQuery = useTransactions()
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()
  const settingsQuery = useSettings()

  const transactions = useMemo(() => transactionsQuery.data ?? [], [transactionsQuery.data])
  const baseCurrencyCode = settingsQuery.data?.base_currency_code ?? 'PEN'

  const accountNameById = useMemo(() => toNameById(accountsQuery.data), [accountsQuery.data])
  const categoryNameById = useMemo(() => toNameById(categoriesQuery.data), [categoriesQuery.data])

  const summary = useMemo(
    () => summarizeTransactions(transactions, baseCurrencyCode),
    [transactions, baseCurrencyCode],
  )

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
            <CardTitle className="text-sm font-medium text-muted-foreground">Net balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-2xl font-semibold tabular-nums">
              {formatCurrency(summary.baseNetBalance, baseCurrencyCode)}
            </div>
            {summary.byCurrency.map((breakdown) => (
              <div key={breakdown.currency} className="text-xs tabular-nums text-muted-foreground">
                {formatCurrency(breakdown.netBalance, breakdown.currency)}
              </div>
            ))}
            {summary.hasIncompleteRates ? (
              <p className="text-xs text-muted-foreground">
                {baseCurrencyCode} total is partial: some rows are missing rates.
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total spend</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-2xl font-semibold tabular-nums">
              {formatCurrency(summary.baseTotalSpend, baseCurrencyCode)}
            </div>
            {summary.byCurrency.map((breakdown) => (
              <div key={breakdown.currency} className="text-xs tabular-nums text-muted-foreground">
                {formatCurrency(breakdown.totalSpend, breakdown.currency)}
              </div>
            ))}
            {summary.hasIncompleteRates ? (
              <p className="text-xs text-muted-foreground">
                {baseCurrencyCode} total is partial: some rows are missing rates.
              </p>
            ) : null}
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
                      baseCurrencyCode={baseCurrencyCode}
                      toAccountName={
                        transaction.to_account_id
                          ? accountNameById.get(transaction.to_account_id) ??
                            transaction.to_account_id
                          : undefined
                      }
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
                  fallback={
                    <p className="py-6 text-sm text-muted-foreground">Loading charts...</p>
                  }
                >
                  <SpendingByCategory
                    transactions={transactions}
                    categoryNameById={categoryNameById}
                    baseCurrencyCode={baseCurrencyCode}
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
