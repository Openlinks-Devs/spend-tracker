import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { wouldCreateCycle } from '../db/categoryTree.js'
import {
  deleteCategory,
  getCategories,
  getCategoryById,
  insertCategory,
  updateCategory,
} from '../db/queries.js'
import type { AppVariables } from '../http/context.js'
import { getUserId } from '../http/context.js'
import { parseJsonBody } from './validation.js'

const newCategorySchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  parent_id: z.string().min(1).nullable().optional(),
  emoji: z.string().min(1).nullable().optional(),
})

const categoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  parent_id: z.string().min(1).nullable().optional(),
  emoji: z.string().min(1).nullable().optional(),
})

/**
 * A parent has to be one of the caller's own categories, and cannot be the
 * category itself or anything below it. Returns the message to answer with, or
 * null when the parent is usable. categoryId is undefined on create, where
 * there is no row yet to close a cycle through.
 */
async function findParentError(
  db: Queryable,
  userId: string,
  parentId: string,
  categoryId?: string,
): Promise<string | null> {
  const parent = await getCategoryById(db, userId, parentId)
  if (!parent) return 'Parent category not found'
  if (!categoryId) return null
  const categories = await getCategories(db, userId)
  if (wouldCreateCycle(categories, categoryId, parentId)) {
    return 'A category cannot be nested under itself'
  }
  return null
}

export function createCategoriesRoute(
  resolveDb: () => Queryable = getPool,
): Hono<{ Variables: AppVariables }> {
  const route = new Hono<{ Variables: AppVariables }>()

  route.get('/api/categories', async (context) => {
    try {
      const userId = getUserId(context)
      const categories = await getCategories(resolveDb(), userId)
      return context.json(categories)
    } catch (error) {
      console.error('Failed to list categories:', error)
      return context.json({ error: 'Failed to list categories' }, 500)
    }
  })

  route.get('/api/categories/:id', async (context) => {
    try {
      const userId = getUserId(context)
      const category = await getCategoryById(resolveDb(), userId, context.req.param('id'))
      if (!category) return context.json({ error: 'Category not found' }, 404)
      return context.json(category)
    } catch (error) {
      console.error('Failed to fetch category:', error)
      return context.json({ error: 'Failed to fetch category' }, 500)
    }
  })

  route.post('/api/categories', async (context) => {
    const parsed = await parseJsonBody(context, newCategorySchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const userId = getUserId(context)
      const db = resolveDb()
      if (parsed.data.parent_id) {
        const parentError = await findParentError(db, userId, parsed.data.parent_id)
        if (parentError) return context.json({ error: parentError }, 400)
      }
      const { id } = await insertCategory(db, userId, parsed.data)
      const category = await getCategoryById(db, userId, id)
      return context.json(category, 201)
    } catch (error) {
      console.error('Failed to create category:', error)
      return context.json({ error: 'Failed to create category' }, 500)
    }
  })

  route.patch('/api/categories/:id', async (context) => {
    const id = context.req.param('id')
    const parsed = await parseJsonBody(context, categoryUpdateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const userId = getUserId(context)
      const db = resolveDb()
      const existing = await getCategoryById(db, userId, id)
      if (!existing) return context.json({ error: 'Category not found' }, 404)
      // undefined means "leave as is", null means "make this a root", so the
      // two cannot collapse into one nullish fallback.
      const parentId =
        parsed.data.parent_id === undefined ? existing.parent_id : parsed.data.parent_id
      if (parentId) {
        const parentError = await findParentError(db, userId, parentId, id)
        if (parentError) return context.json({ error: parentError }, 400)
      }
      await updateCategory(db, userId, {
        id,
        name: parsed.data.name ?? existing.name,
        type: parsed.data.type ?? existing.type,
        parent_id: parentId,
        emoji: parsed.data.emoji === undefined ? existing.emoji : parsed.data.emoji,
      })
      const category = await getCategoryById(db, userId, id)
      return context.json(category)
    } catch (error) {
      console.error('Failed to update category:', error)
      return context.json({ error: 'Failed to update category' }, 500)
    }
  })

  route.delete('/api/categories/:id', async (context) => {
    const id = context.req.param('id')
    try {
      const userId = getUserId(context)
      const db = resolveDb()
      const existing = await getCategoryById(db, userId, id)
      if (!existing) return context.json({ error: 'Category not found' }, 404)
      await deleteCategory(db, userId, id)
      return context.json({ success: true })
    } catch (error) {
      console.error('Failed to delete category:', error)
      return context.json({ error: 'Failed to delete category' }, 500)
    }
  })

  return route
}
