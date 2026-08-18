import { describe, it, expect } from 'vitest'
import { wouldCreateCycle } from '../src/db/categoryTree.js'
import type { Category } from '../src/db/types.js'

function category(id: string, parentId: string | null): Category {
  return { id, name: id, type: 'out', parent_id: parentId, emoji: null }
}

describe('wouldCreateCycle', () => {
  const categories = [
    category('root', null),
    category('child', 'root'),
    category('grandchild', 'child'),
    category('unrelated', null),
  ]

  it('rejects a category as its own parent', () => {
    expect(wouldCreateCycle(categories, 'root', 'root')).toBe(true)
  })

  it('rejects a direct child as parent', () => {
    expect(wouldCreateCycle(categories, 'root', 'child')).toBe(true)
  })

  it('rejects a deeper descendant as parent', () => {
    expect(wouldCreateCycle(categories, 'root', 'grandchild')).toBe(true)
  })

  it('allows an unrelated category as parent', () => {
    expect(wouldCreateCycle(categories, 'child', 'unrelated')).toBe(false)
  })

  it('terminates on rows that already form a cycle', () => {
    const looped = [category('a', 'b'), category('b', 'a'), category('c', null)]
    expect(wouldCreateCycle(looped, 'c', 'a')).toBe(false)
  })
})
