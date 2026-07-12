import type { Queryable } from '../db/pool.js'

const PIVOT_CODE = 'USD'

const PAIR_LOOKUP_SQL = `SELECT rate::float8 AS rate, source
  FROM exchange_rates
 WHERE base_code = $1 AND quote_code = $2 AND date <= $3
 ORDER BY date DESC
 LIMIT 1`

// Latest stored rate for (baseCode -> quoteCode) on or before onDate, trying
// the direct row first and the inverse row (1/rate) second.
async function lookupPair(
  db: Queryable,
  baseCode: string,
  quoteCode: string,
  onDate: string,
): Promise<{ rate: number; source: string } | null> {
  const direct = await db.query(PAIR_LOOKUP_SQL, [baseCode, quoteCode, onDate])
  if (direct.rows.length) {
    return { rate: direct.rows[0].rate as number, source: direct.rows[0].source as string }
  }
  const inverse = await db.query(PAIR_LOOKUP_SQL, [quoteCode, baseCode, onDate])
  if (inverse.rows.length) {
    return { rate: 1 / (inverse.rows[0].rate as number), source: inverse.rows[0].source as string }
  }
  return null
}

export async function getRate(
  db: Queryable,
  fromCode: string,
  toCode: string,
  onDate: string,
): Promise<{ rate: number; source: string } | null> {
  if (fromCode === toCode) return { rate: 1, source: 'identity' }

  const pair = await lookupPair(db, fromCode, toCode, onDate)
  if (pair) return pair

  // Triangulate through USD: fromCode -> USD, then USD -> toCode. The daily
  // fetcher stores USD-based rows, so this covers any pair of known
  // currencies. Never fall back to 1 across different codes.
  if (fromCode === PIVOT_CODE || toCode === PIVOT_CODE) return null

  const fromLeg = await lookupPair(db, fromCode, PIVOT_CODE, onDate)
  if (!fromLeg) return null
  const toLeg = await lookupPair(db, PIVOT_CODE, toCode, onDate)
  if (!toLeg) return null
  return { rate: fromLeg.rate * toLeg.rate, source: 'triangulated' }
}

export async function convertAmount(
  db: Queryable,
  amount: number,
  fromCode: string,
  toCode: string,
  onDate: string,
): Promise<{ convertedAmount: number; rateUsed: number } | null> {
  const lookup = await getRate(db, fromCode, toCode, onDate)
  if (!lookup) return null

  const currencyResult = await db.query(
    'SELECT decimal_places FROM currencies WHERE code = $1',
    [toCode],
  )
  const decimalPlaces = currencyResult.rows.length
    ? (currencyResult.rows[0].decimal_places as number)
    : 2
  const roundingFactor = 10 ** decimalPlaces
  const convertedAmount = Math.round(amount * lookup.rate * roundingFactor) / roundingFactor
  return { convertedAmount, rateUsed: lookup.rate }
}

export async function getBaseCurrencyCode(db: Queryable): Promise<string> {
  const result = await db.query('SELECT base_currency_code FROM settings WHERE id = 1')
  return result.rows.length ? (result.rows[0].base_currency_code as string) : 'PEN'
}
