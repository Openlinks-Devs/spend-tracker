import type { TransactionFilters, TransactionType } from '@/types'

const tagModes = ['any', 'all', 'none'] as const
const transactionTypes = ['expense', 'income', 'transfer'] as const
const sortFields = ['occurred_at', 'amount'] as const
const sortOrders = ['desc', 'asc'] as const

function parseList(value: string | null): string[] | undefined {
  if (!value) return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : undefined
}

function parseNumber(value: string | null): number | undefined {
  if (value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOneOf<Option extends string>(
  value: string | null,
  options: readonly Option[],
): Option | undefined {
  return options.includes(value as Option) ? (value as Option) : undefined
}

function appendFilterParams(
  params: URLSearchParams,
  filters: TransactionFilters,
  accountsKey: string,
  categoriesKey: string,
): URLSearchParams {
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.accountIds && filters.accountIds.length > 0)
    params.set(accountsKey, filters.accountIds.join(','))
  if (filters.categoryIds && filters.categoryIds.length > 0)
    params.set(categoriesKey, filters.categoryIds.join(','))
  if (filters.uncategorized) params.set('uncategorized', 'true')
  if (filters.tags && filters.tags.length > 0) params.set('tags', filters.tags.join(','))
  if (filters.tagMode && filters.tagMode !== 'any') params.set('tag_mode', filters.tagMode)
  if (filters.amountMin !== undefined) params.set('amount_min', String(filters.amountMin))
  if (filters.amountMax !== undefined) params.set('amount_max', String(filters.amountMax))
  if (filters.currency) params.set('currency', filters.currency)
  if (filters.type) params.set('type', filters.type)
  if (filters.search) params.set('search', filters.search)
  if (filters.sort && filters.sort !== 'occurred_at') params.set('sort', filters.sort)
  if (filters.order && filters.order !== 'desc') params.set('order', filters.order)
  return params
}

// URL contract for the transactions page (accounts/categories are the
// human-facing names in the address bar).
export function filtersToSearchParams(filters: TransactionFilters): URLSearchParams {
  return appendFilterParams(new URLSearchParams(), filters, 'accounts', 'categories')
}

// Same serialization, but with the backend's account_ids/category_ids names.
export function filtersToApiSearchParams(filters: TransactionFilters): URLSearchParams {
  return appendFilterParams(new URLSearchParams(), filters, 'account_ids', 'category_ids')
}

export function searchParamsToFilters(params: URLSearchParams): TransactionFilters {
  const filters: TransactionFilters = {}
  const from = params.get('from')
  if (from) filters.from = from
  const to = params.get('to')
  if (to) filters.to = to
  const accountIds = parseList(params.get('accounts'))
  if (accountIds) filters.accountIds = accountIds
  const categoryIds = parseList(params.get('categories'))
  if (categoryIds) filters.categoryIds = categoryIds
  if (params.get('uncategorized') === 'true') filters.uncategorized = true
  const tags = parseList(params.get('tags'))
  if (tags) filters.tags = tags
  const tagMode = parseOneOf(params.get('tag_mode'), tagModes)
  if (tagMode && tagMode !== 'any') filters.tagMode = tagMode
  const amountMin = parseNumber(params.get('amount_min'))
  if (amountMin !== undefined) filters.amountMin = amountMin
  const amountMax = parseNumber(params.get('amount_max'))
  if (amountMax !== undefined) filters.amountMax = amountMax
  const currency = params.get('currency')
  if (currency) filters.currency = currency
  const type = parseOneOf<TransactionType>(params.get('type'), transactionTypes)
  if (type) filters.type = type
  const search = params.get('search')
  if (search) filters.search = search
  const sort = parseOneOf(params.get('sort'), sortFields)
  if (sort && sort !== 'occurred_at') filters.sort = sort
  const order = parseOneOf(params.get('order'), sortOrders)
  if (order && order !== 'desc') filters.order = order
  return filters
}
