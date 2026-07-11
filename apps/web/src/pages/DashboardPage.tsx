import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TransactionListItem } from '@/components/transactions/TransactionListItem'
import { useTransactions } from '@/hooks/useTransactions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { formatCurrency, toNameById } from '@/lib/utils'
import type { Transaction } from '@/types'

function pickPrimaryCurrency(transactions: Transaction[]): string {
  const currencyCounts = new Map<string, number>()
  for (const transaction of transactions) {
    const currency = transaction.currency || 'USD'
    currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1)
  }
  let primaryCurrency = 'USD'
  let highestCount = 0
  for (const [currency, count] of currencyCounts) {
    if (count > highestCount) {
      highestCount = count
      primaryCurrency = currency
    }
  }
  return primaryCurrency
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

  const summary = useMemo(() => {
    const primaryCurrency = pickPrimaryCurrency(transactions)
    let netBalance = 0
    let totalSpend = 0
    for (const transaction of transactions) {
      const amount = transaction.amount
      netBalance += amount
      if (amount < 0) {
        totalSpend += Math.abs(amount)
      }
    }
    return { primaryCurrency, netBalance, totalSpend, transactionCount: transactions.length }
  }, [transactions])

  const recentTransactions = useMemo(() => transactions.slice(0, 8), [transactions])

  const spendingByCategory = useMemo(() => {
    const totals = new Map<string, number>()
    for (const transaction of transactions) {
      const amount = transaction.amount
      if (amount >= 0) continue
      const categoryName = categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
      totals.set(categoryName, (totals.get(categoryName) ?? 0) + Math.abs(amount))
    }
    return Array.from(totals.entries())
      .map(([categoryName, total]) => ({ categoryName, total }))
      .sort((first, second) => second.total - first.total)
  }, [transactions, categoryNameById])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your accounts and spending</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Net balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatCurrency(summary.netBalance, summary.primaryCurrency)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatCurrency(summary.totalSpend, summary.primaryCurrency)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary.transactionCount}</div>
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
                        categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
                      }
                      showDate
                    />
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="categories">
              {spendingByCategory.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No spending recorded yet.</p>
              ) : (
                <ul className="space-y-4 py-4">
                  {spendingByCategory.map((categorySpend) => {
                    const largestTotal = spendingByCategory[0].total
                    const shareOfLargest =
                      largestTotal > 0 ? (categorySpend.total / largestTotal) * 100 : 0
                    return (
                      <li key={categorySpend.categoryName}>
                        <div className="flex items-baseline justify-between gap-4 text-sm">
                          <span className="truncate font-medium">{categorySpend.categoryName}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatCurrency(categorySpend.total, summary.primaryCurrency)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${shareOfLargest}%` }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
