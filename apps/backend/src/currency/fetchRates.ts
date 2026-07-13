import type { Queryable } from '../db/pool.js'
import type { ExchangeRate } from '../db/types.js'

const DAILY_RATES_URL = 'https://moneymanagerex.org/currency/data/latest_USD.json'
const HISTORICAL_RATES_URL = 'https://api.exchangerate.host/historical'

// Manual rows always win: the guard makes DO UPDATE a no-op on them, and
// RETURNING then yields zero rows, which callers use to count real writes.
const UPSERT_RATE_SQL = `INSERT INTO exchange_rates (base_code, quote_code, date, rate, source)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (base_code, quote_code, date) DO UPDATE
  SET rate = EXCLUDED.rate, source = EXCLUDED.source, updated_at = now()
  WHERE exchange_rates.source <> 'manual'
RETURNING base_code, quote_code, date::text AS date, rate::float8 AS rate, source`

// ExchangeRate-API v6 payload as served by the MMEX mirror: rates live in
// conversion_rates and the snapshot date only exists as a unix timestamp.
interface DailyRatesPayload {
  base_code: string
  time_last_update_unix: number
  conversion_rates: Record<string, number>
}

export async function fetchDailyRates(
  db: Queryable,
  fetchImpl: typeof fetch = fetch,
): Promise<{ upserted: number }> {
  const response = await fetchImpl(DAILY_RATES_URL)
  if (!response.ok) {
    throw new Error(`Daily rates fetch failed: HTTP ${response.status}`)
  }
  const payload = (await response.json()) as DailyRatesPayload
  if (!payload.conversion_rates || typeof payload.time_last_update_unix !== 'number') {
    throw new Error('Daily rates fetch failed: unexpected payload shape')
  }
  const snapshotDate = new Date(payload.time_last_update_unix * 1000)
    .toISOString()
    .slice(0, 10)

  const knownCurrencies = await db.query('SELECT code FROM currencies')
  const knownCodes = new Set<string>(
    knownCurrencies.rows.map((currencyRow: { code: string }) => currencyRow.code),
  )

  let upserted = 0
  for (const [quoteCode, rate] of Object.entries(payload.conversion_rates)) {
    if (quoteCode === 'USD') continue
    if (!knownCodes.has(quoteCode)) continue
    if (!(rate > 0)) continue
    const result = await db.query(UPSERT_RATE_SQL, [
      'USD',
      quoteCode,
      snapshotDate,
      rate,
      'exchangerate-api',
    ])
    upserted += result.rows.length
  }
  return { upserted }
}

let warnedMissingKey = false

interface HistoricalRatesPayload {
  success: boolean
  quotes?: Record<string, number>
}

export async function backfillRate(
  db: Queryable,
  quoteCode: string,
  onDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeRate | null> {
  const accessKey = process.env.EXCHANGERATE_HOST_KEY
  if (!accessKey) {
    if (!warnedMissingKey) {
      console.warn('EXCHANGERATE_HOST_KEY is not set: historical rate backfill is disabled')
      warnedMissingKey = true
    }
    return null
  }

  const url = `${HISTORICAL_RATES_URL}?date=${encodeURIComponent(onDate)}&source=USD&access_key=${encodeURIComponent(accessKey)}`
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Historical rates fetch failed: HTTP ${response.status}`)
  }
  const payload = (await response.json()) as HistoricalRatesPayload
  const rate = payload.quotes?.[`USD${quoteCode}`]
  if (!payload.success || rate === undefined || !(rate > 0)) return null

  const result = await db.query(UPSERT_RATE_SQL, [
    'USD',
    quoteCode,
    onDate,
    rate,
    'exchangerate-host',
  ])
  return result.rows.length ? (result.rows[0] as ExchangeRate) : null
}

// Same self-rescheduling pattern as startPolling in src/gmail/poller.ts:
// run once at startup, then every intervalMs; failures are logged, never fatal.
export function startRateFetching(
  db: Queryable,
  intervalMs: number,
  fetchImpl: typeof fetch = fetch,
): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const { upserted } = await fetchDailyRates(db, fetchImpl)
      console.log(`Daily rates fetch upserted ${upserted} rows`)
    } catch (error) {
      console.error('Daily rates fetch failed:', error)
    }
    if (!stopped) setTimeout(tick, intervalMs)
  }
  setTimeout(tick, 0)
  return () => {
    stopped = true
  }
}
