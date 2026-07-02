import { loadEnv } from '../config/env.js'

export async function sendMessage(
  text: string,
  options: { replyToMessageId?: number } = {},
): Promise<void> {
  const env = loadEnv()
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      reply_to_message_id: options.replyToMessageId,
    }),
  })
  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status}`)
  }
}
