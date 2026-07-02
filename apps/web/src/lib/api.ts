import type {
  Account,
  AccountUpdate,
  Category,
  CategoryUpdate,
  NewAccount,
  NewCategory,
  NewTransaction,
  Transaction,
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

export const transactionsApi = createResourceApi<Transaction, NewTransaction, TransactionUpdate>(
  'transactions',
)
export const accountsApi = createResourceApi<Account, NewAccount, AccountUpdate>('accounts')
export const categoriesApi = createResourceApi<Category, NewCategory, CategoryUpdate>('categories')

export const tagsApi = {
  list: () => request<string[]>('/tags'),
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}
