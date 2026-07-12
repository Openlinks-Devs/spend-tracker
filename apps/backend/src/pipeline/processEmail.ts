import type { Queryable } from '../db/pool.js'
import {
  getAccounts,
  getCategories,
  getCurrencyByCode,
  getDistinctTags,
  getTransactionByExternalId,
  insertTransaction,
} from '../db/queries.js'
import { detectTransaction } from '../ai/detect.js'
import { extractTransaction } from '../ai/extract.js'
import { convertAmount, getBaseCurrencyCode } from '../currency/rates.js'
import { backfillRate } from '../currency/fetchRates.js'
import { sendMessage } from '../telegram/client.js'
import { formatError, formatNewTransaction } from '../telegram/format.js'

export interface ProcessDeps {
  db: Queryable
  now: () => string
  detect: typeof detectTransaction
  extract: typeof extractTransaction
  notify: typeof sendMessage
  convert: typeof convertAmount
  backfill: typeof backfillRate
}

export const defaultProcessDeps: Omit<ProcessDeps, 'db'> = {
  now: () => new Date().toISOString(),
  detect: detectTransaction,
  extract: extractTransaction,
  notify: sendMessage,
  convert: convertAmount,
  backfill: backfillRate,
}

// backfillRate throws on a non-2xx or malformed response from
// exchangerate.host (it only returns null for the missing-env-key case). A
// transient outage there must not crash the email poller, so every call goes
// through this wrapper instead of being awaited directly.
async function safeBackfill(
  deps: ProcessDeps,
  quoteCode: string,
  onDate: string,
): Promise<void> {
  try {
    await deps.backfill(deps.db, quoteCode, onDate)
  } catch (error) {
    console.error(`backfillRate failed for ${quoteCode} on ${onDate}:`, error)
  }
}

export async function processEmail(
  email: { subject: string; text: string; messageId: string },
  deps: ProcessDeps,
): Promise<void> {
  // Idempotent ingestion: the Gmail message id is the external id. A repeat
  // (webhook replay, cursor reset) is skipped silently, before any AI call.
  const alreadyIngested = await getTransactionByExternalId(deps.db, email.messageId)
  if (alreadyIngested) return

  const isTransaction = await deps.detect({ subject: email.subject, text: email.text })
  if (!isTransaction) return

  const [categories, accounts, tags] = await Promise.all([
    getCategories(deps.db),
    getAccounts(deps.db),
    getDistinctTags(deps.db),
  ])

  const extracted = await deps.extract({
    text: email.text,
    categories,
    accounts,
    tags,
    now: deps.now(),
  })

  if (!extracted) {
    await deps.notify(formatError(`No se pudo determinar la cuenta para: ${email.subject}`))
    return
  }

  const currencyCode = extracted.currency.trim().toUpperCase()
  const knownCurrency = await getCurrencyByCode(deps.db, currencyCode)
  if (!knownCurrency) {
    await deps.notify(
      formatError(
        `Moneda desconocida "${currencyCode}" en: ${email.subject}. Transaccion no creada.`,
      ),
    )
    return
  }

  const type = extracted.amount < 0 ? 'expense' : 'income'
  const occurredDate = extracted.occurred_at.slice(0, 10)
  const baseCurrencyCode = await getBaseCurrencyCode(deps.db)

  let conversion = await deps.convert(
    deps.db,
    extracted.amount,
    currencyCode,
    baseCurrencyCode,
    occurredDate,
  )
  if (!conversion) {
    // Rates are stored as USD pairs; backfill whichever legs are not USD,
    // then retry once. A still-missing rate stays null, never 1.
    if (currencyCode !== 'USD') await safeBackfill(deps, currencyCode, occurredDate)
    if (baseCurrencyCode !== 'USD') await safeBackfill(deps, baseCurrencyCode, occurredDate)
    conversion = await deps.convert(
      deps.db,
      extracted.amount,
      currencyCode,
      baseCurrencyCode,
      occurredDate,
    )
  }

  const { id } = await insertTransaction(deps.db, {
    description: extracted.description,
    amount: extracted.amount,
    currency: currencyCode,
    account_id: extracted.account_id,
    category_id: extracted.category_id,
    tags: extracted.tags,
    type,
    payee: extracted.payee,
    notes: null,
    occurred_at: extracted.occurred_at,
    base_amount: conversion?.convertedAmount ?? null,
    rate_used: conversion?.rateUsed ?? null,
    to_account_id: null,
    to_amount: null,
    external_id: email.messageId,
  })

  const account = accounts.find((candidate) => candidate.id === extracted.account_id)
  const category = categories.find((candidate) => candidate.id === extracted.category_id)
  await deps.notify(
    formatNewTransaction({
      id,
      description: extracted.description,
      accountName: account?.name ?? extracted.account_id,
      categoryName: category?.name ?? extracted.category_id,
      tags: extracted.tags,
      currency: currencyCode,
      amount: extracted.amount,
      created_at: extracted.occurred_at,
    }),
  )
}
