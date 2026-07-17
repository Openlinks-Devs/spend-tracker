import { describe, it, expect } from 'vitest'
import { buildTransactionFilter, resolveDateRange } from '../src/db/transactionFilter.js'

describe('buildTransactionFilter', () => {
  it('returns empty clause when no filters set', () => {
    const { clause, params } = buildTransactionFilter({})
    expect(clause).toBe('')
    expect(params).toEqual([])
  })

  it('builds an ILIKE search on description with escaped wildcards', () => {
    const { clause, params } = buildTransactionFilter({ q: '50%_off' })
    expect(clause).toMatch(/description ILIKE/i)
    expect(params[0]).toBe('%50\\%\\_off%')
  })

  it('filters expense as amount < 0 and income as amount > 0', () => {
    expect(buildTransactionFilter({ type: 'expense' }).clause).toMatch(/amount < 0/)
    expect(buildTransactionFilter({ type: 'income' }).clause).toMatch(/amount > 0/)
    expect(buildTransactionFilter({ type: 'all' }).clause).toBe('')
  })

  it('uses ANY for tag match "any" and @> for "all"', () => {
    const anyMatch = buildTransactionFilter({ tags: ['food', 'trip'], tagMatch: 'any' })
    expect(anyMatch.clause).toMatch(/tags && \$1::text\[\]/)
    expect(anyMatch.params[0]).toEqual(['food', 'trip'])
    const allMatch = buildTransactionFilter({ tags: ['food'], tagMatch: 'all' })
    expect(allMatch.clause).toMatch(/tags @> \$1::text\[\]/)
  })

  it('filters accounts and categories with ANY($ids)', () => {
    const { clause, params } = buildTransactionFilter({ accountIds: ['a1'], categoryIds: ['c1', 'c2'] })
    expect(clause).toMatch(/account_id = ANY\(\$1\)/)
    expect(clause).toMatch(/category_id = ANY\(\$2\)/)
    expect(params).toEqual([['a1'], ['c1', 'c2']])
  })

  it('applies amount magnitude and date bounds', () => {
    const { clause, params } = buildTransactionFilter({
      min: 10, max: 100, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z',
    })
    expect(clause).toMatch(/abs\(amount\) >= \$1/)
    expect(clause).toMatch(/abs\(amount\) <= \$2/)
    expect(clause).toMatch(/created_at >= \$3/)
    expect(clause).toMatch(/created_at < \$4/)
    expect(params).toEqual([10, 100, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'])
  })

  it('filters by exact currency', () => {
    const { clause, params } = buildTransactionFilter({ currency: 'USD' })
    expect(clause).toMatch(/currency = \$1/)
    expect(params).toEqual(['USD'])
    expect(buildTransactionFilter({ currency: '' }).clause).toBe('')
  })

  it('honors a custom startIndex for placeholder numbering', () => {
    const { clause } = buildTransactionFilter({ q: 'coffee' }, 5)
    expect(clause).toMatch(/\$5/)
  })
})

describe('resolveDateRange', () => {
  const now = new Date('2026-07-12T12:00:00Z')
  it('resolves this-month to the month start with no upper bound', () => {
    expect(resolveDateRange('this-month', undefined, undefined, now).from).toBe('2026-07-01T00:00:00.000Z')
  })
  it('resolves last-3-months', () => {
    expect(resolveDateRange('last-3-months', undefined, undefined, now).from).toBe('2026-04-12T12:00:00.000Z')
  })
  it('resolves all to no bounds', () => {
    expect(resolveDateRange('all', undefined, undefined, now)).toEqual({})
  })
  it('passes through explicit from/to', () => {
    expect(resolveDateRange(undefined, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', now))
      .toEqual({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' })
  })
})
