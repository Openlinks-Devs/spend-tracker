import { describe, it, expect, vi } from 'vitest'

const generateObject = vi.fn()
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }))
vi.mock('../src/ai/provider.js', () => ({ getModel: () => 'mock-model' }))

import { detectTransaction } from '../src/ai/detect.js'

describe('detectTransaction', () => {
  it('returns true when the model flags a transaction', async () => {
    generateObject.mockResolvedValue({ object: { is_transaction_email: true } })
    const result = await detectTransaction({ subject: 'Consumo BCP', text: 'S/ 35.00' })
    expect(result).toBe(true)
  })

  it('returns false for promotional mail', async () => {
    generateObject.mockResolvedValue({ object: { is_transaction_email: false } })
    const result = await detectTransaction({ subject: 'Oferta', text: 'descuento' })
    expect(result).toBe(false)
  })
})
