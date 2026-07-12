import { describe, it, expect, vi } from 'vitest'
import { getRate, convertAmount, getBaseCurrencyCode } from '../src/currency/rates.js'

function fakeDbSequence(rowSets: unknown[][]) {
  const query = vi.fn()
  for (const rows of rowSets) {
    query.mockResolvedValueOnce({ rows })
  }
  return { query }
}

describe('getRate', () => {
  it('returns identity for the same code without querying', async () => {
    const db = { query: vi.fn() }
    const lookup = await getRate(db, 'PEN', 'PEN', '2026-07-10')
    expect(lookup).toEqual({ rate: 1, source: 'identity' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns the direct pair at the latest date on or before onDate', async () => {
    const db = fakeDbSequence([[{ rate: 3.74, source: 'exchangerate-api' }]])
    const lookup = await getRate(db, 'USD', 'PEN', '2026-07-10')
    expect(lookup).toEqual({ rate: 3.74, source: 'exchangerate-api' })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/from exchange_rates/i)
    expect(sql).toMatch(/date <= \$3/i)
    expect(sql).toMatch(/order by date desc/i)
    expect(sql).toMatch(/limit 1/i)
    expect(params).toEqual(['USD', 'PEN', '2026-07-10'])
  })

  it('falls back to the inverse pair and returns 1/rate', async () => {
    const db = fakeDbSequence([
      [], // direct PEN -> USD misses
      [{ rate: 3.74, source: 'manual' }], // inverse USD -> PEN hits
    ])
    const lookup = await getRate(db, 'PEN', 'USD', '2026-07-10')
    expect(lookup?.rate).toBeCloseTo(1 / 3.74, 10)
    expect(lookup?.source).toBe('manual')
    expect(db.query.mock.calls[1][1]).toEqual(['USD', 'PEN', '2026-07-10'])
  })

  it('triangulates through USD when no direct or inverse pair exists', async () => {
    const db = fakeDbSequence([
      [], // direct PEN -> CLP
      [], // inverse CLP -> PEN
      [], // leg A direct PEN -> USD
      [{ rate: 3.74, source: 'exchangerate-api' }], // leg A inverse USD -> PEN
      [{ rate: 940, source: 'exchangerate-api' }], // leg B direct USD -> CLP
    ])
    const lookup = await getRate(db, 'PEN', 'CLP', '2026-07-10')
    expect(lookup?.rate).toBeCloseTo(940 / 3.74, 8)
    expect(lookup?.source).toBe('triangulated')
    expect(db.query).toHaveBeenCalledTimes(5)
  })

  it('returns null when nothing is stored, never a silent 1', async () => {
    const db = fakeDbSequence([[], [], [], [], [], []])
    const lookup = await getRate(db, 'PEN', 'CLP', '2026-07-10')
    expect(lookup).toBeNull()
  })

  it('does not triangulate when one side is USD', async () => {
    const db = fakeDbSequence([[], []])
    const lookup = await getRate(db, 'USD', 'PEN', '2026-07-10')
    expect(lookup).toBeNull()
    expect(db.query).toHaveBeenCalledTimes(2)
  })
})

describe('convertAmount', () => {
  it('rounds to the target currency decimal_places', async () => {
    const db = fakeDbSequence([
      [{ rate: 3.7412, source: 'exchangerate-api' }], // direct USD -> PEN
      [{ decimal_places: 2 }], // currencies lookup for PEN
    ])
    const conversion = await convertAmount(db, 20, 'USD', 'PEN', '2026-07-10')
    expect(conversion).toEqual({ convertedAmount: 74.82, rateUsed: 3.7412 })
    const [currencySql, currencyParams] = db.query.mock.calls[1]
    expect(currencySql).toMatch(/from currencies/i)
    expect(currencyParams).toEqual(['PEN'])
  })

  it('rounds to zero decimals for zero-decimal currencies', async () => {
    const db = fakeDbSequence([
      [{ rate: 155.123, source: 'exchangerate-api' }],
      [{ decimal_places: 0 }],
    ])
    const conversion = await convertAmount(db, 10, 'USD', 'JPY', '2026-07-10')
    expect(conversion).toEqual({ convertedAmount: 1551, rateUsed: 155.123 })
  })

  it('preserves the sign of negative amounts', async () => {
    const db = fakeDbSequence([
      [{ rate: 3.74, source: 'exchangerate-api' }],
      [{ decimal_places: 2 }],
    ])
    const conversion = await convertAmount(db, -20, 'USD', 'PEN', '2026-07-10')
    expect(conversion?.convertedAmount).toBeCloseTo(-74.8, 2)
  })

  it('defaults to 2 decimal places when the currency row is missing', async () => {
    const db = fakeDbSequence([
      [{ rate: 3.7412, source: 'exchangerate-api' }],
      [],
    ])
    const conversion = await convertAmount(db, 20, 'USD', 'PEN', '2026-07-10')
    expect(conversion?.convertedAmount).toBe(74.82)
  })

  it('returns null when no rate exists', async () => {
    const db = fakeDbSequence([[], [], [], [], [], []])
    const conversion = await convertAmount(db, 20, 'PEN', 'CLP', '2026-07-10')
    expect(conversion).toBeNull()
  })
})

describe('getBaseCurrencyCode', () => {
  it('reads the settings row', async () => {
    const db = fakeDbSequence([[{ base_currency_code: 'USD' }]])
    expect(await getBaseCurrencyCode(db)).toBe('USD')
    expect(db.query.mock.calls[0][0]).toMatch(/from settings/i)
  })

  it('defaults to PEN when the row is missing', async () => {
    const db = fakeDbSequence([[]])
    expect(await getBaseCurrencyCode(db)).toBe('PEN')
  })
})
