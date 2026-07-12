import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar } from '@/components/transactions/FilterBar'
import type { Account, Category, Currency, TransactionFilters } from '@/types'

const accounts: Account[] = [
  { id: 'acc-pen', name: 'Cash', type: 'cash', currency: 'PEN' },
  { id: 'acc-usd', name: 'BCP USD', type: 'checking', currency: 'USD' },
]
const categories: Category[] = [{ id: 'cat-food', name: 'Food', type: 'expense' }]
const currencies: Currency[] = [
  { code: 'PEN', name: 'Sol', symbol: 'S/', decimal_places: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 },
]

function renderFilterBar(filters: TransactionFilters) {
  const onChange = vi.fn()
  render(
    <FilterBar
      filters={filters}
      onChange={onChange}
      accounts={accounts}
      categories={categories}
      currencies={currencies}
    />,
  )
  return { onChange }
}

describe('FilterBar', () => {
  it('renders a chip for each active filter', () => {
    renderFilterBar({ type: 'expense', search: 'coffee', accountIds: ['acc-pen'] })
    expect(screen.getByText('Type: expense')).toBeInTheDocument()
    expect(screen.getByText('Search: coffee')).toBeInTheDocument()
    expect(screen.getByText('1 account')).toBeInTheDocument()
  })

  it('removes a single filter when its chip x is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderFilterBar({ type: 'expense', search: 'coffee' })
    await user.click(screen.getByRole('button', { name: 'Remove Type: expense' }))
    expect(onChange).toHaveBeenCalledWith({ search: 'coffee' })
  })

  it('clears every filter with Clear all', async () => {
    const user = userEvent.setup()
    const { onChange } = renderFilterBar({ type: 'expense', search: 'coffee' })
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onChange).toHaveBeenCalledWith({})
  })
})
