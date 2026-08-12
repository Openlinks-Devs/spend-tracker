import type { Queryable } from '../db/pool.js'
import { TelegramSendError } from '../telegram/client.js'
import { formatGmailConnectionLost } from '../telegram/format.js'
import { getTelegramConnectionForUser, setConnectionStatus } from './queries.js'

export interface ConnectionLostNotifierDeps {
  db: Queryable
  sendMessage: (chatId: string, text: string) => Promise<void>
  integrationsUrl: string
}

/**
 * Tell the user, over Telegram, that one of their Gmail accounts stopped
 * importing. Called at the moment the connection flips to needs_reauth, which
 * is why it needs no dedupe state: the row leaves the active poll set, so the
 * transition happens once per break.
 *
 * Never throws. A Telegram outage must not abort the poll cycle for the other
 * connections, and the Gmail status has already been written by the time we get
 * here, so there is nothing left to roll back.
 */
export async function notifyGmailConnectionLost(
  deps: ConnectionLostNotifierDeps,
  connection: { user_id: string; external_id: string },
): Promise<void> {
  try {
    const telegram = await getTelegramConnectionForUser(deps.db, connection.user_id)
    if (!telegram) return
    try {
      await deps.sendMessage(
        telegram.external_id,
        formatGmailConnectionLost({
          email: connection.external_id,
          integrationsUrl: deps.integrationsUrl,
        }),
      )
    } catch (error) {
      // A 403 means the user blocked or removed the bot, so the telegram
      // connection is dead too and should stop being treated as a live channel.
      if (error instanceof TelegramSendError && error.status === 403) {
        await setConnectionStatus(deps.db, telegram.id, 'needs_reauth')
      }
      throw error
    }
  } catch (error) {
    console.error(`Failed to alert user ${connection.user_id} about a lost Gmail connection:`, error)
  }
}
