import { describe, expect, it } from 'vitest'
import {
  formatTransactionAmount,
  formatTransferAmount,
  formatTransferRoute,
} from '@/lib/transactionAmount'

// This environment's ICU build renders PEN with a non-breaking space
// (U+00A0) between the code and the amount, and renders USD with the "$"
// symbol rather than the "USD" code. Per the brief, the expectations below
// are adjusted to the observed output rather than changing the helper.
describe('formatTransactionAmount', () => {
  it('shows only the native amount when the currency is the base currency', () => {
    expect(formatTransactionAmount(-10, 'PEN', -10, 'PEN')).toBe('PEN 10.00')
  })

  it('appends the converted base amount for foreign-currency rows', () => {
    expect(formatTransactionAmount(-20, 'USD', -74.8, 'PEN')).toBe('$20.00 (PEN 74.80)')
  })

  it('omits the conversion when the base amount is missing', () => {
    expect(formatTransactionAmount(-20, 'USD', null, 'PEN')).toBe('$20.00')
  })
})

describe('formatTransferRoute', () => {
  it('renders both legs with an arrow', () => {
    expect(formatTransferRoute('Cash', 'BCP USD')).toBe('Cash -> BCP USD')
  })
})

describe('formatTransferAmount', () => {
  it('shows both legs with an arrow when the destination currency differs', () => {
    // Send PEN 100 from Cash, receive USD 26.70 in BCP USD.
    expect(formatTransferAmount(-100, 'PEN', 26.7, 'USD')).toBe('PEN 100.00 -> $26.70')
  })

  it('shows only the source amount when both legs share the same currency', () => {
    expect(formatTransferAmount(-50, 'PEN', 50, 'PEN')).toBe('PEN 50.00')
  })

  it('shows only the source amount when the destination currency is unknown', () => {
    expect(formatTransferAmount(-50, 'PEN', null, null)).toBe('PEN 50.00')
  })
})
