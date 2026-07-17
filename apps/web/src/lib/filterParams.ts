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
  const parseNumber = (key: string): number | undefined => {
    const rawValue = searchParams.get(key)
    if (rawValue === null || rawValue.trim() === '') return undefined
    const parsedValue = Number(rawValue)
    return Number.isFinite(parsedValue) ? parsedValue : undefined
  }
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

// Analytics is intentionally currency-agnostic: the dashboard fetches every
// currency at once so its currency switcher has all options to offer and does
// display-side filtering. So strip currency from the analytics request params
// (and their React Query keys) to avoid a redundant refetch on a currency
// switch. toSearchParams still carries currency so the browser URL persists it.
export function toRequestParams(state: TransactionFilterState): URLSearchParams {
  const requestParams = toSearchParams(state)
  requestParams.delete('currency')
  return requestParams
}

// The transactions list, unlike analytics, filters by currency server-side, so
// it keeps currency in its request params (and thus its React Query key).
export function toListRequestParams(state: TransactionFilterState): URLSearchParams {
  return toSearchParams(state)
}
