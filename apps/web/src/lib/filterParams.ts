export interface TransactionFilterState {
  q: string
  range: string
  from?: string
  to?: string
  accounts: string[]
  categories: string[]
  tags: string[]
  tagMatch: 'all' | 'any'
  min?: number
  max?: number
  type: 'all' | 'income' | 'expense'
  currency?: string
}

export const EMPTY_FILTERS: TransactionFilterState = {
  q: '',
  range: 'this-month',
  accounts: [],
  categories: [],
  tags: [],
  tagMatch: 'any',
  type: 'all',
}

export function parseFilterParams(searchParams: URLSearchParams): TransactionFilterState {
  const parseNumber = (key: string) => (searchParams.has(key) ? Number(searchParams.get(key)) : undefined)
  const typeParam = searchParams.get('type')
  return {
    q: searchParams.get('q') ?? '',
    range: searchParams.get('range') ?? 'this-month',
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    accounts: searchParams.getAll('account'),
    categories: searchParams.getAll('category'),
    tags: searchParams.getAll('tag'),
    tagMatch: searchParams.get('tagMatch') === 'all' ? 'all' : 'any',
    min: parseNumber('min'),
    max: parseNumber('max'),
    type: typeParam === 'income' || typeParam === 'expense' ? typeParam : 'all',
    currency: searchParams.get('currency') ?? undefined,
  }
}

export function toSearchParams(state: TransactionFilterState): URLSearchParams {
  const searchParams = new URLSearchParams()
  if (state.q) searchParams.set('q', state.q)
  if (state.range && state.range !== 'this-month') searchParams.set('range', state.range)
  if (state.from) searchParams.set('from', state.from)
  if (state.to) searchParams.set('to', state.to)
  for (const accountId of state.accounts) searchParams.append('account', accountId)
  for (const categoryId of state.categories) searchParams.append('category', categoryId)
  for (const tag of state.tags) searchParams.append('tag', tag)
  if (state.tagMatch !== 'any') searchParams.set('tagMatch', state.tagMatch)
  if (typeof state.min === 'number') searchParams.set('min', String(state.min))
  if (typeof state.max === 'number') searchParams.set('max', String(state.max))
  if (state.type !== 'all') searchParams.set('type', state.type)
  if (state.currency) searchParams.set('currency', state.currency)
  return searchParams
}
