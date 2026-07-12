import { describe, it, expect, vi } from 'vitest'
import { resolveCurrencyCode, roundToDecimalPlaces } from '../src/routes/currencyValidation.js'

function fakeDb(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('resolveCurrencyCode', () => {
  it('normalizes case and whitespace before looking up the currency', async () => {
    const db = fakeDb([{ code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', decimal_places: 2 }])
    const resolution = await resolveCurrencyCode(db, ' pen ')
    expect(resolution).toEqual({ success: true, code: 'PEN', decimalPlaces: 2 })
    expect(db.query.mock.calls[0][1]).toEqual(['PEN'])
  })

  it('returns a 400 failure for an unknown currency code', async () => {
    const db = fakeDb([])
    const resolution = await resolveCurrencyCode(db, 'XXX')
    expect(resolution).toEqual({
      success: false,
      failure: { status: 400, error: 'Unknown currency code: XXX' },
    })
  })
})

describe('roundToDecimalPlaces', () => {
  it('rounds to an integer for a zero-decimal currency (JPY)', () => {
    expect(roundToDecimalPlaces(100.5, 0)).toBe(101)
  })

  it('keeps three decimals for a three-decimal currency (BHD)', () => {
    expect(roundToDecimalPlaces(1.2345, 3)).toBe(1.235)
  })

  it('keeps two decimals for a two-decimal currency (PEN)', () => {
    expect(roundToDecimalPlaces(12.345, 2)).toBe(12.35)
  })
})
