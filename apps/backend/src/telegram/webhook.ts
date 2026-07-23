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
import {
  getTelegramConnectionByChatId,
  replaceTelegramConnection,
  setConnectionStatus,
  type Connection,
} from '../connections/queries.js'
import { consumePairingCode } from '../connections/pairingCodes.js'
import { classifyEdit } from '../ai/classify.js'
import { sendMessage, TelegramSendError } from '../telegram/client.js'
import { formatDeleted, formatUpdatedTransaction } from '../telegram/format.js'
import { loadEnv } from '../config/env.js'
import { parseEdit, parseTransactionId } from './parse.js'

interface TelegramUpdate {
  message?: {
    text?: string
    chat?: { id: number }
    reply_to_message?: { text?: string; message_id?: number }
  }
}

export interface WebhookDeps {
  db: Queryable
  classify: typeof classifyEdit
  notify: typeof sendMessage
}

const START_COMMAND = '/start '

export async function handleTelegramUpdate(update: TelegramUpdate, deps: WebhookDeps): Promise<void> {
  const message = update.message
  const messageText = message?.text
  if (!messageText) return
  const chatId = String(message?.chat?.id ?? '')
  if (!chatId) return

  if (messageText.startsWith(START_COMMAND)) {
    await handlePairing(messageText.slice(START_COMMAND.length).trim(), chatId, deps)
    return
  }

  // Every other update is scoped to whichever user owns this chat. An unpaired
  // chat has no user to attribute edits to, so it is ignored silently.
  const connection = await getTelegramConnectionByChatId(deps.db, chatId)
  if (!connection) return

  await handleEdit(message, messageText, chatId, connection, deps)
}

// A 403 from Telegram means the user blocked or removed the bot, so we mark the
// connection needs_reauth instead of letting the error propagate.
async function notifyChat(
  deps: WebhookDeps,
  chatId: string,
  connectionId: string,
  text: string,
  options: { replyToMessageId?: number } = {},
): Promise<void> {
  try {
    await deps.notify(chatId, text, options)
  } catch (error) {
    if (error instanceof TelegramSendError && error.status === 403) {
      await setConnectionStatus(deps.db, connectionId, 'needs_reauth')
      return
    }
    throw error
  }
}

async function handlePairing(code: string, chatId: string, deps: WebhookDeps): Promise<void> {
  if (!code) return
  const pairedUserId = await consumePairingCode(deps.db, code, 'telegram_pair')
  if (!pairedUserId) {
    await deps.notify(chatId, 'El codigo de vinculacion no es valido o ya expiro.')
    return
  }
  // A chat maps to at most one user globally, so a code minted by a different
  // user must not steal a chat already paired to someone else.
  const existing = await getTelegramConnectionByChatId(deps.db, chatId)
  if (existing && existing.user_id !== pairedUserId) {
    await deps.notify(chatId, 'Este chat ya esta vinculado a otra cuenta de SpendTracker.')
    return
  }
  await replaceTelegramConnection(deps.db, pairedUserId, chatId)
  await deps.notify(
    chatId,
    'Chat vinculado a SpendTracker. Responde a un mensaje de transaccion para editarla.',
  )
}

async function handleEdit(
  message: NonNullable<TelegramUpdate['message']>,
  messageText: string,
  chatId: string,
  connection: Connection,
  deps: WebhookDeps,
): Promise<void> {
  const replyText = message.reply_to_message?.text
  if (!replyText) return

  const transactionId = parseTransactionId(replyText)
  if (!transactionId) return

  const userId = connection.user_id

  if (messageText.trim() === '/delete') {
    await deleteTransaction(deps.db, userId, transactionId)
    await notifyChat(deps, chatId, connection.id, formatDeleted(), {
      replyToMessageId: message.reply_to_message?.message_id,
    })
    return
  }

  const edit = parseEdit(messageText)
  const [existing, categories, tags] = await Promise.all([
    getTransactionById(deps.db, userId, transactionId),
    getCategories(deps.db, userId),
    getDistinctTags(deps.db, userId),
  ])
  if (!existing) return
  const classified = await deps.classify({ description: edit.description, categories, tags })
  const finalTags = edit.tags.length ? edit.tags : classified.tags
  await updateTransaction(deps.db, userId, {
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
  await notifyChat(
    deps,
    chatId,
    connection.id,
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
  // Always answer 200 so Telegram stops retrying, even if handling throws.
  try {
    const update = (await context.req.json()) as TelegramUpdate
    await handleTelegramUpdate(update, {
      db: getPool(),
      classify: classifyEdit,
      notify: sendMessage,
    })
  } catch (error) {
    console.error('Failed to handle Telegram update:', error)
  }
  return context.json({ ok: true })
})
