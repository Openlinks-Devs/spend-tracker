import { filtersToApiSearchParams } from '@/lib/filterParams'
import type {
  Account,
  AccountUpdate,
  Category,
  CategoryUpdate,
  Currency,
  NewAccount,
  NewCategory,
  NewTransaction,
  Payee,
  Settings,
  Transaction,
  TransactionFilters,
  TransactionListResponse,
  TransactionUpdate,
} from '@/types'

const baseUrl = import.meta.env.VITE_API_URL ?? '/api'

interface ApiErrorBody {
  error?: string
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const body = (await response.json()) as ApiErrorBody
      if (body?.error) message = body.error
    } catch {
      // Response had no JSON body; keep the default message.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) {
    return undefined as TResponse
  }

  return (await response.json()) as TResponse
}

export interface ResourceApi<Entity, NewEntity, UpdateEntity> {
  list: () => Promise<Entity[]>
  get: (id: string) => Promise<Entity>
  create: (payload: NewEntity) => Promise<Entity>
  update: (id: string, payload: UpdateEntity) => Promise<Entity>
  remove: (id: string) => Promise<{ success: boolean }>
}

// All three CRUD resources share the same REST shape; only the path segment and
// types differ. One factory keeps them in sync.
function createResourceApi<Entity, NewEntity, UpdateEntity>(
  path: string,
): ResourceApi<Entity, NewEntity, UpdateEntity> {
  return {
    list: () => request<Entity[]>(`/${path}`),
    get: (id) => request<Entity>(`/${path}/${id}`),
    create: (payload) =>
      request<Entity>(`/${path}`, { method: 'POST', body: JSON.stringify(payload) }),
    update: (id, payload) =>
      request<Entity>(`/${path}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    remove: (id) => request<{ success: boolean }>(`/${path}/${id}`, { method: 'DELETE' }),
  }
}

const transactionsResource = createResourceApi<Transaction, NewTransaction, TransactionUpdate>(
  'transactions',
)

// Bridge: GET /api/transactions now returns a paginated envelope. Old pages
// still consume a flat array until they move to useTransactionsInfinite
// (Tasks 11 to 13), so list() unwraps the first page.
export const transactionsApi = {
  ...transactionsResource,
  list: () =>
    request<TransactionListResponse>('/transactions?limit=200').then((page) => page.items),
  // The backend computes totals over the whole filtered set regardless of page
  // size, so a single-item page is the cheapest way to fetch them.
  totals: () =>
    request<TransactionListResponse>('/transactions?limit=1').then((page) => page.totals),
}

export function listTransactionsPage(
  filters: TransactionFilters,
  cursor: string | null,
): Promise<TransactionListResponse> {
  const params = filtersToApiSearchParams(filters)
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()
  return request<TransactionListResponse>(`/transactions${query ? `?${query}` : ''}`)
}

export const currenciesApi = {
  list: () => request<Currency[]>('/currencies'),
}

export const settingsApi = {
  get: () => request<Settings>('/settings'),
  update: (payload: { base_currency_code: string }) =>
    request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
}

export const accountsApi = createResourceApi<Account, NewAccount, AccountUpdate>('accounts')
export const categoriesApi = createResourceApi<Category, NewCategory, CategoryUpdate>('categories')

export const tagsApi = {
  list: () => request<string[]>('/tags'),
}

export const payeesApi = {
  list: () => request<Payee[]>('/payees'),
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}
