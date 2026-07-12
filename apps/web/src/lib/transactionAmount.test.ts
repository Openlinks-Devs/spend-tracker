import { describe, expect, it } from 'vitest'
import { formatTransactionAmount, formatTransferRoute } from '@/lib/transactionAmount'

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
