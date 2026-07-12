import { transactionColumns } from './queries.js'

export interface TransactionListFilters {
  from?: string
  to?: string
  account_ids?: string[]
  category_ids?: string[]
  uncategorized?: boolean
  tags?: string[]
  tag_mode?: 'any' | 'all' | 'none'
  amount_min?: number
  amount_max?: number
  currency?: string
  type?: 'expense' | 'income' | 'transfer'
  search?: string
  sort?: 'occurred_at' | 'amount'
  order?: 'asc' | 'desc'
  cursor?: string
  limit?: number
}

export interface TransactionCursor {
  occurred_at: string
  id: string
  amount?: number
}

export interface TransactionListQuery {
  listSql: string
  listParams: unknown[]
  totalsSql: string
  totalsParams: unknown[]
  limit: number
}

export interface TotalsRow {
  currency: string
  count: number
  sum: number | null
  base_sum: number | null
  missing_base: boolean
}

export interface TransactionTotals {
  count: number
  by_currency: { currency: string; sum: number }[]
  base: { currency: string; sum: number | null }
}

export function encodeCursor(cursor: TransactionCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string): TransactionCursor | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof decoded !== 'object' || decoded === null) return null
    const candidate = decoded as Record<string, unknown>
    if (typeof candidate.occurred_at !== 'string' || typeof candidate.id !== 'string') return null
    if (candidate.amount !== undefined && typeof candidate.amount !== 'number') return null
    return candidate as unknown as TransactionCursor
  } catch {
    return null
  }
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function buildTransactionListQuery(filters: TransactionListFilters): TransactionListQuery {
  const conditions: string[] = []
  const params: unknown[] = []
  const addParam = (value: unknown): string => {
    params.push(value)
    return `$${params.length}`
  }

  if (filters.from) {
    conditions.push(`occurred_at >= ${addParam(filters.from)}::date`)
  }
  if (filters.to) {
    conditions.push(`occurred_at < (${addParam(filters.to)}::date + interval '1 day')`)
  }
  if (filters.account_ids?.length) {
    const accountsParam = addParam(filters.account_ids)
    conditions.push(
      `(account_id = ANY(${accountsParam}::uuid[]) OR to_account_id = ANY(${accountsParam}::uuid[]))`,
    )
  }
  if (filters.uncategorized) {
    conditions.push('category_id IS NULL')
  } else if (filters.category_ids?.length) {
    conditions.push(`category_id = ANY(${addParam(filters.category_ids)}::uuid[])`)
  }
  if (filters.tags?.length) {
    const tagsParam = addParam(filters.tags)
    const tagMode = filters.tag_mode ?? 'any'
    if (tagMode === 'any') conditions.push(`tags && ${tagsParam}::text[]`)
    else if (tagMode === 'all') conditions.push(`tags @> ${tagsParam}::text[]`)
    else conditions.push(`NOT (tags && ${tagsParam}::text[])`)
  }
  if (filters.amount_min !== undefined) {
    conditions.push(`abs(amount) >= ${addParam(filters.amount_min)}`)
  }
  if (filters.amount_max !== undefined) {
    conditions.push(`abs(amount) <= ${addParam(filters.amount_max)}`)
  }
  if (filters.currency) {
    conditions.push(`currency = ${addParam(filters.currency)}`)
  }
  if (filters.type) {
    conditions.push(`type = ${addParam(filters.type)}`)
  }
  if (filters.search) {
    const searchParam = addParam(`%${filters.search}%`)
    const searchConditions = [
      `description ILIKE ${searchParam}`,
      `payee ILIKE ${searchParam}`,
      `notes ILIKE ${searchParam}`,
      `EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE ${searchParam})`,
    ]
    // A search term that parses as a finite positive number also matches on
    // the transaction's absolute amount (research P0 item 9: text search
    // matches description, payee, notes, tag names, and amount).
    const searchAmount = Number(filters.search)
    if (Number.isFinite(searchAmount) && searchAmount > 0) {
      searchConditions.push(`abs(amount) = ${addParam(searchAmount)}`)
    }
    conditions.push(`(${searchConditions.join(' OR ')})`)
  }

  // Totals cover the WHOLE filtered set: snapshot before cursor and limit.
  const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
  const totalsSql =
    `SELECT currency, count(*)::int AS count,` +
    ` SUM(CASE WHEN type <> 'transfer' THEN amount END)::float8 AS sum,` +
    ` SUM(CASE WHEN type <> 'transfer' THEN base_amount END)::float8 AS base_sum,` +
    ` bool_or(type <> 'transfer' AND base_amount IS NULL) AS missing_base` +
    ` FROM transactions${whereClause} GROUP BY currency`
  const totalsParams = [...params]

  const sort = filters.sort ?? 'occurred_at'
  const order = filters.order ?? 'desc'
  const direction = order === 'asc' ? 'ASC' : 'DESC'
  const comparator = order === 'asc' ? '>' : '<'
  const sortColumn = sort === 'amount' ? 'amount' : 'occurred_at'

  const listConditions = [...conditions]
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null
  if (cursor) {
    if (sort === 'amount' && cursor.amount !== undefined) {
      listConditions.push(
        `(amount, id) ${comparator} (${addParam(cursor.amount)}::numeric, ${addParam(cursor.id)}::uuid)`,
      )
    } else if (sort === 'occurred_at') {
      listConditions.push(
        `(occurred_at, id) ${comparator} (${addParam(cursor.occurred_at)}::timestamptz, ${addParam(cursor.id)}::uuid)`,
      )
    }
  }

  const requestedLimit = filters.limit ?? DEFAULT_LIMIT
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_LIMIT)
  const listWhereClause = listConditions.length ? ` WHERE ${listConditions.join(' AND ')}` : ''
  // Fetch one extra row as the has-more probe.
  const listSql =
    `SELECT ${transactionColumns} FROM transactions${listWhereClause}` +
    ` ORDER BY ${sortColumn} ${direction}, id ${direction} LIMIT ${addParam(limit + 1)}`

  return { listSql, listParams: params, totalsSql, totalsParams, limit }
}

export function reduceTotals(rows: TotalsRow[], baseCurrencyCode: string): TransactionTotals {
  const count = rows.reduce((total, row) => total + row.count, 0)
  const by_currency = rows
    .filter((row) => row.sum !== null)
    .map((row) => ({ currency: row.currency, sum: row.sum as number }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
  const missingBase = rows.some((row) => row.missing_base)
  const baseSum = missingBase
    ? null
    : Math.round(rows.reduce((total, row) => total + (row.base_sum ?? 0), 0) * 100) / 100
  return { count, by_currency, base: { currency: baseCurrencyCode, sum: baseSum } }
}
