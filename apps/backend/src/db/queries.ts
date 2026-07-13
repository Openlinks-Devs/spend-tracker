import type { Queryable } from './pool.js'
import { buildTransactionFilter, type TransactionFilter } from './transactionFilter.js'
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
} from './types.js'

export async function getCategories(db: Queryable): Promise<Category[]> {
  const result = await db.query('SELECT id, name, type FROM categories ORDER BY name')
  return result.rows as Category[]
}

export async function getCategoryById(db: Queryable, id: string): Promise<Category | null> {
  const result = await db.query('SELECT id, name, type FROM categories WHERE id = $1', [id])
  return result.rows.length ? (result.rows[0] as Category) : null
}

export async function insertCategory(
  db: Queryable,
  category: NewCategory,
): Promise<{ id: string }> {
  const result = await db.query(
    'INSERT INTO categories (name, type) VALUES ($1, $2) RETURNING id',
    [category.name, category.type],
  )
  return { id: result.rows[0].id as string }
}

export async function updateCategory(db: Queryable, update: CategoryUpdate): Promise<void> {
  await db.query('UPDATE categories SET name = $2, type = $3 WHERE id = $1', [
    update.id,
    update.name,
    update.type,
  ])
}

export async function deleteCategory(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM categories WHERE id = $1', [id])
}

export async function getAccounts(db: Queryable): Promise<Account[]> {
  const result = await db.query('SELECT id, name, type, currency FROM accounts ORDER BY name')
  return result.rows as Account[]
}

export async function getAccountById(db: Queryable, id: string): Promise<Account | null> {
  const result = await db.query(
    'SELECT id, name, type, currency FROM accounts WHERE id = $1',
    [id],
  )
  return result.rows.length ? (result.rows[0] as Account) : null
}

export async function insertAccount(db: Queryable, account: NewAccount): Promise<{ id: string }> {
  const result = await db.query(
    'INSERT INTO accounts (name, type, currency) VALUES ($1, $2, $3) RETURNING id',
    [account.name, account.type, account.currency],
  )
  return { id: result.rows[0].id as string }
}

export async function updateAccount(db: Queryable, update: AccountUpdate): Promise<void> {
  await db.query('UPDATE accounts SET name = $2, type = $3, currency = $4 WHERE id = $1', [
    update.id,
    update.name,
    update.type,
    update.currency,
  ])
}

export async function deleteAccount(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM accounts WHERE id = $1', [id])
}

// amount::float8 so node-postgres returns amount as a JS number (it returns
// NUMERIC as a string by default), scoped to this column instead of a
// process-global type parser.
const TRANSACTION_COLUMNS =
  'id, description, amount::float8 AS amount, currency, account_id, category_id, tags, created_at, updated_at'

const SORT_COLUMNS: Record<string, string> = {
  'created_at desc': 'created_at DESC',
  'created_at asc': 'created_at ASC',
  'amount desc': 'amount DESC',
  'amount asc': 'amount ASC',
}

export async function getTransactions(
  db: Queryable,
  filter: TransactionFilter = {},
  page: { limit: number; offset: number; sort?: string } = { limit: 50, offset: 0 },
): Promise<Transaction[]> {
  const { clause, params } = buildTransactionFilter(filter)
  const orderBy = SORT_COLUMNS[page.sort ?? 'created_at desc'] ?? 'created_at DESC'
  const limitPlaceholder = params.length + 1
  const offsetPlaceholder = params.length + 2
  const result = await db.query(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions ${clause} ORDER BY ${orderBy} LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}`,
    [...params, page.limit, page.offset],
  )
  return result.rows as Transaction[]
}

export async function getTransactionsCount(
  db: Queryable,
  filter: TransactionFilter = {},
): Promise<number> {
  const { clause, params } = buildTransactionFilter(filter)
  const result = await db.query(`SELECT count(*)::int AS count FROM transactions ${clause}`, params)
  return Number(result.rows[0]?.count ?? 0)
}

export async function getTransactionById(db: Queryable, id: string): Promise<Transaction | null> {
  const result = await db.query(
    `SELECT id, description, amount::float8 AS amount, currency, account_id, category_id, tags, created_at, updated_at
       FROM transactions
      WHERE id = $1`,
    [id],
  )
  return result.rows.length ? (result.rows[0] as Transaction) : null
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
       SET description = $2, amount = $3, currency = $4, account_id = $5,
           category_id = $6, tags = $7, created_at = $8, updated_at = now()
     WHERE id = $1`,
    [
      update.id,
      update.description,
      update.amount,
      update.currency,
      update.account_id,
      update.category_id,
      update.tags,
      update.created_at,
    ],
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
