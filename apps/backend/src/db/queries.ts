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

export interface AccountRow {
  accountId: string
  currency: string
  income: number
  spend: number
  net: number
  count: number
}

export interface AnalyticsPayload {
  summary: SummaryRow[]
  series: SeriesRow[]
  byCategory: CategoryRow[]
  byTag: TagRow[]
  byAccount: AccountRow[]
}

export async function getCategories(db: Queryable, userId: string): Promise<Category[]> {
  const result = await db.query(
    'SELECT id, name, type FROM categories WHERE user_id = $1 ORDER BY name',
    [userId],
  )
  return result.rows as Category[]
}

export async function getCategoryById(
  db: Queryable,
  userId: string,
  id: string,
): Promise<Category | null> {
  const result = await db.query(
    'SELECT id, name, type FROM categories WHERE id = $1 AND user_id = $2',
    [id, userId],
  )
  return result.rows.length ? (result.rows[0] as Category) : null
}

export async function insertCategory(
  db: Queryable,
  userId: string,
  category: NewCategory,
): Promise<{ id: string }> {
  const result = await db.query(
    'INSERT INTO categories (name, type, user_id) VALUES ($1, $2, $3) RETURNING id',
    [category.name, category.type, userId],
  )
  return { id: result.rows[0].id as string }
}

export async function updateCategory(
  db: Queryable,
  userId: string,
  update: CategoryUpdate,
): Promise<void> {
  await db.query('UPDATE categories SET name = $2, type = $3 WHERE id = $1 AND user_id = $4', [
    update.id,
    update.name,
    update.type,
    userId,
  ])
}

export async function deleteCategory(db: Queryable, userId: string, id: string): Promise<void> {
  await db.query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [id, userId])
}

export async function getAccounts(db: Queryable, userId: string): Promise<Account[]> {
  const result = await db.query(
    'SELECT id, name, type, currency FROM accounts WHERE user_id = $1 ORDER BY name',
    [userId],
  )
  return result.rows as Account[]
}

export async function getAccountById(
  db: Queryable,
  userId: string,
  id: string,
): Promise<Account | null> {
  const result = await db.query(
    'SELECT id, name, type, currency FROM accounts WHERE id = $1 AND user_id = $2',
    [id, userId],
  )
  return result.rows.length ? (result.rows[0] as Account) : null
}

export async function insertAccount(
  db: Queryable,
  userId: string,
  account: NewAccount,
): Promise<{ id: string }> {
  const result = await db.query(
    'INSERT INTO accounts (name, type, currency, user_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [account.name, account.type, account.currency, userId],
  )
  return { id: result.rows[0].id as string }
}

export async function updateAccount(
  db: Queryable,
  userId: string,
  update: AccountUpdate,
): Promise<void> {
  await db.query(
    'UPDATE accounts SET name = $2, type = $3, currency = $4 WHERE id = $1 AND user_id = $5',
    [update.id, update.name, update.type, update.currency, userId],
  )
}

export async function deleteAccount(db: Queryable, userId: string, id: string): Promise<void> {
  await db.query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [id, userId])
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

const ANALYTICS_INCOME_EXPRESSION = 'sum(case when amount > 0 then amount else 0 end)::float8'
const ANALYTICS_SPEND_EXPRESSION = 'sum(case when amount < 0 then -amount else 0 end)::float8'

