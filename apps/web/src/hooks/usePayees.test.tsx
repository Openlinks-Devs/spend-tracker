import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePayees } from '@/hooks/usePayees'
import { stubApiFetch } from '@/test/apiStub'
import { createQueryWrapper } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePayees', () => {
  it('requests /api/payees and exposes the payee list and last-category map', async () => {
    const apiStub = stubApiFetch([
      {
        match: '/payees',
        data: [
          { payee: 'La Lucha', last_category_id: 'cat-1' },
          { payee: 'Uber', last_category_id: null },
        ],
      },
    ])

    const { result } = renderHook(() => usePayees(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.payees).toEqual(['La Lucha', 'Uber']))
    expect(apiStub.requestedUrls()[0]).toContain('/payees')
    expect(result.current.payeeCategoryHistory).toEqual({ 'La Lucha': 'cat-1' })
  })
})
