import { Hono } from 'hono'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { getCategories, getDistinctTags, deleteTransaction, updateTransaction } from '../db/queries.js'
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
  const [categories, tags] = await Promise.all([
    getCategories(deps.db),
    getDistinctTags(deps.db),
  ])
  const classified = await deps.classify({ description: edit.description, categories, tags })
  const finalTags = edit.tags.length ? edit.tags : classified.tags
  await updateTransaction(deps.db, {
    id: transactionId,
    description: edit.description,
    category_id: classified.category_id,
    tags: finalTags,
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
  const update = await context.req.json()
  await handleTelegramUpdate(update, {
    db: getPool(),
    classify: classifyEdit,
    notify: sendMessage,
  })
  return context.json({ ok: true })
})
