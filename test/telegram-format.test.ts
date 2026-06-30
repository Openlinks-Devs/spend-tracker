import { describe, it, expect } from 'vitest'
import { formatNewTransaction, formatDeleted } from '../src/telegram/format.js'

describe('telegram format', () => {
  it('includes the id and amount in a new-transaction message', () => {
    const message = formatNewTransaction({
      id: 'tx1', description: 'PLIN', accountName: 'Debito BCP', categoryName: 'Food',
      tags: ['food', 'plin'], currency: 'PEN', amount: -35, created_at: '2026-06-29T20:55:00.000Z',
    })
    expect(message).toContain('ID: tx1')
    expect(message).toContain('PEN')
    expect(message).toContain('-35')
  })

  it('formats a delete confirmation', () => {
    expect(formatDeleted()).toContain('eliminada')
  })
})
