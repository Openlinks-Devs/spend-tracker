import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { payeesApi } from '@/lib/api'

const payeesKey = ['payees'] as const

// Wraps GET /api/payees, which already returns one row per distinct payee
// carrying the category of that payee's most recent non-transfer
// transaction. Derives the two shapes the transaction form needs: the
// sorted autocomplete list and a payee -> last category_id lookup.
export function usePayees() {
  const query = useQuery({
    queryKey: payeesKey,
    queryFn: payeesApi.list,
  })

  const payees = useMemo(() => {
    const rows = query.data ?? []
    return rows.map((row) => row.payee).sort()
  }, [query.data])

  const payeeCategoryHistory = useMemo(() => {
    const rows = query.data ?? []
    const history: Record<string, string> = {}
    for (const row of rows) {
      if (row.last_category_id) history[row.payee] = row.last_category_id
    }
    return history
  }, [query.data])

  return { ...query, payees, payeeCategoryHistory }
}
