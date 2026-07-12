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

  describe('sort control', () => {
    it('emits sort=amount when Amount is picked', async () => {
      const user = userEvent.setup()
      const { onChange } = renderFilterBar({})
      await user.click(screen.getByRole('combobox', { name: 'Sort by' }))
      await user.click(screen.getByRole('option', { name: 'Amount' }))
      expect(onChange).toHaveBeenCalledWith({ sort: 'amount' })
    })

    it('emits order=asc when the direction toggle is flipped from the default', async () => {
      const user = userEvent.setup()
      const { onChange } = renderFilterBar({})
      await user.click(screen.getByRole('button', { name: 'Sort descending' }))
      expect(onChange).toHaveBeenCalledWith({ order: 'asc' })
    })

    it('removes the order key when toggled back from ascending', async () => {
      const user = userEvent.setup()
      const { onChange } = renderFilterBar({ order: 'asc' })
      await user.click(screen.getByRole('button', { name: 'Sort ascending' }))
      expect(onChange).toHaveBeenCalledWith({})
    })

    it('shows no sort chip for the default occurred_at desc sort', () => {
      renderFilterBar({})
      expect(screen.queryByText(/^Sort:/)).not.toBeInTheDocument()
    })

    it('shows a sort chip for a non-default sort and clears both keys on remove', async () => {
      const user = userEvent.setup()
      const { onChange } = renderFilterBar({ sort: 'amount', order: 'asc' })
      expect(screen.getByText('Sort: Amount, ascending')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Remove Sort: Amount, ascending' }))
      expect(onChange).toHaveBeenCalledWith({})
    })

    it('shows a sort chip when only the order differs from the default', () => {
      renderFilterBar({ order: 'asc' })
      expect(screen.getByText('Sort: Date, ascending')).toBeInTheDocument()
    })
  })
})
