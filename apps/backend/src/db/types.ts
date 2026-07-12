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
  id: string
  name: string
  type: string
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
  id: string
  name: string
  type: string
  currency: string
}

export interface Transaction {
  id: string
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string | null
  tags: string[]
  type: 'expense' | 'income' | 'transfer'
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

export interface ExchangeRate {
  base_code: string
  quote_code: string
  date: string
  rate: number
  source: 'exchangerate-api' | 'exchangerate-host' | 'manual'
}

export interface NewTransaction {
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string
  tags: string[]
  created_at: string
}

export interface TransactionUpdate {
  id: string
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string
  tags: string[]
  created_at: string
}
