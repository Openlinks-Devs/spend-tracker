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
    'New transaction created in SpendTracker:',
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
    `Date/time: <code>${view.created_at}</code>`,
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
    'Transaction updated:',
    `<strong>${escapeHtml(view.description)}</strong>`,
    '',
    `<pre>ID: ${view.id}`,
    `Category: ${escapeHtml(view.categoryName)}`,
    `Tags: ${view.tags.map(escapeHtml).join(', ')}`,
    '</pre>',
  ].join('\n')
}

export function formatDeleted(): string {
  return 'Transaction deleted'
}

export function formatError(detail: string): string {
  return `Could not create the transaction in SpendTracker:\n\n${detail}`
}

export interface ImportFailuresView {
  // The first failure of the cycle, which stands in for the rest. Both fields
  // are null when the message could not be parsed at all.
  sender: string | null
  subject: string | null
  count: number
  inboxUrl: string
}

export function formatImportFailures(view: ImportFailuresView): string {
  const noun = view.count === 1 ? 'email' : 'emails'
  return [
    `SpendTracker could not process ${view.count} ${noun} from your inbox.`,
    '',
    `<strong>${escapeHtml(view.sender ?? 'Unknown sender')}</strong>`,
    escapeHtml(view.subject ?? 'No subject'),
    '',
    `See what happened: ${view.inboxUrl}`,
  ].join('\n')
}

export interface GmailConnectionLostView {
  email: string
  integrationsUrl: string
}

export function formatGmailConnectionLost(view: GmailConnectionLostView): string {
  return [
    'SpendTracker lost access to a Gmail account:',
    '',
    `<strong>${escapeHtml(view.email)}</strong>`,
    '',
    'Transactions from that account will not be imported until you reconnect it.',
    '',
    `Reconnect: ${view.integrationsUrl}`,
  ].join('\n')
}
