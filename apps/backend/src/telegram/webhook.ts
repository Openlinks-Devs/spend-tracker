import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import {
  getCategories,
  getDistinctTags,
  getTransactionById,
  deleteTransaction,
  updateTransaction,
} from '../db/queries.js'
import { classifyEdit } from '../ai/classify.js'
import { sendMessage } from '../telegram/client.js'
import { formatDeleted, formatUpdatedTransaction } from '../telegram/format.js'
import { loadEnv } from '../config/env.js'
import { parseEdit, parseTransactionId } from './parse.js'

interface TelegramUpdate {
  message?: {
    text?: string
    reply_to_message?: { text?: string; message_id?: number }
  }
}

export interface WebhookDeps {
  db: Queryable
  // The Telegram webhook runs server-side with no session, so edits/deletes
  // are attributed to this explicit owner user id (resolved per request from
  // ALLOWED_EMAILS; see the route handler below).
  userId: string
  classify: typeof classifyEdit
  notify: typeof sendMessage
}

export async function handleTelegramUpdate(update: TelegramUpdate, deps: WebhookDeps): Promise<void> {
  const message = update.message
  const replyText = message?.reply_to_message?.text
  if (!message?.text || !replyText) return

  const transactionId = parseTransactionId(replyText)
  if (!transactionId) return

  if (message.text.trim() === '/delete') {
    await deleteTransaction(deps.db, transactionId)
    await deps.notify(formatDeleted(), { replyToMessageId: message.reply_to_message?.message_id })
    return
  }

  const edit = parseEdit(message.text)
  const [existing, categories, tags] = await Promise.all([
    getTransactionById(deps.db, transactionId),
    getCategories(deps.db, deps.userId),
    getDistinctTags(deps.db),
  ])
  if (!existing) return
  const classified = await deps.classify({ description: edit.description, categories, tags })
  const finalTags = edit.tags.length ? edit.tags : classified.tags
  await updateTransaction(deps.db, {
    id: transactionId,
    description: edit.description,
    amount: existing.amount,
    currency: existing.currency,
    account_id: existing.account_id,
    category_id: classified.category_id,
    tags: finalTags,
    created_at: existing.created_at,
  })
  const category = categories.find((candidate) => candidate.id === classified.category_id)
  await deps.notify(
    formatUpdatedTransaction({
      id: transactionId,
      description: edit.description,
      categoryName: category?.name ?? classified.category_id,
      tags: finalTags,
    }),
  )
}

export const telegramRoute = new Hono()

telegramRoute.post('/telegram/webhook', async (context) => {
  const env = loadEnv()
  const secret = context.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return context.json({ ok: false }, 401)
  }
  const db = getPool()
  // Same owner-lookup pattern as the Gmail poller in index.ts: the webhook has
  // no session, so edits/deletes are attributed to the owner (first entry of
  // ALLOWED_EMAILS). Full per-user Telegram linking is a later milestone.
  const ownerEmail = env.ALLOWED_EMAILS.split(',')[0]?.trim()
  const ownerLookup = ownerEmail
    ? await db.query('SELECT id FROM "user" WHERE email = $1', [ownerEmail])
    : { rows: [] }
  const ownerUserId = ownerLookup.rows[0]?.id as string | undefined
  if (!ownerUserId) {
    console.warn(
      `No "user" row for ${ownerEmail ?? '(no ALLOWED_EMAILS)'}. Sign in once with Google before editing transactions from Telegram.`,
    )
    return context.json({ ok: true })
  }
  const update = await context.req.json()
  await handleTelegramUpdate(update, {
    db,
    userId: ownerUserId,
    classify: classifyEdit,
    notify: sendMessage,
  })
  return context.json({ ok: true })
})
