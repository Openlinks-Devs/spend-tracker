import { describe, it, expect, vi } from 'vitest'

const generateObject = vi.fn()
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }))
vi.mock('../src/ai/provider.js', () => ({ getModel: () => 'mock-model' }))

import { extractTransaction, extractSchema } from '../src/ai/extract.js'

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
        created_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'Consumo S/ 35.00', ...refs })
    expect(result?.account_id).toBe('a1')
    expect(result?.amount).toBe(-35)
  })

  it('returns null when account_id is missing', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'x', amount: -1, currency: 'PEN',
        account_id: null, category_id: 'c1', tags: ['a', 'b', 'c'],
        created_at: '2026-06-29T20:55:00.000Z',
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
        created_at: '2026-06-29T20:55:00.000Z',
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
        created_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'something', ...refs })
    expect(result).toBeNull()
  })

  it('returns null when the model answers null for the amount', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: 'Correo sin monto', amount: null, currency: 'PEN',
        account_id: 'a1', category_id: 'c1', tags: ['a', 'b', 'c'],
        created_at: '2026-06-29T20:55:00.000Z',
      },
    })
    const result = await extractTransaction({ text: 'something', ...refs })
    expect(result).toBeNull()
  })

  it('returns null when the model answers null for every field of an empty email', async () => {
    generateObject.mockResolvedValue({
      object: {
        description: null, amount: null, currency: null,
        account_id: null, category_id: null, tags: ['consumo', 'servicio', 'mas'],
        created_at: null,
      },
    })
    const result = await extractTransaction({ text: '', ...refs })
    expect(result).toBeNull()
  })

  it('accepts the schema the model is told to produce for an empty email', async () => {
    // The prompt tells the model to answer null when a field cannot be filled,
    // so the schema must accept exactly that shape. Parsing it here is what
    // catches the contradiction that used to throw NoObjectGeneratedError in
    // production.
    expect(() =>
      extractSchema.parse({
        description: null, amount: null, currency: null,
        account_id: null, category_id: null, tags: ['consumo', 'servicio', 'mas'],
        created_at: null,
      }),
    ).not.toThrow()
  })
})
