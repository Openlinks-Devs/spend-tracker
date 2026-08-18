import { describe, it, expect } from 'vitest'
import {
  buildCategoryTree,
  categoryLabel,
  collectDescendantIds,
  flattenCategoryTree,
} from './categoryTree'
import type { Category } from '@/types'

function category(id: string, name: string, parentId: string | null = null): Category {
  return { id, name, type: 'out', parent_id: parentId, emoji: null }
}

describe('buildCategoryTree', () => {
  it('nests children under their parent, alphabetically at each level', () => {
    const roots = buildCategoryTree([
      category('transport', 'Transporte'),
      category('taxi', 'Taxi', 'transport'),
      category('bus', 'Bus', 'transport'),
      category('home', 'Hogar'),
    ])
    expect(roots.map((node) => node.category.name)).toEqual(['Hogar', 'Transporte'])
    expect(roots[1].children.map((node) => node.category.name)).toEqual(['Bus', 'Taxi'])
  })

  it('nests to any depth', () => {
    const flat = flattenCategoryTree([
      category('a', 'A'),
      category('b', 'B', 'a'),
      category('c', 'C', 'b'),
    ])
    expect(flat.map((entry) => [entry.category.name, entry.depth])).toEqual([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ])
  })

  it('promotes a child whose parent is missing to a root', () => {
    const roots = buildCategoryTree([category('orphan', 'Orphan', 'gone')])
    expect(roots.map((node) => node.category.name)).toEqual(['Orphan'])
  })

  it('keeps every category when the parent links form a cycle', () => {
    const flat = flattenCategoryTree([category('a', 'A', 'b'), category('b', 'B', 'a')])
    expect(flat).toHaveLength(2)
  })
})

describe('collectDescendantIds', () => {
  it('returns the category and everything below it', () => {
    const categories = [
      category('a', 'A'),
      category('b', 'B', 'a'),
      category('c', 'C', 'b'),
      category('d', 'D'),
    ]
    expect([...collectDescendantIds(categories, 'a')].sort()).toEqual(['a', 'b', 'c'])
    expect([...collectDescendantIds(categories, 'd')]).toEqual(['d'])
  })
})

describe('categoryLabel', () => {
  it('prefixes the emoji when there is one', () => {
    expect(categoryLabel({ ...category('t', 'Taxi'), emoji: '🚕' })).toBe('🚕 Taxi')
    expect(categoryLabel(category('t', 'Taxi'))).toBe('Taxi')
  })
})
