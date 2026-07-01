import { describe, it, expect, vi } from 'vitest'

const generateObject = vi.fn()
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }))
vi.mock('../src/ai/provider.js', () => ({ getModel: () => 'mock-model' }))

import { classifyEdit } from '../src/ai/classify.js'

describe('classifyEdit', () => {
  it('returns the best category and tags', async () => {
    generateObject.mockResolvedValue({ object: { category_id: 'c2', tags: ['transport', 'taxi'] } })
    const result = await classifyEdit({
      description: 'Taxi a casa',
      categories: [{ id: 'c2', name: 'Transport', type: 'expense' }],
      tags: ['transport'],
    })
    expect(result.category_id).toBe('c2')
    expect(result.tags).toContain('taxi')
  })
})
