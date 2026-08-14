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
  created_at: string
}

// Every exit path of the import pipeline names one of these. 'unknown' is only
// ever backfilled onto rows that predate the email log; it is never written by
// the pipeline (see docs/superpowers/specs/2026-08-13-email-inbox-design.md).
export type ImportVerdict =
  | 'imported'
  | 'not_transaction'
  | 'not_configured'
  | 'extract_failed'
  | 'failed'
  | 'unknown'

export interface EmailLogItem {
  message_id: string
  connection_id: string
  // The Gmail account the email arrived on: connection.external_id.
  account_email: string
  sender: string | null
  subject: string | null
  email_date: string | null
  // When the importer processed it: import_source.created_at.
  received_at: string
  verdict: ImportVerdict
  attempts: number
  // Null when nothing was imported, and also when an imported transaction was
  // later deleted: transaction_id is ON DELETE SET NULL.
  transaction: { id: string; description: string; amount: number; currency: string } | null
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
