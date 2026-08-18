import type { Category } from './types.js'

/**
 * Why a category cannot point at itself or at one of its own descendants: the
 * clients walk parent links to render the tree, and a cycle makes that walk
 * never terminate. The check runs on write so no such row can exist, and the
 * walk below is still visited-guarded in case one already does.
 */
export function wouldCreateCycle(
  categories: Category[],
  categoryId: string,
  parentId: string,
): boolean {
  if (categoryId === parentId) return true
  const parentById = new Map(categories.map((category) => [category.id, category.parent_id]))
  const visited = new Set<string>()
  let ancestorId: string | null | undefined = parentId
  while (ancestorId) {
    if (ancestorId === categoryId) return true
    if (visited.has(ancestorId)) return false
    visited.add(ancestorId)
    ancestorId = parentById.get(ancestorId)
  }
  return false
}
