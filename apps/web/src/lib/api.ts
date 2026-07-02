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

export const transactionsApi = {
  list: () => request<Transaction[]>('/transactions'),
  get: (transactionId: string) => request<Transaction>(`/transactions/${transactionId}`),
  create: (payload: NewTransaction) =>
    request<Transaction>('/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  update: (transactionId: string, payload: TransactionUpdate) =>
    request<Transaction>(`/transactions/${transactionId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  remove: (transactionId: string) =>
    request<{ success: boolean }>(`/transactions/${transactionId}`, {
      method: 'DELETE',
    }),
}

export const accountsApi = {
  list: () => request<Account[]>('/accounts'),
  get: (accountId: string) => request<Account>(`/accounts/${accountId}`),
  create: (payload: NewAccount) =>
    request<Account>('/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  update: (accountId: string, payload: AccountUpdate) =>
    request<Account>(`/accounts/${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  remove: (accountId: string) =>
    request<{ success: boolean }>(`/accounts/${accountId}`, {
      method: 'DELETE',
    }),
}

export const categoriesApi = {
  list: () => request<Category[]>('/categories'),
  get: (categoryId: string) => request<Category>(`/categories/${categoryId}`),
  create: (payload: NewCategory) =>
    request<Category>('/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  update: (categoryId: string, payload: CategoryUpdate) =>
    request<Category>(`/categories/${categoryId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  remove: (categoryId: string) =>
    request<{ success: boolean }>(`/categories/${categoryId}`, {
      method: 'DELETE',
    }),
}

export const tagsApi = {
  list: () => request<string[]>('/tags'),
}
