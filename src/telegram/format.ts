export interface NewTransactionView {
  id: string
  description: string
  accountName: string
  categoryName: string
  tags: string[]
  currency: string
  amount: number
  created_at: string
}

export function formatNewTransaction(view: NewTransactionView): string {
  return [
    'Nueva transaccion creada en SpendTracker:',
    '',
    `<strong>${view.description}</strong>`,
    '',
    `<pre>ID: ${view.id}`,
    `Account: ${view.accountName}`,
    `Category: ${view.categoryName}`,
    `Tags: ${view.tags.join(', ')}`,
    '</pre>',
    `Amount: ${view.currency} ${view.amount}`,
    '',
    `Fecha/hora: <code>${view.created_at}</code>`,
  ].join('\n')
}

export interface UpdatedTransactionView {
  id: string
  description: string
  categoryName: string
  tags: string[]
}

export function formatUpdatedTransaction(view: UpdatedTransactionView): string {
  return [
    'Transaccion actualizada:',
    `<strong>${view.description}</strong>`,
    '',
    `<pre>ID: ${view.id}`,
    `Category: ${view.categoryName}`,
    `Tags: ${view.tags.join(', ')}`,
    '</pre>',
  ].join('\n')
}

export function formatDeleted(): string {
  return 'Transaccion eliminada'
}

export function formatError(detail: string): string {
  return `Error creando la transaccion en SpendTracker:\n\n${detail}`
}
