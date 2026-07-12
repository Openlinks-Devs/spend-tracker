export interface Category {
  id: string
  name: string
  type: string
}

export interface NewCategory {
  name: string
  type: string
}

export interface CategoryUpdate {
  name?: string
  type?: string
}

export interface Account {
  id: string
  name: string
  type: string
  currency: string
}

export interface NewAccount {
  name: string
  type: string
  currency: string
}

export interface AccountUpdate {
  name?: string
  type?: string
  currency?: string
}

export type TransactionType = 'expense' | 'income' | 'transfer'

// Mirrors the backend transactions row (apps/backend/src/db/types.ts).
export interface Transaction {
  id: string
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string | null
  tags: string[]
  type: TransactionType
  payee: string | null
  notes: string | null
  occurred_at: string
  base_amount: number | null
  rate_used: number | null
  to_account_id: string | null
  to_amount: number | null
  external_id: string | null
  created_at: string
  updated_at: string | null
}

// POST /api/transactions body. Amount is always positive; the server derives
// the stored sign from `type`.
export interface NewTransaction {
  description: string
  amount: number
  currency: string
  account_id: string
  category_id?: string | null
  tags?: string[]
  type: TransactionType
  payee?: string | null
  notes?: string | null
  occurred_at?: string
  base_amount?: number | null
  rate_used?: number | null
  to_account_id?: string | null
  to_amount?: number | null
  external_id?: string
}

export interface TransactionUpdate {
  description?: string
  amount?: number
  currency?: string
  account_id?: string
  category_id?: string | null
  tags?: string[]
  type?: TransactionType
  payee?: string | null
  notes?: string | null
  occurred_at?: string
  base_amount?: number | null
  rate_used?: number | null
  to_account_id?: string | null
  to_amount?: number | null
}

// Mirrors GET /api/payees: one row per distinct payee, carrying the
// category of that payee's most recent non-transfer transaction.
export interface Payee {
  payee: string
  last_category_id: string | null
}

export interface Currency {
  code: string
  name: string
  symbol: string
  decimal_places: number
}

export interface Settings {
  id: number
  base_currency_code: string
}

export interface TransactionFilters {
  from?: string
  to?: string
  accountIds?: string[]
  categoryIds?: string[]
  uncategorized?: boolean
  tags?: string[]
  tagMode?: 'any' | 'all' | 'none'
  amountMin?: number
  amountMax?: number
  currency?: string
  type?: TransactionType
  search?: string
  sort?: 'occurred_at' | 'amount'
  order?: 'desc' | 'asc'
}

export interface TransactionTotals {
  count: number
  by_currency: { currency: string; sum: number }[]
  base: { currency: string; sum: number | null }
}

export interface TransactionListResponse {
  items: Transaction[]
  next_cursor: string | null
  totals: TransactionTotals
}
