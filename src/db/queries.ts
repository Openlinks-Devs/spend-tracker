import type { Queryable } from './pool.js'
import type { Account, Category, NewTransaction, TransactionUpdate } from './types.js'

export async function getCategories(db: Queryable): Promise<Category[]> {
  const result = await db.query('SELECT id, name, type FROM categories')
  return result.rows as Category[]
}

export async function getAccounts(db: Queryable): Promise<Account[]> {
  const result = await db.query('SELECT id, name, type, currency FROM accounts')
  return result.rows as Account[]
}

export async function getDistinctTags(db: Queryable): Promise<string[]> {
  const result = await db.query('SELECT DISTINCT unnest(tags) AS tag FROM transactions')
  return result.rows.map((row: { tag: string }) => row.tag)
}

export async function insertTransaction(
  db: Queryable,
  transaction: NewTransaction,
): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO transactions
       (description, amount, currency, account_id, category_id, tags, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      transaction.description,
      transaction.amount,
      transaction.currency,
      transaction.account_id,
      transaction.category_id,
      transaction.tags,
      transaction.created_at,
    ],
  )
  return { id: result.rows[0].id as string }
}

export async function updateTransaction(db: Queryable, update: TransactionUpdate): Promise<void> {
  await db.query(
    `UPDATE transactions
       SET description = $2, category_id = $3, tags = $4, updated_at = now()
     WHERE id = $1`,
    [update.id, update.description, update.category_id, update.tags],
  )
}

export async function deleteTransaction(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM transactions WHERE id = $1', [id])
}

export async function ensureStateTable(db: Queryable): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS agent_state (key text PRIMARY KEY, value text)')
}

export async function getState(db: Queryable, key: string): Promise<string | null> {
  const result = await db.query('SELECT value FROM agent_state WHERE key = $1', [key])
  return result.rows.length ? (result.rows[0].value as string) : null
}

export async function setState(db: Queryable, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO agent_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  )
}
