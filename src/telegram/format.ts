function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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
    `<strong>${escapeHtml(view.description)}</strong>`,
    '',
    `<pre>ID: ${view.id}`,
    `Account: ${escapeHtml(view.accountName)}`,
    `Category: ${escapeHtml(view.categoryName)}`,
    `Tags: ${view.tags.map(escapeHtml).join(', ')}`,
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
    `<strong>${escapeHtml(view.description)}</strong>`,
    '',
    `<pre>ID: ${view.id}`,
    `Category: ${escapeHtml(view.categoryName)}`,
    `Tags: ${view.tags.map(escapeHtml).join(', ')}`,
    '</pre>',
  ].join('\n')
}

export function formatDeleted(): string {
  return 'Transaccion eliminada'
}

export function formatError(detail: string): string {
  return `Error creando la transaccion en SpendTracker:\n\n${detail}`
}
