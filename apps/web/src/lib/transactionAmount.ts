import { formatCurrency } from '@/lib/utils'

// Native amount, with the frozen base-currency conversion in parentheses for
// foreign-currency rows: "USD 20.00 (PEN 74.80)".
export function formatTransactionAmount(
  amount: number,
  currency: string,
  baseAmount: number | null,
  baseCurrencyCode: string,
): string {
  const primary = formatCurrency(Math.abs(amount), currency)
  if (currency === baseCurrencyCode || baseAmount === null) return primary
  return `${primary} (${formatCurrency(Math.abs(baseAmount), baseCurrencyCode)})`
}

export function formatTransferRoute(fromAccountName: string, toAccountName: string): string {
  return `${fromAccountName} -> ${toAccountName}`
}

// Transfer rows show only the source leg unless the destination account's
// currency differs, in which case both legs are shown: "PEN 100.00 -> USD
// 26.70". This covers cross-currency transfers where the destination amount
// (to_amount) was converted at a different rate than the base-currency
// conversion.
export function formatTransferAmount(
  amount: number,
  currency: string,
  toAmount: number | null,
  toAccountCurrency: string | null,
): string {
  const sourceLabel = formatCurrency(Math.abs(amount), currency)
  if (toAccountCurrency === null || toAmount === null || toAccountCurrency === currency) {
    return sourceLabel
  }
  return `${sourceLabel} -> ${formatCurrency(Math.abs(toAmount), toAccountCurrency)}`
}
