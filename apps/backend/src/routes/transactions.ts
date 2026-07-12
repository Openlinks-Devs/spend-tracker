import { Hono } from 'hono'
import { z } from 'zod'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import {
  deleteTransaction,
  getAccountById,
  getCategoryById,
  getCurrencyByCode,
  getTransactionById,
  insertTransaction,
  updateTransaction,
} from '../db/queries.js'
import type { Account, Transaction } from '../db/types.js'
import {
  buildTransactionListQuery,
  decodeCursor,
  encodeCursor,
  reduceTotals,
  type TotalsRow,
  type TransactionListFilters,
} from '../db/transactionFilters.js'
import { convertAmount, getBaseCurrencyCode } from '../currency/rates.js'
import { resolveCurrencyCode, roundToDecimalPlaces } from './currencyValidation.js'
import { isUuid, parseJsonBody } from './validation.js'

const transactionTypeSchema = z.enum(['expense', 'income', 'transfer'])
type TransactionType = z.infer<typeof transactionTypeSchema>

const newTransactionSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(1),
  account_id: z.string().min(1),
  category_id: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
  type: transactionTypeSchema,
  payee: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  occurred_at: z.string().min(1).optional(),
  base_amount: z.number().positive().optional(),
  rate_used: z.number().positive().optional(),
  to_account_id: z.string().min(1).optional(),
  to_amount: z.number().positive().optional(),
  external_id: z.string().min(1).optional(),
})

const transactionUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().min(1).optional(),
  account_id: z.string().min(1).optional(),
  category_id: z.string().min(1).nullable().optional(),
  tags: z.array(z.string()).optional(),
  type: transactionTypeSchema.optional(),
  payee: z.string().min(1).nullable().optional(),
  notes: z.string().min(1).nullable().optional(),
  occurred_at: z.string().min(1).optional(),
  base_amount: z.number().positive().optional(),
  rate_used: z.number().positive().optional(),
  to_account_id: z.string().min(1).nullable().optional(),
  to_amount: z.number().positive().nullable().optional(),
  external_id: z.string().min(1).nullable().optional(),
})

interface ValidationFailure {
  status: 400 | 404 | 422
  error: string
}

interface TransactionShape {
  type: TransactionType
  account_id: string
  category_id: string | null
  to_account_id: string | null
  to_amount: number | null
}

interface TransactionShapeValidation {
  failure: ValidationFailure | null
  // Populated when the shape is a valid transfer, so the caller can round
  // to_amount to the destination account's currency without a second lookup.
  destinationAccount: Account | null
}

async function validateTransactionShape(
  db: Queryable,
  shape: TransactionShape,
): Promise<TransactionShapeValidation> {
  const invalid = (failure: ValidationFailure): TransactionShapeValidation => ({
    failure,
    destinationAccount: null,
  })

  if (!isUuid(shape.account_id)) {
    return invalid({ status: 400, error: 'account_id is not a valid uuid' })
  }
  if (shape.category_id !== null && !isUuid(shape.category_id)) {
    return invalid({ status: 400, error: 'category_id is not a valid uuid' })
  }
  if (shape.to_account_id !== null && !isUuid(shape.to_account_id)) {
    return invalid({ status: 400, error: 'to_account_id is not a valid uuid' })
  }

  if (shape.type === 'transfer') {
    if (shape.to_account_id === null || shape.to_amount === null) {
      return invalid({ status: 422, error: 'Transfers require to_account_id and to_amount' })
    }
    if (shape.category_id !== null) {
      return invalid({ status: 422, error: 'Transfers must not carry a category_id' })
    }
    if (shape.to_account_id === shape.account_id) {
      return invalid({ status: 422, error: 'Transfer destination must differ from the source account' })
    }
  } else {
    if (shape.to_account_id !== null || shape.to_amount !== null) {
      return invalid({ status: 422, error: 'to_account_id and to_amount are only valid for transfers' })
    }
    if (shape.category_id === null) {
      return invalid({ status: 422, error: 'category_id is required for expense and income transactions' })
    }
  }

  const account = await getAccountById(db, shape.account_id)
  if (!account) return invalid({ status: 404, error: 'Account not found' })

  if (shape.type === 'transfer') {
    const destinationAccount = await getAccountById(db, shape.to_account_id as string)
    if (!destinationAccount) return invalid({ status: 404, error: 'Destination account not found' })
    return { failure: null, destinationAccount }
  }

  const category = await getCategoryById(db, shape.category_id as string)
  if (!category) return invalid({ status: 404, error: 'Category not found' })
  if (category.type !== shape.type) {
    return invalid({
      status: 422,
      error: `Category type "${category.type}" does not match transaction type "${shape.type}"`,
    })
  }
  return { failure: null, destinationAccount: null }
}

