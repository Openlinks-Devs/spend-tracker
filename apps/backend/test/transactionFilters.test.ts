import { describe, it, expect } from 'vitest'
import {
  buildTransactionListQuery,
  decodeCursor,
  encodeCursor,
  reduceTotals,
} from '../src/db/transactionFilters.js'

const accountId = '11111111-1111-4111-8111-111111111111'
const otherAccountId = '22222222-2222-4222-8222-222222222222'
const categoryId = '33333333-3333-4333-8333-333333333333'
const rowId = '55555555-5555-4555-8555-555555555555'

describe('cursor encoding', () => {
  it('round-trips occurred_at and id', () => {
    const cursor = { occurred_at: '2026-06-30T10:00:00.000Z', id: rowId }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('round-trips an amount-sort cursor', () => {
    const cursor = { occurred_at: '2026-06-30T10:00:00.000Z', id: rowId, amount: -12.5 }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('returns null for garbage input', () => {
    expect(decodeCursor('not-base64-json')).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(Buffer.from('"just a string"').toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from('{"id":"x"}').toString('base64url'))).toBeNull()
  })
})

describe('buildTransactionListQuery: defaults', () => {
  it('builds an unfiltered query with default sort and limit 50 (+1 probe row)', () => {
    const built = buildTransactionListQuery({})
    expect(built.listSql).not.toMatch(/WHERE/i)
    expect(built.listSql).toMatch(/ORDER BY occurred_at DESC, id DESC/)
    expect(built.listSql).toMatch(/LIMIT \$1/)
    expect(built.listParams).toEqual([51])
    expect(built.limit).toBe(50)
    expect(built.totalsSql).not.toMatch(/WHERE/i)
    expect(built.totalsSql).not.toMatch(/LIMIT/i)
    expect(built.totalsParams).toEqual([])
  })

  it('clamps limit into [1, 200]', () => {
    expect(buildTransactionListQuery({ limit: 500 }).limit).toBe(200)
    expect(buildTransactionListQuery({ limit: 0 }).limit).toBe(1)
    expect(buildTransactionListQuery({ limit: 25 }).listParams).toEqual([26])
  })
})

describe('buildTransactionListQuery: individual filters', () => {
  it('applies an inclusive date range on occurred_at', () => {
    const built = buildTransactionListQuery({ from: '2026-06-01', to: '2026-06-30' })
    expect(built.listSql).toMatch(/occurred_at >= \$1::date/)
    expect(built.listSql).toMatch(/occurred_at < \(\$2::date \+ interval '1 day'\)/)
    expect(built.totalsSql).toMatch(/occurred_at >= \$1::date/)
    expect(built.listParams.slice(0, 2)).toEqual(['2026-06-01', '2026-06-30'])
  })

  it('matches account_ids against source and destination with one param', () => {
    const built = buildTransactionListQuery({ account_ids: [accountId, otherAccountId] })
    expect(built.listSql).toMatch(
      /\(account_id = ANY\(\$1::uuid\[\]\) OR to_account_id = ANY\(\$1::uuid\[\]\)\)/,
    )
    expect(built.listParams[0]).toEqual([accountId, otherAccountId])
  })

  it('filters by category_ids', () => {
    const built = buildTransactionListQuery({ category_ids: [categoryId] })
    expect(built.listSql).toMatch(/category_id = ANY\(\$1::uuid\[\]\)/)
  })

  it('uncategorized wins over category_ids', () => {
    const built = buildTransactionListQuery({ uncategorized: true, category_ids: [categoryId] })
    expect(built.listSql).toMatch(/category_id IS NULL/)
    expect(built.listSql).not.toMatch(/category_id = ANY/)
    expect(built.listParams).toEqual([51])
  })

  it('tag_mode any uses the overlap operator', () => {
    const built = buildTransactionListQuery({ tags: ['food', 'plin'] })
    expect(built.listSql).toMatch(/tags && \$1::text\[\]/)
  })

  it('tag_mode all uses the containment operator', () => {
    const built = buildTransactionListQuery({ tags: ['food'], tag_mode: 'all' })
    expect(built.listSql).toMatch(/tags @> \$1::text\[\]/)
  })

  it('tag_mode none negates the overlap', () => {
    const built = buildTransactionListQuery({ tags: ['food'], tag_mode: 'none' })
    expect(built.listSql).toMatch(/NOT \(tags && \$1::text\[\]\)/)
  })

  it('matches amount bounds on the absolute value', () => {
    const built = buildTransactionListQuery({ amount_min: 10, amount_max: 100 })
    expect(built.listSql).toMatch(/abs\(amount\) >= \$1/)
    expect(built.listSql).toMatch(/abs\(amount\) <= \$2/)
    expect(built.listParams.slice(0, 2)).toEqual([10, 100])
  })

  it('filters by currency and type', () => {
    const built = buildTransactionListQuery({ currency: 'USD', type: 'expense' })
    expect(built.listSql).toMatch(/currency = \$1/)
    expect(built.listSql).toMatch(/type = \$2/)
    expect(built.listParams.slice(0, 2)).toEqual(['USD', 'expense'])
  })

  it('search hits description, payee, notes, and tag elements with one param', () => {
    const built = buildTransactionListQuery({ search: 'cafe' })
    expect(built.listSql).toMatch(/description ILIKE \$1/)
    expect(built.listSql).toMatch(/payee ILIKE \$1/)
    expect(built.listSql).toMatch(/notes ILIKE \$1/)
    expect(built.listSql).toMatch(/unnest\(tags\) AS tag WHERE tag ILIKE \$1/)
    expect(built.listParams[0]).toBe('%cafe%')
  })

  it('a numeric search also matches the absolute amount', () => {
    const built = buildTransactionListQuery({ search: '24.99' })
    expect(built.listSql).toMatch(/abs\(amount\) = \$2/)
    expect(built.listParams.slice(0, 2)).toEqual(['%24.99%', 24.99])
  })

  it('a non-numeric search does not add an amount condition', () => {
    const built = buildTransactionListQuery({ search: 'cafe' })
    expect(built.listSql).not.toMatch(/abs\(amount\) =/)
  })

  it('a negative numeric search does not add an amount condition', () => {
    const built = buildTransactionListQuery({ search: '-5' })
    expect(built.listSql).not.toMatch(/abs\(amount\) =/)
  })
})

describe('buildTransactionListQuery: sort, order, cursor', () => {
  it('sorts by amount ascending when asked', () => {
    const built = buildTransactionListQuery({ sort: 'amount', order: 'asc' })
    expect(built.listSql).toMatch(/ORDER BY amount ASC, id ASC/)
  })

  it('adds a keyset condition for a descending occurred_at cursor', () => {
    const cursor = encodeCursor({ occurred_at: '2026-06-30T10:00:00.000Z', id: rowId })
    const built = buildTransactionListQuery({ cursor })
    expect(built.listSql).toMatch(/\(occurred_at, id\) < \(\$1::timestamptz, \$2::uuid\)/)
    expect(built.listParams).toEqual(['2026-06-30T10:00:00.000Z', rowId, 51])
  })

  it('flips the comparator for ascending order', () => {
    const cursor = encodeCursor({ occurred_at: '2026-06-30T10:00:00.000Z', id: rowId })
    const built = buildTransactionListQuery({ cursor, order: 'asc' })
    expect(built.listSql).toMatch(/\(occurred_at, id\) > \(\$1::timestamptz, \$2::uuid\)/)
  })

  it('paginates on (amount, id) for the amount sort', () => {
    const cursor = encodeCursor({ occurred_at: '2026-06-30T10:00:00.000Z', id: rowId, amount: -12.5 })
    const built = buildTransactionListQuery({ cursor, sort: 'amount' })
    expect(built.listSql).toMatch(/\(amount, id\) < \(\$1::numeric, \$2::uuid\)/)
    expect(built.listParams).toEqual([-12.5, rowId, 51])
  })

  it('keeps cursor params out of the totals query', () => {
    const cursor = encodeCursor({ occurred_at: '2026-06-30T10:00:00.000Z', id: rowId })
    const built = buildTransactionListQuery({ currency: 'PEN', cursor })
    expect(built.totalsParams).toEqual(['PEN'])
    expect(built.listParams).toEqual(['PEN', '2026-06-30T10:00:00.000Z', rowId, 51])
    expect(built.totalsSql).not.toMatch(/timestamptz/)
  })
})

describe('buildTransactionListQuery: combinations and totals SQL', () => {
  it('numbers params consistently across many filters', () => {
    const built = buildTransactionListQuery({
      from: '2026-01-01',
      to: '2026-06-30',
      account_ids: [accountId],
      tags: ['food'],
      amount_min: 5,
      currency: 'PEN',
      type: 'expense',
      search: 'lunch',
    })
    expect(built.listParams).toEqual([
      '2026-01-01', '2026-06-30', [accountId], ['food'], 5, 'PEN', 'expense', '%lunch%', 51,
    ])
    expect(built.totalsParams).toEqual([
      '2026-01-01', '2026-06-30', [accountId], ['food'], 5, 'PEN', 'expense', '%lunch%',
    ])
    expect(built.listSql).toMatch(/LIMIT \$9/)
  })

  it('totals exclude transfers from sums but not from the count', () => {
    const built = buildTransactionListQuery({})
    expect(built.totalsSql).toMatch(/count\(\*\)::int AS count/)
    expect(built.totalsSql).toMatch(/CASE WHEN type <> 'transfer' THEN amount END/)
    expect(built.totalsSql).toMatch(/CASE WHEN type <> 'transfer' THEN base_amount END/)
    expect(built.totalsSql).toMatch(/bool_or\(type <> 'transfer' AND base_amount IS NULL\)/)
    expect(built.totalsSql).toMatch(/GROUP BY currency/)
  })
})

describe('reduceTotals', () => {
  it('aggregates counts and per-currency sums', () => {
    const totals = reduceTotals(
      [
        { currency: 'PEN', count: 3, sum: -120.5, base_sum: -120.5, missing_base: false },
        { currency: 'USD', count: 2, sum: -40, base_sum: -149.6, missing_base: false },
      ],
      'PEN',
    )
    expect(totals.count).toBe(5)
    expect(totals.by_currency).toEqual([
      { currency: 'PEN', sum: -120.5 },
      { currency: 'USD', sum: -40 },
    ])
    expect(totals.base).toEqual({ currency: 'PEN', sum: -270.1 })
  })

  it('drops transfer-only currencies from by_currency but keeps their count', () => {
    const totals = reduceTotals(
      [
        { currency: 'PEN', count: 1, sum: -10, base_sum: -10, missing_base: false },
        { currency: 'USD', count: 1, sum: null, base_sum: null, missing_base: false },
      ],
      'PEN',
    )
    expect(totals.count).toBe(2)
    expect(totals.by_currency).toEqual([{ currency: 'PEN', sum: -10 }])
    expect(totals.base.sum).toBe(-10)
  })

  it('nulls the base sum when any row is missing base_amount', () => {
    const totals = reduceTotals(
      [
        { currency: 'PEN', count: 1, sum: -10, base_sum: -10, missing_base: false },
        { currency: 'USD', count: 1, sum: -20, base_sum: null, missing_base: true },
      ],
      'PEN',
    )
    expect(totals.base.sum).toBeNull()
  })

  it('handles the empty set', () => {
    const totals = reduceTotals([], 'PEN')
    expect(totals).toEqual({ count: 0, by_currency: [], base: { currency: 'PEN', sum: 0 } })
  })
})
