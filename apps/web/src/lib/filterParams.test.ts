import { describe, it, expect } from 'vitest'
import { parseFilterParams, toSearchParams, toRequestParams, EMPTY_FILTERS } from './filterParams'

describe('filterParams round-trip', () => {
  it('parses defaults from empty params', () => {
    const state = parseFilterParams(new URLSearchParams())
    expect(state.range).toBe('this-month')
    expect(state.type).toBe('all')
    expect(state.accounts).toEqual([])
  })

  it('round-trips a populated state', () => {
    const populated = { ...EMPTY_FILTERS, q: 'coffee', accounts: ['a1', 'a2'], tags: ['trip'], tagMatch: 'all' as const, min: 10, type: 'expense' as const }
    const reparsed = parseFilterParams(toSearchParams(populated))
    expect(reparsed.q).toBe('coffee')
    expect(reparsed.accounts).toEqual(['a1', 'a2'])
    expect(reparsed.tags).toEqual(['trip'])
    expect(reparsed.tagMatch).toBe('all')
    expect(reparsed.min).toBe(10)
    expect(reparsed.type).toBe('expense')
  })

  it('omits default-valued keys from the query string', () => {
    expect(toSearchParams(EMPTY_FILTERS).toString()).toBe('')
  })

  it('treats a non-numeric min as no filter', () => {
    const state = parseFilterParams(new URLSearchParams('min=abc'))
    expect(state.min).toBeUndefined()
  })

  it('treats an empty min as no filter', () => {
    const state = parseFilterParams(new URLSearchParams('min='))
    expect(state.min).toBeUndefined()
  })

  it('keeps an explicit zero min', () => {
    const state = parseFilterParams(new URLSearchParams('min=0'))
    expect(state.min).toBe(0)
  })

  it('never serializes an undefined min as NaN', () => {
    const state = parseFilterParams(new URLSearchParams('min=abc'))
    expect(toSearchParams({ ...EMPTY_FILTERS, min: state.min }).toString()).not.toContain('NaN')
  })
})

describe('toRequestParams', () => {
  it('omits currency but keeps other fields', () => {
    const state = {
      ...EMPTY_FILTERS,
      q: 'coffee',
      accounts: ['a1', 'a2'],
      type: 'expense' as const,
      currency: 'PEN',
    }
    const requestParams = toRequestParams(state)
    expect(requestParams.has('currency')).toBe(false)
    expect(requestParams.get('q')).toBe('coffee')
    expect(requestParams.getAll('account')).toEqual(['a1', 'a2'])
    expect(requestParams.get('type')).toBe('expense')
  })

  it('leaves toSearchParams currency intact', () => {
    const state = { ...EMPTY_FILTERS, currency: 'PEN' }
    expect(toSearchParams(state).get('currency')).toBe('PEN')
  })
})