function signAmount(type: TransactionType, magnitude: number): number {
  return type === 'income' ? Math.abs(magnitude) : -Math.abs(magnitude)
}

// Rounds a transfer's to_amount to the destination account's currency
// decimal_places (e.g. 100.5 into a JPY account -> 101). Falls back to the
// raw amount when there is no destination account (non-transfers) or amount
// to round.
async function resolveToAmount(
  db: Queryable,
  toAmount: number | null,
  destinationAccount: Account | null,
): Promise<number | null> {
  if (toAmount === null || !destinationAccount) return toAmount
  const destinationCurrency = await getCurrencyByCode(db, destinationAccount.currency)
  if (!destinationCurrency) return toAmount
  return roundToDecimalPlaces(toAmount, destinationCurrency.decimal_places)
}

// A derived rate_used comes from dividing two user-entered decimals (e.g.
// 74.8 / 20), which lands on floating-point tails like 3.7399999999999998
// instead of 3.74. Rates do not need more than 6 decimal places of
// precision, so round away the tail.
function deriveRateUsed(baseAmount: number, signedAmount: number): number {
  return Math.round(Math.abs(baseAmount / signedAmount) * 1_000_000) / 1_000_000
}

// User-entered base_amount beats any computed one. When nothing is provided
// and no rate exists, both fields stay null: never a silent rate of 1.
async function resolveBaseAmount(
  db: Queryable,
  signedAmount: number,
  currency: string,
  occurredAt: string,
  override: { base_amount?: number; rate_used?: number },
): Promise<{ base_amount: number | null; rate_used: number | null }> {
  if (override.base_amount !== undefined) {
    const baseCurrencyCode = await getBaseCurrencyCode(db)
    const baseCurrency = await getCurrencyByCode(db, baseCurrencyCode)
    const roundedOverride = roundToDecimalPlaces(override.base_amount, baseCurrency?.decimal_places ?? 2)
    const signedBaseAmount = Math.sign(signedAmount) * Math.abs(roundedOverride)
    const rateUsed = override.rate_used ?? deriveRateUsed(roundedOverride, signedAmount)
    return { base_amount: signedBaseAmount, rate_used: rateUsed }
  }
  const baseCurrencyCode = await getBaseCurrencyCode(db)
  const conversion = await convertAmount(
    db,
    signedAmount,
    currency,
    baseCurrencyCode,
    occurredAt.slice(0, 10),
  )
  if (!conversion) return { base_amount: null, rate_used: null }
  return { base_amount: conversion.convertedAmount, rate_used: conversion.rateUsed }
}

type ParsedListFilters =
  | { success: true; filters: TransactionListFilters }
  | { success: false; error: string }

function parseListFilters(query: Record<string, string>): ParsedListFilters {
  const filters: TransactionListFilters = {}
  if (query.from) filters.from = query.from
  if (query.to) filters.to = query.to
  if (query.account_ids) {
    const accountIds = query.account_ids.split(',').filter(Boolean)
    if (accountIds.some((candidateId) => !isUuid(candidateId))) {
      return { success: false, error: 'account_ids must be a comma-separated list of uuids' }
    }
    filters.account_ids = accountIds
  }
  if (query.category_ids) {
    const categoryIds = query.category_ids.split(',').filter(Boolean)
    if (categoryIds.some((candidateId) => !isUuid(candidateId))) {
      return { success: false, error: 'category_ids must be a comma-separated list of uuids' }
    }
    filters.category_ids = categoryIds
  }
  if (query.uncategorized === 'true') filters.uncategorized = true
  if (query.tags) filters.tags = query.tags.split(',').filter(Boolean)
  if (query.tag_mode) {
    if (!['any', 'all', 'none'].includes(query.tag_mode)) {
      return { success: false, error: 'tag_mode must be any, all, or none' }
    }
    filters.tag_mode = query.tag_mode as 'any' | 'all' | 'none'
  }
  if (query.amount_min !== undefined) {
    const amountMin = Number(query.amount_min)
    if (Number.isNaN(amountMin)) return { success: false, error: 'amount_min must be a number' }
    filters.amount_min = amountMin
  }
  if (query.amount_max !== undefined) {
    const amountMax = Number(query.amount_max)
    if (Number.isNaN(amountMax)) return { success: false, error: 'amount_max must be a number' }
    filters.amount_max = amountMax
  }
  if (query.currency) filters.currency = query.currency
  if (query.type) {
    if (!['expense', 'income', 'transfer'].includes(query.type)) {
      return { success: false, error: 'type must be expense, income, or transfer' }
    }
    filters.type = query.type as 'expense' | 'income' | 'transfer'
  }
  if (query.search) filters.search = query.search
  if (query.sort) {
    if (!['occurred_at', 'amount'].includes(query.sort)) {
      return { success: false, error: 'sort must be occurred_at or amount' }
    }
    filters.sort = query.sort as 'occurred_at' | 'amount'
  }
  if (query.order) {
    if (!['asc', 'desc'].includes(query.order)) {
      return { success: false, error: 'order must be asc or desc' }
    }
    filters.order = query.order as 'asc' | 'desc'
  }
  if (query.cursor) {
    if (!decodeCursor(query.cursor)) return { success: false, error: 'Invalid cursor' }
    filters.cursor = query.cursor
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1) {
      return { success: false, error: 'limit must be a positive integer' }
    }
    filters.limit = limit
  }
  return { success: true, filters }
}

