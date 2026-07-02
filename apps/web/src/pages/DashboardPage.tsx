import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTransactions } from '@/hooks/useTransactions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { formatCurrency, formatDate } from '@/lib/utils'
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

  const accountNameById = useMemo(() => {
    const lookup = new Map<string, string>()
    for (const account of accountsQuery.data ?? []) {
      lookup.set(account.id, account.name)
    }
    return lookup
  }, [accountsQuery.data])

  const categoryNameById = useMemo(() => {
    const lookup = new Map<string, string>()
    for (const category of categoriesQuery.data ?? []) {
      lookup.set(category.id, category.name)
    }
    return lookup
  }, [categoriesQuery.data])

  const summary = useMemo(() => {
    const primaryCurrency = pickPrimaryCurrency(transactions)
    let netBalance = 0
    let totalSpend = 0
    for (const transaction of transactions) {
      const amount = Number(transaction.amount) || 0
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
      const amount = Number(transaction.amount) || 0
      if (amount >= 0) continue
      const categoryName = transaction.category_id
        ? categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
        : 'Uncategorized'
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentTransactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell className="font-medium">{transaction.description}</TableCell>
                        <TableCell>
                          {accountNameById.get(transaction.account_id) ?? transaction.account_id}
                        </TableCell>
                        <TableCell>
                          {transaction.category_id
                            ? categoryNameById.get(transaction.category_id) ?? 'Uncategorized'
                            : 'Uncategorized'}
                        </TableCell>
                        <TableCell>{formatDate(transaction.created_at)}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(transaction.amount) || 0, transaction.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
            <TabsContent value="categories">
              {spendingByCategory.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No spending recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {spendingByCategory.map((categorySpend) => (
                      <TableRow key={categorySpend.categoryName}>
                        <TableCell className="font-medium">{categorySpend.categoryName}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(categorySpend.total, summary.primaryCurrency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
