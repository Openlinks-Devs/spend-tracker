import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import {
  deleteAccount,
  getAccountById,
  getAccounts,
  insertAccount,
  updateAccount,
} from '../db/queries.js'
import { parseJsonBody } from './validation.js'

const newAccountSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  currency: z.string().min(1),
})

const accountUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
})

export function createAccountsRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/accounts', async (context) => {
    try {
      const accounts = await getAccounts(resolveDb())
      return context.json(accounts)
    } catch (error) {
      console.error('Failed to list accounts:', error)
      return context.json({ error: 'Failed to list accounts' }, 500)
    }
  })

  route.get('/api/accounts/:id', async (context) => {
    try {
      const account = await getAccountById(resolveDb(), context.req.param('id'))
      if (!account) return context.json({ error: 'Account not found' }, 404)
      return context.json(account)
    } catch (error) {
      console.error('Failed to fetch account:', error)
      return context.json({ error: 'Failed to fetch account' }, 500)
    }
  })

  route.post('/api/accounts', async (context) => {
    const parsed = await parseJsonBody(context, newAccountSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const db = resolveDb()
      const { id } = await insertAccount(db, parsed.data)
      const account = await getAccountById(db, id)
      return context.json(account, 201)
    } catch (error) {
      console.error('Failed to create account:', error)
      return context.json({ error: 'Failed to create account' }, 500)
    }
  })

  route.patch('/api/accounts/:id', async (context) => {
    const id = context.req.param('id')
    const parsed = await parseJsonBody(context, accountUpdateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    try {
      const db = resolveDb()
      const existing = await getAccountById(db, id)
      if (!existing) return context.json({ error: 'Account not found' }, 404)
      await updateAccount(db, {
        id,
        name: parsed.data.name ?? existing.name,
        type: parsed.data.type ?? existing.type,
        currency: parsed.data.currency ?? existing.currency,
      })
      const account = await getAccountById(db, id)
      return context.json(account)
    } catch (error) {
      console.error('Failed to update account:', error)
      return context.json({ error: 'Failed to update account' }, 500)
    }
  })

  route.delete('/api/accounts/:id', async (context) => {
    const id = context.req.param('id')
    try {
      const db = resolveDb()
      const existing = await getAccountById(db, id)
      if (!existing) return context.json({ error: 'Account not found' }, 404)
      await deleteAccount(db, id)
      return context.json({ success: true })
    } catch (error) {
      console.error('Failed to delete account:', error)
      return context.json({ error: 'Failed to delete account' }, 500)
    }
  })

  return route
}