export function createTransactionsRoute(resolveDb: () => Queryable = getPool): Hono {
  const route = new Hono()

  route.get('/api/transactions', async (context) => {
    const parsedFilters = parseListFilters(context.req.query())
    if (!parsedFilters.success) {
      return context.json({ error: parsedFilters.error }, 400)
    }
    try {
      const db = resolveDb()
      const { listSql, listParams, totalsSql, totalsParams, limit } = buildTransactionListQuery(
        parsedFilters.filters,
      )
      const [listResult, totalsResult, baseCurrencyCode] = await Promise.all([
        db.query(listSql, listParams),
        db.query(totalsSql, totalsParams),
        getBaseCurrencyCode(db),
      ])
      const rows = listResult.rows as Transaction[]
      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const lastItem = items[items.length - 1]
      const sort = parsedFilters.filters.sort ?? 'occurred_at'
      const next_cursor =
        hasMore && lastItem
          ? encodeCursor(
              sort === 'amount'
                ? { occurred_at: lastItem.occurred_at, id: lastItem.id, amount: lastItem.amount }
                : { occurred_at: lastItem.occurred_at, id: lastItem.id },
            )
          : null
      const totals = reduceTotals(totalsResult.rows as TotalsRow[], baseCurrencyCode)
      return context.json({ items, next_cursor, totals })
    } catch (error) {
      console.error('Failed to list transactions:', error)
      return context.json({ error: 'Failed to list transactions' }, 500)
    }
  })

  route.get('/api/transactions/:id', async (context) => {
    const id = context.req.param('id')
    if (!isUuid(id)) return context.json({ error: 'Invalid transaction id' }, 400)
    try {
      const transaction = await getTransactionById(resolveDb(), id)
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
    const body = parsed.data
    try {
      const db = resolveDb()
      const shapeValidation = await validateTransactionShape(db, {
        type: body.type,
        account_id: body.account_id,
        category_id: body.category_id ?? null,
        to_account_id: body.to_account_id ?? null,
        to_amount: body.to_amount ?? null,
      })
      if (shapeValidation.failure) {
        return context.json({ error: shapeValidation.failure.error }, shapeValidation.failure.status)
      }

      const currencyResolution = await resolveCurrencyCode(db, body.currency)
      if (!currencyResolution.success) {
        return context.json({ error: currencyResolution.failure.error }, currencyResolution.failure.status)
      }
      const currencyCode = currencyResolution.code
      const roundedAmount = roundToDecimalPlaces(body.amount, currencyResolution.decimalPlaces)
      const roundedToAmount = await resolveToAmount(
        db,
        body.to_amount ?? null,
        shapeValidation.destinationAccount,
      )

      const occurredAt = body.occurred_at ?? new Date().toISOString()
      const signedAmount = signAmount(body.type, roundedAmount)
      const { base_amount, rate_used } = await resolveBaseAmount(
        db,
        signedAmount,
        currencyCode,
        occurredAt,
        body,
      )

      const { id } = await insertTransaction(db, {
        description: body.description,
        amount: signedAmount,
        currency: currencyCode,
        account_id: body.account_id,
        category_id: body.type === 'transfer' ? null : (body.category_id as string),
        tags: body.tags,
        type: body.type,
        payee: body.payee ?? null,
        notes: body.notes ?? null,
        occurred_at: occurredAt,
        base_amount,
        rate_used,
        to_account_id: body.to_account_id ?? null,
        to_amount: roundedToAmount,
        external_id: body.external_id ?? null,
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
    if (!isUuid(id)) return context.json({ error: 'Invalid transaction id' }, 400)
    const parsed = await parseJsonBody(context, transactionUpdateSchema)
    if (!parsed.success) {
      return context.json({ error: parsed.error }, 400)
    }
    const body = parsed.data
    try {
      const db = resolveDb()
      const existing = await getTransactionById(db, id)
      if (!existing) return context.json({ error: 'Transaction not found' }, 404)

      const mergedType = body.type ?? existing.type
      const typeChanged = mergedType !== existing.type
      const mergedAccountId = body.account_id ?? existing.account_id
      // When the type changes, drop the fields the new type forbids unless the
      // body sets them explicitly; the shape validation then demands the rest.
      const mergedCategoryId =
        body.category_id !== undefined
          ? body.category_id
          : typeChanged && mergedType === 'transfer'
            ? null
            : existing.category_id
      const mergedToAccountId =
        body.to_account_id !== undefined
          ? body.to_account_id
          : typeChanged && mergedType !== 'transfer'
            ? null
            : existing.to_account_id
      const mergedToAmount =
        body.to_amount !== undefined
          ? body.to_amount
          : typeChanged && mergedType !== 'transfer'
            ? null
            : existing.to_amount

      const shapeValidation = await validateTransactionShape(db, {
        type: mergedType,
        account_id: mergedAccountId,
        category_id: mergedCategoryId,
        to_account_id: mergedToAccountId,
        to_amount: mergedToAmount,
      })
      if (shapeValidation.failure) {
        return context.json({ error: shapeValidation.failure.error }, shapeValidation.failure.status)
      }

      let mergedCurrency = body.currency ?? existing.currency
      if (body.currency !== undefined) {
        const currencyResolution = await resolveCurrencyCode(db, body.currency)
        if (!currencyResolution.success) {
          return context.json({ error: currencyResolution.failure.error }, currencyResolution.failure.status)
        }
        mergedCurrency = currencyResolution.code
      }
      const mergedOccurredAt = body.occurred_at ?? existing.occurred_at

      // Only a freshly submitted amount or to_amount needs rounding: a stored
      // value was already rounded on the way in.
      let amountMagnitude = body.amount ?? Math.abs(existing.amount)
      if (body.amount !== undefined) {
        const amountCurrency = await resolveCurrencyCode(db, mergedCurrency)
        if (amountCurrency.success) {
          amountMagnitude = roundToDecimalPlaces(amountMagnitude, amountCurrency.decimalPlaces)
        }
      }
      const roundedToAmount =
        body.to_amount !== undefined
          ? await resolveToAmount(db, mergedToAmount, shapeValidation.destinationAccount)
          : mergedToAmount
      const signedAmount = signAmount(mergedType, amountMagnitude)

      let baseAmount = existing.base_amount
      let rateUsed = existing.rate_used
      if (body.base_amount !== undefined) {
        const resolved = await resolveBaseAmount(db, signedAmount, mergedCurrency, mergedOccurredAt, {
          base_amount: body.base_amount,
          rate_used: body.rate_used,
        })
        baseAmount = resolved.base_amount
        rateUsed = resolved.rate_used
      } else if (
        body.amount !== undefined ||
        body.currency !== undefined ||
        body.occurred_at !== undefined
      ) {
        const resolved = await resolveBaseAmount(db, signedAmount, mergedCurrency, mergedOccurredAt, {})
        baseAmount = resolved.base_amount
        rateUsed = resolved.rate_used
      } else if (baseAmount !== null) {
        // Only the type (and so the sign) may have changed: keep the frozen
        // magnitude but follow the sign of the stored amount.
        baseAmount = Math.sign(signedAmount) * Math.abs(baseAmount)
      }

      await updateTransaction(db, {
        id,
        description: body.description ?? existing.description,
        amount: signedAmount,
        currency: mergedCurrency,
        account_id: mergedAccountId,
        category_id: mergedCategoryId,
        tags: body.tags ?? existing.tags,
        type: mergedType,
        payee: body.payee !== undefined ? body.payee : existing.payee,
        notes: body.notes !== undefined ? body.notes : existing.notes,
        occurred_at: mergedOccurredAt,
        base_amount: baseAmount,
        rate_used: rateUsed,
        to_account_id: mergedToAccountId,
        to_amount: roundedToAmount,
        external_id: body.external_id !== undefined ? body.external_id : existing.external_id,
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
    if (!isUuid(id)) return context.json({ error: 'Invalid transaction id' }, 400)
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
