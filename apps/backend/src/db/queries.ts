import type { Queryable } from './pool.js'
import type {
  Account,
  AccountUpdate,
  Category,
  CategoryUpdate,
  Currency,
  ExchangeRate,
  NewAccount,
  NewCategory,
  NewTransaction,
  Settings,
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

export async function getTransactions(db: Queryable): Promise<Transaction[]> {
  const result = await db.query(
    // amount::float8 so node-postgres returns amount as a JS number (it returns
    // NUMERIC as a string by default), scoped to this column instead of a
    // process-global type parser.
    `SELECT id, description, amount::float8 AS amount, currency, account_id, category_id, tags, created_at, updated_at
       FROM transactions
      ORDER BY created_at DESC`,
  )
  return result.rows as Transaction[]
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

export async function getCurrencies(db: Queryable): Promise<Currency[]> {
  const result = await db.query(
    'SELECT code, name, symbol, decimal_places FROM currencies ORDER BY code',
  )
  return result.rows as Currency[]
}

export async function getSettings(db: Queryable): Promise<Settings> {
  const result = await db.query('SELECT id, base_currency_code FROM settings WHERE id = 1')
  return result.rows.length ? (result.rows[0] as Settings) : { id: 1, base_currency_code: 'PEN' }
}

export async function updateSettings(
  db: Queryable,
  baseCurrencyCode: string,
): Promise<Settings> {
  const result = await db.query(
    `INSERT INTO settings (id, base_currency_code) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE
       SET base_currency_code = EXCLUDED.base_currency_code, updated_at = now()
     RETURNING id, base_currency_code`,
    [baseCurrencyCode],
  )
  return result.rows[0] as Settings
}

export async function currencyExists(db: Queryable, code: string): Promise<boolean> {
  const result = await db.query('SELECT code FROM currencies WHERE code = $1', [code])
  return result.rows.length > 0
}

export async function getExchangeRates(
  db: Queryable,
  filters: { quote?: string; from?: string; to?: string },
): Promise<ExchangeRate[]> {
  const conditions = ["base_code = 'USD'"]
  const params: unknown[] = []
  if (filters.quote) {
    params.push(filters.quote)
    conditions.push(`quote_code = $${params.length}`)
  }
  if (filters.from) {
    params.push(filters.from)
    conditions.push(`date >= $${params.length}`)
  }
  if (filters.to) {
    params.push(filters.to)
    conditions.push(`date <= $${params.length}`)
  }
  const result = await db.query(
    `SELECT base_code, quote_code, date::text AS date, rate::float8 AS rate, source
       FROM exchange_rates
      WHERE ${conditions.join(' AND ')}
      ORDER BY date DESC, quote_code`,
    params,
  )
  return result.rows as ExchangeRate[]
}

export async function upsertManualRate(
  db: Queryable,
  manualRate: { base_code: string; quote_code: string; date: string; rate: number },
): Promise<ExchangeRate> {
  const result = await db.query(
    `INSERT INTO exchange_rates (base_code, quote_code, date, rate, source)
     VALUES ($1, $2, $3, $4, 'manual')
     ON CONFLICT (base_code, quote_code, date) DO UPDATE
       SET rate = EXCLUDED.rate, source = 'manual', updated_at = now()
     RETURNING base_code, quote_code, date::text AS date, rate::float8 AS rate, source`,
    [manualRate.base_code, manualRate.quote_code, manualRate.date, manualRate.rate],
  )
  return result.rows[0] as ExchangeRate
}
