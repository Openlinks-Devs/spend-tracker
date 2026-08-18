import type { Category } from '@/types'

export interface CategoryTreeNode {
  category: Category
  children: CategoryTreeNode[]
}

/** A tree node flattened for a list or a picker, carrying how deep it sits. */
export interface FlatCategory {
  category: Category
  depth: number
}

function byName(first: CategoryTreeNode, second: CategoryTreeNode): number {
  return first.category.name.localeCompare(second.category.name)
}

/**
 * Groups categories into parent/child trees, alphabetical at every level.
 *
 * Two defensive cases, both of which the API can hand us: a child whose parent
 * is missing (deleted, or scoped away) is promoted to a root rather than
 * dropped, and a parent chain that loops is broken by treating the offending
 * category as a root. A picker that hangs is worse than one that shows a
 * category at the wrong level.
 */
export function buildCategoryTree(categories: Category[]): CategoryTreeNode[] {
  const nodeById = new Map<string, CategoryTreeNode>(
    categories.map((category) => [category.id, { category, children: [] }]),
  )

  function hasReachableRoot(category: Category): boolean {
    const visited = new Set<string>([category.id])
    let ancestorId = category.parent_id
    while (ancestorId) {
      if (visited.has(ancestorId)) return false
      visited.add(ancestorId)
      ancestorId = nodeById.get(ancestorId)?.category.parent_id ?? null
    }
    return true
  }

  const roots: CategoryTreeNode[] = []
  for (const category of categories) {
    const node = nodeById.get(category.id)
    if (!node) continue
    const parent = category.parent_id ? nodeById.get(category.parent_id) : undefined
    if (parent && parent !== node && hasReachableRoot(category)) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  for (const node of nodeById.values()) node.children.sort(byName)
  return roots.sort(byName)
}

/** Depth-first walk of the tree, so a list can indent by `depth`. */
export function flattenCategoryTree(categories: Category[]): FlatCategory[] {
  const flattened: FlatCategory[] = []
  function visit(nodes: CategoryTreeNode[], depth: number) {
    for (const node of nodes) {
      flattened.push({ category: node.category, depth })
      visit(node.children, depth + 1)
    }
  }
  visit(buildCategoryTree(categories), 0)
  return flattened
}

/**
 * The category and everything below it. Used to keep the parent picker from
 * offering a category one of its own descendants, which would make a cycle.
 */
export function collectDescendantIds(categories: Category[], categoryId: string): Set<string> {
  const childrenByParentId = new Map<string, Category[]>()
  for (const category of categories) {
    if (!category.parent_id) continue
    const siblings = childrenByParentId.get(category.parent_id) ?? []
    siblings.push(category)
    childrenByParentId.set(category.parent_id, siblings)
  }
  const collected = new Set<string>([categoryId])
  const queue = [categoryId]
  while (queue.length > 0) {
    const currentId = queue.shift() as string
    for (const child of childrenByParentId.get(currentId) ?? []) {
      if (collected.has(child.id)) continue
      collected.add(child.id)
      queue.push(child.id)
    }
  }
  return collected
}

/** Display name with the category's emoji in front, when it has one. */
export function categoryLabel(category: Category): string {
  return category.emoji ? `${category.emoji} ${category.name}` : category.name
}
