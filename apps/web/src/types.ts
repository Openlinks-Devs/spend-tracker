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
  category_id: string | null
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
  category_id?: string
  tags?: string[]
}
