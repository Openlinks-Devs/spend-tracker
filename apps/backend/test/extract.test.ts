import { describe, it, expect, vi } from 'vitest'

const generateObject = vi.fn()
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }))
vi.mock('../src/ai/provider.js', () => ({ getModel: () => 'mock-model' }))

import { extractTransaction } from '../src/ai/extract.js'

const refs = {
  categories: [{ id: 'c1', name: 'Food', type: 'expense' }],
  accounts: [{ id: 'a1', name: 'Debito BCP', type: 'DEBIT', currency: 'PEN' }],
  tags: ['food'],
  now: '2026-06-30T10:00:00.000Z',
}

describe('extractTransaction', () => {
  it('returns the parsed transaction', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'PLIN-MARISELA CALLE', amount: -35, currency: 'PEN',
        account_id: 'a1', category_id: 'c1', tags: ['food', 'plin', 'transfer'],
        payee: 'Marisela Calle', occurred_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'Consumo S/ 35.00', ...refs })
    expect(result?.account_id).toBe('a1')
    expect(result?.amount).toBe(-35)
    expect(result?.payee).toBe('Marisela Calle')
    expect(result?.occurred_at).toBe('2026-06-29T20:55:00.000Z')
  })

  it('returns null when account_id is missing', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'x', amount: -1, currency: 'PEN',
        account_id: null, category_id: 'c1', tags: ['a', 'b', 'c'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'something', ...refs })
    expect(result).toBeNull()
  })

  it('returns null when account_id is not a known account', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'x', amount: -1, currency: 'PEN',
        account_id: 'unknown', category_id: 'c1', tags: ['a', 'b', 'c'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'something', ...refs })
    expect(result).toBeNull()
  })

  it('returns null when category_id is not a known category', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'x', amount: -1, currency: 'PEN',
        account_id: 'a1', category_id: 'unknown-category', tags: ['a', 'b', 'c'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'something', ...refs })
    expect(result).toBeNull()
  })

  it('instructs the model to use ISO 4217 codes, payee, and occurred_at', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'x', amount: -1, currency: 'PEN',
        account_id: 'a1', category_id: 'c1', tags: ['a', 'b', 'c'],
        payee: null, occurred_at: '2026-06-29T20:55:00.000Z',
      },
    })
    await extractTransaction({ text: 'something', ...refs })
    const callOptions = generateObject.mock.calls[0][0] as { system: string }
    expect(callOptions.system).toMatch(/ISO 4217/)
    expect(callOptions.system).toMatch(/payee/)
    expect(callOptions.system).toMatch(/occurred_at/)
  })
})
