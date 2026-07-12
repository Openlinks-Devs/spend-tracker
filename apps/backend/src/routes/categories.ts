import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import {
  categoryHasTransactions,
  deleteCategory,
  getCategories,
  getCategoryById,
  insertCategory,
  updateCategory,
} from '../db/queries.js'
import { isUuid, parseJsonBody } from './validation.js'

const newCategorySchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
})

const categoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
})

export function createCategoriesRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/categories', async (context) => {
    try {
      const categories = await getCategories(resolveDb())
      return context.json(categories)
    } catch (error) {
      console.error('Failed to list categories:', error)
      return context.json({ error: 'Failed to list categories' }, 500)
    }
  })

  route.get('/api/categories/:id', async (context) => {
    const id = context.req.param('id')
    if (!isUuid(id)) return context.json({ error: 'Invalid category id' }, 400)
    try {
      const category = await getCategoryById(resolveDb(), id)
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
      const db = resolveDb()
      const { id } = await insertCategory(db, parsed.data)
      const category = await getCategoryById(db, id)
      return context.json(category, 201)
    } catch (error) {
      console.error('Failed to create category:', error)
      return context.json({ error: 'Failed to create category' }, 500)
    }
  })

  route.patch('/api/categories/:id', async (context) => {
    const id = context.req.param('id')
    if (!isUuid(id)) return context.json({ error: 'Invalid category id' }, 400)
    const parsed = await parseJsonBody(context, categoryUpdateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const db = resolveDb()
      const existing = await getCategoryById(db, id)
      if (!existing) return context.json({ error: 'Category not found' }, 404)
      await updateCategory(db, {
        id,
        name: parsed.data.name ?? existing.name,
        type: parsed.data.type ?? existing.type,
      })
      const category = await getCategoryById(db, id)
      return context.json(category)
    } catch (error) {
      console.error('Failed to update category:', error)
      return context.json({ error: 'Failed to update category' }, 500)
    }
  })

  route.delete('/api/categories/:id', async (context) => {
    const id = context.req.param('id')
    if (!isUuid(id)) return context.json({ error: 'Invalid category id' }, 400)
    try {
      const db = resolveDb()
      const existing = await getCategoryById(db, id)
      if (!existing) return context.json({ error: 'Category not found' }, 404)
      if (await categoryHasTransactions(db, id)) {
        return context.json(
          { error: 'Category has transactions. Reassign or delete them first.' },
          409,
        )
      }
      await deleteCategory(db, id)
      return context.json({ success: true })
    } catch (error) {
      console.error('Failed to delete category:', error)
      return context.json({ error: 'Failed to delete category' }, 500)
    }
  })

  return route
}
