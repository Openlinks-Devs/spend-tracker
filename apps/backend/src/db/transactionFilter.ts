export interface TransactionFilter {
  q?: string
  from?: string
  to?: string
  accountIds?: string[]
  categoryIds?: string[]
  tags?: string[]
  tagMatch?: 'all' | 'any'
  min?: number
  max?: number
  type?: 'all' | 'income' | 'expense'
}

// Escape LIKE metacharacters so a user's literal % or _ is not treated as a wildcard.
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export function buildTransactionFilter(
  filter: TransactionFilter,
  startIndex = 1,
): { clause: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  let placeholder = startIndex

  if (filter.q && filter.q.trim() !== '') {
    conditions.push(`description ILIKE $${placeholder}`)
    params.push(`%${escapeLike(filter.q.trim())}%`)
    placeholder += 1
  }
  if (filter.tags && filter.tags.length > 0) {
    const operator = filter.tagMatch === 'all' ? '@>' : '&&'
    conditions.push(`tags ${operator} $${placeholder}::text[]`)
    params.push(filter.tags)
    placeholder += 1
  }
  if (filter.accountIds && filter.accountIds.length > 0) {
    conditions.push(`account_id = ANY($${placeholder})`)
    params.push(filter.accountIds)
    placeholder += 1
  }
  if (filter.categoryIds && filter.categoryIds.length > 0) {
    conditions.push(`category_id = ANY($${placeholder})`)
    params.push(filter.categoryIds)
    placeholder += 1
  }
  if (filter.type === 'expense') conditions.push('amount < 0')
  if (filter.type === 'income') conditions.push('amount > 0')
  if (typeof filter.min === 'number') {
    conditions.push(`abs(amount) >= $${placeholder}`)
    params.push(filter.min)
    placeholder += 1
  }
  if (typeof filter.max === 'number') {
    conditions.push(`abs(amount) <= $${placeholder}`)
    params.push(filter.max)
    placeholder += 1
  }
  if (filter.from) {
    conditions.push(`created_at >= $${placeholder}`)
    params.push(filter.from)
    placeholder += 1
  }
  if (filter.to) {
    conditions.push(`created_at < $${placeholder}`)
    params.push(filter.to)
    placeholder += 1
  }

  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { clause, params }
}

const RANGE_PRESETS = new Set(['this-month', 'last-3-months', 'this-year', 'all'])

export function resolveDateRange(
  range: string | undefined,
  from?: string,
  to?: string,
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (!range || !RANGE_PRESETS.has(range)) {
    const resolved: { from?: string; to?: string } = {}
    if (from) resolved.from = from
    if (to) resolved.to = to
    return resolved
  }
  if (range === 'all') return {}
  if (range === 'this-month') {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { from: monthStart.toISOString() }
  }
  if (range === 'this-year') {
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    return { from: yearStart.toISOString() }
  }
  // last-3-months: rolling 3 months back from now.
  const threeMonthsAgo = new Date(now)
  threeMonthsAgo.setUTCMonth(threeMonthsAgo.getUTCMonth() - 3)
  return { from: threeMonthsAgo.toISOString() }
}
