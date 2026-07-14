import { Hono } from 'hono'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import { createTransfer, type TransactionalPool } from '../db/queries.js'
import { parseJsonBody } from './validation.js'

// A transfer moves money between two accounts. The client sends both legs fully
// resolved (amounts as positive numbers, currencies and categories per account);
// the server signs them - money leaves the source (negative) and lands in the
// destination (positive) - and inserts both atomically.
const transferSchema = z.object({
  from_account_id: z.string().min(1),
  to_account_id: z.string().min(1),
  from_amount: z.number().positive(),
  to_amount: z.number().positive(),
  from_currency: z.string().min(1),
  to_currency: z.string().min(1),
  from_category_id: z.string().min(1),
  to_category_id: z.string().min(1),
  from_description: z.string().min(1),
  to_description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  created_at: z.string().min(1).optional(),
})

export function createTransfersRoute(resolvePool: () => TransactionalPool = getPool): Hono {
  const route = new Hono()

  route.post('/api/transfers', async (context) => {
    const parsed = await parseJsonBody(context, transferSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    const data = parsed.data
    const createdAt = data.created_at ?? new Date().toISOString()
    try {
      const result = await createTransfer(resolvePool(), {
        from: {
          description: data.from_description,
          amount: -Math.abs(data.from_amount),
          currency: data.from_currency,
          account_id: data.from_account_id,
          category_id: data.from_category_id,
          tags: data.tags,
          created_at: createdAt,
        },
        to: {
          description: data.to_description,
          amount: Math.abs(data.to_amount),
          currency: data.to_currency,
          account_id: data.to_account_id,
          category_id: data.to_category_id,
          tags: data.tags,
          created_at: createdAt,
        },
      })
      return context.json(result, 201)
    } catch (error) {
      console.error('Failed to create transfer:', error)
      return context.json({ error: 'Failed to create transfer' }, 500)
    }
  })

  return route
}