export async function getAnalytics(
  db: Queryable,
  filter: TransactionFilter,
  bucket: 'day' | 'week' | 'month',
): Promise<AnalyticsPayload> {
  const safeBucket = bucket === 'day' || bucket === 'week' ? bucket : 'month'
  const { clause, params } = buildTransactionFilter(filter)

  const summary = await db.query(
    `SELECT currency, ${ANALYTICS_INCOME_EXPRESSION} AS income, ${ANALYTICS_SPEND_EXPRESSION} AS spend,
            sum(amount)::float8 AS net, count(*)::int AS count
       FROM transactions ${clause} GROUP BY currency ORDER BY currency`,
    params,
  )
  const series = await db.query(
    `SELECT to_char(date_trunc('${safeBucket}', created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "bucketStart",
            currency, ${ANALYTICS_INCOME_EXPRESSION} AS income, ${ANALYTICS_SPEND_EXPRESSION} AS spend,
            sum(amount)::float8 AS net
       FROM transactions ${clause}
      GROUP BY 1, currency ORDER BY 1`,
    params,
  )
  const byCategory = await db.query(
    `SELECT category_id AS "categoryId", currency, ${ANALYTICS_SPEND_EXPRESSION} AS spend,
            ${ANALYTICS_INCOME_EXPRESSION} AS income, sum(amount)::float8 AS net, count(*)::int AS count
       FROM transactions ${clause} GROUP BY category_id, currency ORDER BY spend DESC`,
    params,
  )
  const byTag = await db.query(
    `SELECT tag, currency, ${ANALYTICS_SPEND_EXPRESSION} AS spend, count(*)::int AS count
       FROM (SELECT unnest(tags) AS tag, amount, currency FROM transactions ${clause}) tagged
      GROUP BY tag, currency ORDER BY spend DESC`,
    params,
  )
  const byAccount = await db.query(
    `SELECT account_id AS "accountId", currency, ${ANALYTICS_INCOME_EXPRESSION} AS income,
            ${ANALYTICS_SPEND_EXPRESSION} AS spend, sum(amount)::float8 AS net, count(*)::int AS count
       FROM transactions ${clause} GROUP BY account_id, currency ORDER BY net DESC`,
    params,
  )

  return {
    summary: summary.rows as SummaryRow[],
    series: series.rows as SeriesRow[],
    byCategory: byCategory.rows as CategoryRow[],
    byTag: byTag.rows as TagRow[],
    byAccount: byAccount.rows as AccountRow[],
  }
}

export async function getTransactionById(
  db: Queryable,
  userId: string,
  id: string,
): Promise<Transaction | null> {
  const result = await db.query(
    `SELECT id, description, amount::float8 AS amount, currency, account_id, category_id, tags, created_at, updated_at
       FROM transactions
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return result.rows.length ? (result.rows[0] as Transaction) : null
}

export async function getDistinctTags(db: Queryable, userId: string): Promise<string[]> {
  const result = await db.query(
    'SELECT DISTINCT unnest(tags) AS tag FROM transactions WHERE user_id = $1',
    [userId],
  )
  return result.rows.map((row: { tag: string }) => row.tag)
}

export async function insertTransaction(
  db: Queryable,
  userId: string,
  transaction: NewTransaction,
): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO transactions
       (description, amount, currency, account_id, category_id, tags, created_at, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      transaction.description,
      transaction.amount,
      transaction.currency,
      transaction.account_id,
      transaction.category_id,
      transaction.tags,
      transaction.created_at,
      userId,
    ],
  )
  return { id: result.rows[0].id as string }
}

// A transfer is two transactions (money out of one account, into another) that
// must both land or neither does, so they run in a single DB transaction on a
// dedicated client. pg.Pool satisfies TransactionalPool.
interface PoolClientLike extends Queryable {
  release: () => void
}

export interface TransactionalPool {
  connect: () => Promise<PoolClientLike>
}

export async function createTransfer(
  pool: TransactionalPool,
  userId: string,
  legs: { from: NewTransaction; to: NewTransaction },
): Promise<{ from: Transaction; to: Transaction }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const outLeg = await insertTransaction(client, userId, legs.from)
    const inLeg = await insertTransaction(client, userId, legs.to)
    await client.query('COMMIT')
    const from = await getTransactionById(client, userId, outLeg.id)
    const to = await getTransactionById(client, userId, inLeg.id)
    if (!from || !to) throw new Error('Transfer legs missing after insert')
    return { from, to }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function updateTransaction(
  db: Queryable,
  userId: string,
  update: TransactionUpdate,
): Promise<void> {
  await db.query(
    `UPDATE transactions
       SET description = $2, amount = $3, currency = $4, account_id = $5,
           category_id = $6, tags = $7, created_at = $8, updated_at = now()
     WHERE id = $1 AND user_id = $9`,
    [
      update.id,
      update.description,
      update.amount,
      update.currency,
      update.account_id,
      update.category_id,
      update.tags,
      update.created_at,
      userId,
    ],
  )
}

export async function deleteTransaction(db: Queryable, userId: string, id: string): Promise<void> {
  await db.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, userId])
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
