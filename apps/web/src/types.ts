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

export interface Transaction {
  id: string
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string
  tags: string[]
  created_at: string
  updated_at: string | null
}

export interface NewTransaction {
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string
  tags: string[]
  created_at?: string
}

export interface TransactionUpdate {
  description?: string
  amount?: number
  currency?: string
  account_id?: string
  category_id?: string
  tags?: string[]
  created_at?: string
}

export interface TransactionListResponse {
  items: Transaction[]
  total: number
  limit: number
  offset: number
}

export interface SummaryRow {
  currency: string
  income: number
  spend: number
  net: number
  count: number
}

export interface SeriesRow {
  bucketStart: string
  currency: string
  income: number
  spend: number
  net: number
}

export interface CategoryRow {
  categoryId: string
  currency: string
  spend: number
  income: number
  net: number
  count: number
}

export interface TagRow {
  tag: string
  currency: string
  spend: number
  count: number
}

export interface AnalyticsPayload {
  summary: SummaryRow[]
  series: SeriesRow[]
  byCategory: CategoryRow[]
  byTag: TagRow[]
}
