import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTransactionsInfinite } from '@/hooks/useTransactions'
import { stubApiFetch } from '@/test/apiStub'
import { makeTransaction } from '@/test/factories'
import { createQueryWrapper } from '@/test/render'
import type { TransactionTotals } from '@/types'

const totals: TransactionTotals = {
  count: 2,
  by_currency: [{ currency: 'PEN', sum: -20 }],
  base: { currency: 'PEN', sum: -20 },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTransactionsInfinite', () => {
  it('requests mapped filter params and follows next_cursor', async () => {
    const firstPage = { items: [makeTransaction()], next_cursor: 'CURSOR1', totals }
    const secondPage = { items: [makeTransaction()], next_cursor: null, totals }
    const apiStub = stubApiFetch([
      {
        match: '/transactions',
        data: (url: string) => (url.includes('cursor=CURSOR1') ? secondPage : firstPage),
      },
    ])

    const { result } = renderHook(
      () => useTransactionsInfinite({ type: 'expense', accountIds: ['acc-1', 'acc-2'] }),
      { wrapper: createQueryWrapper() },
    )

    // Assert on `data` (not `isSuccess`) so react-query's tracked-properties
    // optimization records `data` as observed before fetchNextPage resolves;
    // otherwise the later `data.pages` update is never reported to this hook.
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    const firstUrl = apiStub.requestedUrls()[0]
    expect(firstUrl).toContain('type=expense')
    expect(firstUrl).toContain(`account_ids=${encodeURIComponent('acc-1,acc-2')}`)

    await result.current.fetchNextPage()
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    expect(apiStub.requestedUrls()[1]).toContain('cursor=CURSOR1')
    expect(result.current.hasNextPage).toBe(false)
  })
})
