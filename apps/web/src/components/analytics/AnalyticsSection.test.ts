import { describe, expect, it } from 'vitest'
import { mostUsedCurrency, resolveDisplayCurrency } from '@/components/analytics/AnalyticsSection'
import type { SummaryRow } from '@/types'

function makeSummaryRow(overrides: Partial<SummaryRow> & { currency: string }): SummaryRow {
  return { income: 0, spend: 0, net: 0, count: 0, ...overrides }
}

describe('mostUsedCurrency', () => {
  it('falls back to USD when the summary is empty', () => {
    expect(mostUsedCurrency([])).toBe('USD')
  })

  it('returns the only currency for a single-row summary', () => {
    expect(mostUsedCurrency([makeSummaryRow({ currency: 'PEN', count: 3 })])).toBe('PEN')
  })

  it('picks the currency with the highest transaction count', () => {
    const summary = [
      makeSummaryRow({ currency: 'USD', count: 2 }),
      makeSummaryRow({ currency: 'PEN', count: 9 }),
      makeSummaryRow({ currency: 'EUR', count: 5 }),
    ]
    expect(mostUsedCurrency(summary)).toBe('PEN')
  })
})

describe('resolveDisplayCurrency', () => {
  const summary = [
    makeSummaryRow({ currency: 'USD', count: 2 }),
    makeSummaryRow({ currency: 'PEN', count: 9 }),
  ]

  it('respects a preference present in the summary', () => {
    expect(resolveDisplayCurrency('USD', summary)).toBe('USD')
  })

  it('falls back to the highest-count currency when the preference is absent', () => {
    expect(resolveDisplayCurrency('EUR', summary)).toBe('PEN')
  })

  it('falls back to the highest-count currency when no preference is set', () => {
    expect(resolveDisplayCurrency(undefined, summary)).toBe('PEN')
  })

  it('falls back to USD for an empty summary', () => {
    expect(resolveDisplayCurrency('EUR', [])).toBe('USD')
  })
})
