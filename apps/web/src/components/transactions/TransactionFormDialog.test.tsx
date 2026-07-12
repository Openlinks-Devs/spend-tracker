import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransactionFormDialog } from '@/components/transactions/TransactionFormDialog'
import { stubApiFetch } from '@/test/apiStub'
import { renderWithClient } from '@/test/render'
import type { Account, Category } from '@/types'

const accounts: Account[] = [
  { id: 'acc-pen', name: 'Cash', type: 'cash', currency: 'PEN' },
  { id: 'acc-usd', name: 'BCP USD', type: 'checking', currency: 'USD' },
]

const categories: Category[] = [
  { id: 'cat-food', name: 'Food', type: 'expense' },
  { id: 'cat-salary', name: 'Salary', type: 'income' },
]

function stubReferenceData() {
  return stubApiFetch([
    {
      match: '/currencies',
      data: [
        { code: 'PEN', name: 'Sol', symbol: 'S/', decimal_places: 2 },
        { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 },
      ],
    },
    { match: '/settings', data: { id: 1, base_currency_code: 'PEN' } },
  ])
}

function renderDialog(overrides: Partial<Parameters<typeof TransactionFormDialog>[0]> = {}) {
  const onCreate = vi.fn()
  const onUpdate = vi.fn()
  renderWithClient(
    <TransactionFormDialog
      open
      onOpenChange={() => {}}
      accounts={accounts}
      categories={categories}
      existingPayees={['Uber', 'Wong']}
      payeeCategoryHistory={{}}
      transaction={null}
      isSubmitting={false}
      errorMessage={null}
      onCreate={onCreate}
      onUpdate={onUpdate}
      {...overrides}
    />,
  )
  return { onCreate, onUpdate }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TransactionFormDialog', () => {
  it('carries the sign in the type and swaps category for a destination account', async () => {
    const user = userEvent.setup()
    stubReferenceData()
    const { onCreate } = renderDialog()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('PEN'),
    )
    await user.type(screen.getByLabelText('Description'), 'Lunch')
    await user.type(screen.getByLabelText('Amount'), '12.5')
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      type: 'expense',
      amount: 12.5,
      category_id: 'cat-food',
    })

    await user.click(screen.getByRole('button', { name: 'Income' }))
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))
    expect(onCreate.mock.calls[1][0]).toMatchObject({
      type: 'income',
      amount: 12.5,
      category_id: 'cat-salary',
    })

    await user.click(screen.getByRole('button', { name: 'Transfer' }))
    expect(screen.queryByRole('combobox', { name: 'Category' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Destination account' })).toBeInTheDocument()
  })

  it('follows the selected account currency', async () => {
    const user = userEvent.setup()
    stubReferenceData()
    renderDialog()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('PEN'),
    )
    await user.click(screen.getByRole('combobox', { name: 'Account' }))
    await user.click(await screen.findByRole('option', { name: 'BCP USD' }))

    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('USD')
  })

  it('requires a destination account and amount for transfers', async () => {
    const user = userEvent.setup()
    stubReferenceData()
    const { onCreate } = renderDialog()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('PEN'),
    )
    await user.type(screen.getByLabelText('Description'), 'Move money')
    await user.type(screen.getByLabelText('Amount'), '100')
    await user.click(screen.getByRole('button', { name: 'Transfer' }))

    const submit = screen.getByRole('button', { name: 'Create transaction' })
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: 'Destination account' }))
    await user.click(await screen.findByRole('option', { name: 'BCP USD' }))
    const destinationAmount = screen.getByLabelText('Destination amount')
    await user.clear(destinationAmount)
    await user.type(destinationAmount, '26.7')

    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      type: 'transfer',
      amount: 100,
      to_account_id: 'acc-usd',
      to_amount: 26.7,
      category_id: null,
    })
    const [payload] = onCreate.mock.calls[0]
    expect(within(document.body).queryByText('Category')).toBeNull()
    expect(payload.account_id).toBe('acc-pen')
  })

  it('pre-fills the last category used for a known payee', async () => {
    const user = userEvent.setup()
    stubReferenceData()
    const { onCreate } = renderDialog({ payeeCategoryHistory: { Wong: 'cat-food' } })

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveTextContent('PEN'),
    )
    await user.type(screen.getByLabelText('Payee'), 'Wong')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Food')

    await user.type(screen.getByLabelText('Description'), 'Groceries')
    await user.type(screen.getByLabelText('Amount'), '25')
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))

    expect(onCreate.mock.calls[0][0]).toMatchObject({ payee: 'Wong', category_id: 'cat-food' })
  })
})
