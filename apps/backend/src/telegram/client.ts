import { loadEnv } from '../config/env.js'

// Carries the HTTP status so callers can react to it: a 403 means the user
// blocked or removed the bot, which should flip their connection to needs_reauth.
export class TelegramSendError extends Error {
  status: number
  constructor(status: number, body: string) {
    super(`Telegram sendMessage failed with ${status}: ${body}`)
    this.name = 'TelegramSendError'
    this.status = status
  }
}

export async function sendMessage(
  chatId: string,
  text: string,
  options: { replyToMessageId?: number } = {},
): Promise<void> {
  const env = loadEnv()
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(options.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
    }),
  })
  if (!response.ok) {
    throw new TelegramSendError(response.status, await response.text())
  }
}
