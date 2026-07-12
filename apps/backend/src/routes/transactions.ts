import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import {
  deleteTransaction,
  getTransactionById,
  getTransactions,
  insertTransaction,
  updateTransaction,
} from '../db/queries.js'
import { parseJsonBody } from './validation.js'

const newTransactionSchema = z.object({
  description: z.string().min(1),
  amount: z.number(),
  currency: z.string().min(1),
  account_id: z.string().min(1),
  category_id: z.string().min(1),
  tags: z.array(z.string()).default([]),
  created_at: z.string().min(1).optional(),
})

const transactionUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  amount: z.number().optional(),
  currency: z.string().min(1).optional(),
  account_id: z.string().min(1).optional(),
  category_id: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  created_at: z.string().min(1).optional(),
})

export function createTransactionsRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/transactions', async (context) => {
    try {
      const transactions = await getTransactions(resolveDb())
      return context.json(transactions)
    } catch (error) {
      console.error('Failed to list transactions:', error)
      return context.json({ error: 'Failed to list transactions' }, 500)
    }
  })

  route.get('/api/transactions/:id', async (context) => {
    try {
      const transaction = await getTransactionById(resolveDb(), context.req.param('id'))
      if (!transaction) return context.json({ error: 'Transaction not found' }, 404)
      return context.json(transaction)
    } catch (error) {
      console.error('Failed to fetch transaction:', error)
      return context.json({ error: 'Failed to fetch transaction' }, 500)
    }
  })

  route.post('/api/transactions', async (context) => {
    const parsed = await parseJsonBody(context, newTransactionSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const db = resolveDb()
      const { id } = await insertTransaction(db, {
        description: parsed.data.description,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        account_id: parsed.data.account_id,
        category_id: parsed.data.category_id,
        tags: parsed.data.tags,
        created_at: parsed.data.created_at ?? new Date().toISOString(),
      })
      const transaction = await getTransactionById(db, id)
      return context.json(transaction, 201)
    } catch (error) {
      console.error('Failed to create transaction:', error)
      return context.json({ error: 'Failed to create transaction' }, 500)
    }
  })

  route.patch('/api/transactions/:id', async (context) => {
    const id = context.req.param('id')
    const parsed = await parseJsonBody(context, transactionUpdateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const db = resolveDb()
      const existing = await getTransactionById(db, id)
      if (!existing) return context.json({ error: 'Transaction not found' }, 404)
      // category_id is nullable on Transaction as of the multicurrency migration
      // (transfers have no category), but this legacy route only ever creates
      // expense/income rows, so a null category here means the existing record
      // is a transfer this endpoint does not know how to edit yet.
      const categoryId = parsed.data.category_id ?? existing.category_id
      if (categoryId === null) {
        return context.json(
          { error: 'This transaction has no category to preserve; provide category_id' },
          400,
        )
      }
      await updateTransaction(db, {
        id,
        description: parsed.data.description ?? existing.description,
        amount: parsed.data.amount ?? existing.amount,
        currency: parsed.data.currency ?? existing.currency,
        account_id: parsed.data.account_id ?? existing.account_id,
        category_id: categoryId,
        tags: parsed.data.tags ?? existing.tags,
        created_at: parsed.data.created_at ?? existing.created_at,
      })
      const transaction = await getTransactionById(db, id)
      return context.json(transaction)
    } catch (error) {
      console.error('Failed to update transaction:', error)
      return context.json({ error: 'Failed to update transaction' }, 500)
    }
  })

  route.delete('/api/transactions/:id', async (context) => {
    const id = context.req.param('id')
    try {
      const db = resolveDb()
      const existing = await getTransactionById(db, id)
      if (!existing) return context.json({ error: 'Transaction not found' }, 404)
      await deleteTransaction(db, id)
      return context.json({ success: true })
    } catch (error) {
      console.error('Failed to delete transaction:', error)
      return context.json({ error: 'Failed to delete transaction' }, 500)
    }
  })

  return route
}
