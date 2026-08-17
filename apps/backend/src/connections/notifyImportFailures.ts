import type { Queryable } from '../db/pool.js'
import { TelegramSendError } from '../telegram/client.js'
import { formatImportFailures } from '../telegram/format.js'
import { getTelegramConnectionForUser, setConnectionStatus } from './queries.js'

export interface ImportFailure {
  sender: string | null
  subject: string | null
}

export interface ImportFailureNotifierDeps {
  db: Queryable
  sendMessage: (chatId: string, text: string) => Promise<void>
  inboxUrl: string
}

/**
 * Tell the user, over Telegram, that emails from this poll cycle could not be
 * processed. One message per connection per cycle: the caller batches the
 * cycle's failures and applies the cooldown, because nothing in the data model
 * gates repetition the way the connection status gates the disconnect alert.
 *
 * Never throws, for the same reason notifyGmailConnectionLost does not: an
 * alert must never break the import loop, and the log rows are already written
 * by the time we get here.
 */
export async function notifyImportFailures(
  deps: ImportFailureNotifierDeps,
  userId: string,
  failures: ImportFailure[],
): Promise<void> {
  const [firstFailure] = failures
  if (!firstFailure) return
  try {
    const telegram = await getTelegramConnectionForUser(deps.db, userId)
    if (!telegram) return
    try {
      await deps.sendMessage(
        telegram.external_id,
        formatImportFailures({
          sender: firstFailure.sender,
          subject: firstFailure.subject,
          count: failures.length,
          inboxUrl: deps.inboxUrl,
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
    console.error(`Failed to alert user ${userId} about failed email imports:`, error)
  }
}
