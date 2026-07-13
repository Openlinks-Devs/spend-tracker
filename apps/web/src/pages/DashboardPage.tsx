import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnalyticsSection } from '@/components/analytics/AnalyticsSection'
import { FilterChips } from '@/components/filters/FilterChips'
import { SearchBar } from '@/components/filters/SearchBar'
import { TransactionListItem } from '@/components/transactions/TransactionListItem'
import { useTransactionFilters } from '@/hooks/useTransactionFilters'
import { useTransactionsQuery } from '@/hooks/useTransactionsQuery'
import { useAccounts } from '@/hooks/useAccounts'
import { useCategories } from '@/hooks/useCategories'
import { toNameById } from '@/lib/utils'

const RECENT_TRANSACTION_COUNT = 8

export function DashboardPage() {
  const { filters, setFilters } = useTransactionFilters()

  const recentQuery = useTransactionsQuery(filters, {
    limit: RECENT_TRANSACTION_COUNT,
    offset: 0,
  })
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()

  const recentTransactions = recentQuery.data?.items ?? []

  const accountNameById = useMemo(() => toNameById(accountsQuery.data), [accountsQuery.data])
  const categoryNameById = useMemo(() => toNameById(categoriesQuery.data), [categoriesQuery.data])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your accounts and spending</p>
      </div>

      <SearchBar />
      <FilterChips />

      <AnalyticsSection filters={filters} setFilters={setFilters} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {recentQuery.isLoading ? (
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
                  categoryName={categoryNameById.get(transaction.category_id) ?? 'Uncategorized'}
                  showDate
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
