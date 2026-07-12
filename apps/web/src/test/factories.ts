import type { Transaction } from '@/types'

let transactionCounter = 0

export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  transactionCounter += 1
  return {
    id: `00000000-0000-4000-8000-${String(transactionCounter).padStart(12, '0')}`,
    description: 'Coffee',
    amount: -10,
    currency: 'PEN',
    account_id: 'acc-1',
    category_id: 'cat-1',
    tags: [],
    type: 'expense',
    payee: null,
    notes: null,
    occurred_at: '2026-07-10T12:00:00.000Z',
    base_amount: -10,
    rate_used: 1,
    to_account_id: null,
    to_amount: null,
    external_id: null,
    created_at: '2026-07-10T12:00:00.000Z',
    updated_at: null,
    ...overrides,
  }
}
