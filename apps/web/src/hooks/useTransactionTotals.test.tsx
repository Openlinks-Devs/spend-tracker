import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTransactionTotals } from '@/hooks/useTransactions'
import { stubApiFetch } from '@/test/apiStub'
import { makeTransaction } from '@/test/factories'
import { createQueryWrapper } from '@/test/render'
import type { TransactionTotals } from '@/types'

const totals: TransactionTotals = {
  count: 350,
  by_currency: [
    { currency: 'PEN', sum: -1200.5 },
    { currency: 'USD', sum: 80 },
  ],
  base: { currency: 'PEN', sum: -905.3 },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTransactionTotals', () => {
  it('fetches a single-item page and exposes only the totals envelope', async () => {
    const apiStub = stubApiFetch([
      {
        match: '/transactions',
        data: { items: [makeTransaction()], next_cursor: 'CURSOR', totals },
      },
    ])

    const { result } = renderHook(() => useTransactionTotals(), {
      wrapper: createQueryWrapper(),
    })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toEqual(totals)
    expect(apiStub.requestedUrls()[0]).toContain('/transactions?limit=1')
  })
})
