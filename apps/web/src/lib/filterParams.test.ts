import { describe, expect, it } from 'vitest'
import {
  filtersToApiSearchParams,
  filtersToSearchParams,
  searchParamsToFilters,
} from '@/lib/filterParams'
import type { TransactionFilters } from '@/types'

describe('filtersToSearchParams', () => {
  it('returns empty params for empty filters', () => {
    expect(filtersToSearchParams({}).toString()).toBe('')
  })

  it('omits default values (tag_mode any, sort occurred_at, order desc)', () => {
    const params = filtersToSearchParams({
      tags: ['food'],
      tagMode: 'any',
      sort: 'occurred_at',
      order: 'desc',
    })
    expect(params.get('tags')).toBe('food')
    expect(params.has('tag_mode')).toBe(false)
    expect(params.has('sort')).toBe(false)
    expect(params.has('order')).toBe(false)
  })

  it('serializes every filter under the URL contract names', () => {
    const params = filtersToSearchParams({
      from: '2026-07-01',
      to: '2026-07-31',
      accountIds: ['acc-1', 'acc-2'],
      categoryIds: ['cat-1'],
      uncategorized: true,
      tags: ['food', 'travel'],
      tagMode: 'none',
      amountMin: 10,
      amountMax: 500.5,
      currency: 'USD',
      type: 'expense',
      search: 'uber',
      sort: 'amount',
      order: 'asc',
    })
    expect(params.get('from')).toBe('2026-07-01')
    expect(params.get('to')).toBe('2026-07-31')
    expect(params.get('accounts')).toBe('acc-1,acc-2')
    expect(params.get('categories')).toBe('cat-1')
    expect(params.get('uncategorized')).toBe('true')
    expect(params.get('tags')).toBe('food,travel')
    expect(params.get('tag_mode')).toBe('none')
    expect(params.get('amount_min')).toBe('10')
    expect(params.get('amount_max')).toBe('500.5')
    expect(params.get('currency')).toBe('USD')
    expect(params.get('type')).toBe('expense')
    expect(params.get('search')).toBe('uber')
    expect(params.get('sort')).toBe('amount')
    expect(params.get('order')).toBe('asc')
  })
})

describe('searchParamsToFilters', () => {
  it('round-trips a full filter set', () => {
    const filters: TransactionFilters = {
      from: '2026-07-01',
      to: '2026-07-31',
      accountIds: ['acc-1', 'acc-2'],
      categoryIds: ['cat-1'],
      uncategorized: true,
      tags: ['food', 'travel'],
      tagMode: 'none',
      amountMin: 10,
      amountMax: 500.5,
      currency: 'USD',
      type: 'expense',
      search: 'uber',
      sort: 'amount',
      order: 'asc',
    }
    expect(searchParamsToFilters(filtersToSearchParams(filters))).toEqual(filters)
  })

  it('drops unknown params and unparseable numbers', () => {
    const filters = searchParamsToFilters(
      new URLSearchParams('bogus=1&amount_min=abc&type=nonsense&tag_mode=sometimes'),
    )
    expect(filters).toEqual({})
  })

  it('parses an empty string as no filters', () => {
    expect(searchParamsToFilters(new URLSearchParams(''))).toEqual({})
  })
})

describe('filtersToApiSearchParams', () => {
  it('uses the backend param names for account and category lists', () => {
    const params = filtersToApiSearchParams({
      accountIds: ['acc-1', 'acc-2'],
      categoryIds: ['cat-1'],
      type: 'income',
    })
    expect(params.get('account_ids')).toBe('acc-1,acc-2')
    expect(params.get('category_ids')).toBe('cat-1')
    expect(params.get('type')).toBe('income')
    expect(params.has('accounts')).toBe(false)
    expect(params.has('categories')).toBe(false)
  })
})
