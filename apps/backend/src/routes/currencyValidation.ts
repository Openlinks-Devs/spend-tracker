import type { Queryable } from '../db/pool.js'
import { getCurrencyByCode } from '../db/queries.js'

export interface CurrencyValidationFailure {
  status: 400
  error: string
}

export type CurrencyResolution =
  | { success: true; code: string; decimalPlaces: number }
  | { success: false; failure: CurrencyValidationFailure }

// Mirrors the pipeline's normalization (src/pipeline/processEmail.ts) so the
// same "PEN"/"pen "/" Pen" input resolves to the same currencies row, and
// reports an unknown code as a 400 instead of letting it fall through to a
// currency foreign key constraint and surface as a generic 500. Shared by the
// transactions and accounts routes so both reject unknown currencies the
// same way.
export async function resolveCurrencyCode(
  db: Queryable,
  rawCurrency: string,
): Promise<CurrencyResolution> {
  const currencyCode = rawCurrency.trim().toUpperCase()
  const currency = await getCurrencyByCode(db, currencyCode)
  if (!currency) {
    return { success: false, failure: { status: 400, error: `Unknown currency code: ${currencyCode}` } }
  }
  return { success: true, code: currencyCode, decimalPlaces: currency.decimal_places }
}

// Round half away from zero to the currency's decimal_places, e.g. 100.5 JPY
// (0 decimals) -> 101, 1.2345 BHD (3 decimals) -> 1.235. Rounding, not
// rejection: research P0 item 1 requires decimal_places to be respected in
// entry, rounding, and display. Callers only ever pass positive magnitudes
// (amount and to_amount are validated positive, and sign is applied after
// rounding), so scaled Math.round is round-half-away-from-zero here.
export function roundToDecimalPlaces(amount: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces
  return Math.round(amount * factor) / factor
}
