import type { Queryable } from '../db/pool.js'
import { getAccounts, getCategories, getDistinctTags, insertTransaction } from '../db/queries.js'
import { detectTransaction } from '../ai/detect.js'
import { extractTransaction } from '../ai/extract.js'
import { sendMessage } from '../telegram/client.js'
import { formatError, formatNewTransaction } from '../telegram/format.js'

export interface ProcessDeps {
  db: Queryable
  now: () => string
  detect: typeof detectTransaction
  extract: typeof extractTransaction
  notify: typeof sendMessage
}

export const defaultProcessDeps: Omit<ProcessDeps, 'db'> = {
  now: () => new Date().toISOString(),
  detect: detectTransaction,
  extract: extractTransaction,
  notify: sendMessage,
}

export async function processEmail(
  email: { subject: string; text: string },
  deps: ProcessDeps,
): Promise<void> {
  const isTransaction = await deps.detect({ subject: email.subject, text: email.text })
  if (!isTransaction) return

  const [categories, accounts, tags] = await Promise.all([
    getCategories(deps.db),
    getAccounts(deps.db),
    getDistinctTags(deps.db),
  ])

  const extracted = await deps.extract({
    text: email.text,
    categories,
    accounts,
    tags,
    now: deps.now(),
  })

  if (!extracted) {
    await deps.notify(formatError(`No se pudo determinar la cuenta para: ${email.subject}`))
    return
  }

  const { id } = await insertTransaction(deps.db, {
    description: extracted.description,
    amount: extracted.amount,
    currency: extracted.currency,
    account_id: extracted.account_id,
    category_id: extracted.category_id,
    tags: extracted.tags,
    type: extracted.amount < 0 ? 'expense' : 'income',
    payee: null,
    notes: null,
    occurred_at: extracted.created_at,
    base_amount: null,
    rate_used: null,
    to_account_id: null,
    to_amount: null,
    external_id: null,
  })
  const account = accounts.find((candidate) => candidate.id === extracted.account_id)
  const category = categories.find((candidate) => candidate.id === extracted.category_id)
  await deps.notify(
    formatNewTransaction({
      id,
      description: extracted.description,
      accountName: account?.name ?? extracted.account_id,
      categoryName: category?.name ?? extracted.category_id,
      tags: extracted.tags,
      currency: extracted.currency,
      amount: extracted.amount,
      created_at: extracted.created_at,
    }),
  )
}
