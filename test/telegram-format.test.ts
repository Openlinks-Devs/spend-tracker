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

  it('escapes HTML special characters in dynamic fields', () => {
    const message = formatNewTransaction({
      id: 'tx2', description: 'AT&T <store>', accountName: 'Cuenta & Ahorro', categoryName: 'Food > Snacks',
      tags: ['a&b', 'c<d>'], currency: 'PEN', amount: -10, created_at: '2026-06-30T00:00:00.000Z',
    })
    expect(message).toContain('AT&amp;T &lt;store&gt;')
    expect(message).not.toContain('&T')
    expect(message).not.toContain('<store>')
    expect(message).toContain('Cuenta &amp; Ahorro')
    expect(message).toContain('Food &gt; Snacks')
    expect(message).toContain('a&amp;b')
    expect(message).toContain('c&lt;d&gt;')
  })
})
