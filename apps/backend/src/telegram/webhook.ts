import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
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
  // The Telegram webhook runs server-side with no session, so edits/deletes must
  // be scoped to an explicit user id. The route is disabled until per-user
  // connections can supply this from a linked account (see
  // docs/superpowers/specs/2026-07-17-per-user-connections-design.md).
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
    await deleteTransaction(deps.db, deps.userId, transactionId)
    await deps.notify(formatDeleted(), { replyToMessageId: message.reply_to_message?.message_id })
    return
  }

  const edit = parseEdit(message.text)
  const [existing, categories, tags] = await Promise.all([
    getTransactionById(deps.db, deps.userId, transactionId),
    getCategories(deps.db, deps.userId),
    getDistinctTags(deps.db, deps.userId),
  ])
  if (!existing) return
  const classified = await deps.classify({ description: edit.description, categories, tags })
  const finalTags = edit.tags.length ? edit.tags : classified.tags
  await updateTransaction(deps.db, deps.userId, {
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
  // Edit-by-reply is disabled until per-user connections land (see
  // docs/superpowers/specs/2026-07-17-per-user-connections-design.md). The
  // webhook runs with no session, so there is no user to scope edits/deletes to.
  // handleTelegramUpdate stays intact for when a linked connection can supply the
  // owner's user id; for now we validate the secret and accept the update as a
  // no-op so Telegram stops retrying.
  return context.json({ ok: true })
})
