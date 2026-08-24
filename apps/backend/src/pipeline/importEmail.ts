import type { Queryable } from '../db/pool.js'
import type { TransactionalPool } from '../db/queries.js'
import { getTelegramConnectionForUser } from '../connections/queries.js'
import { sendMessage } from '../telegram/client.js'
import { processEmail, defaultProcessDeps, type ImportedEmail } from './processEmail.js'

/**
 * The import pipeline wired with the per-connection dependencies it needs: the
 * database and the owner's Telegram chat, if they have one.
 *
 * Both entry points into the pipeline use this. The poller imports whatever a
 * cycle finds; the Inbox retry endpoint imports one message the user asked for
 * again. Building the deps in one place is what keeps a retry behaving exactly
 * like the automatic import it is repeating.
 */
export function createImportEmail(
  db: Queryable,
  pool: TransactionalPool,
): (
  email: ImportedEmail,
  importContext: { userId: string; connectionId: string; force?: boolean },
) => Promise<void> {
  return (email, importContext) =>
    processEmail(email, importContext, {
      ...defaultProcessDeps,
      db,
      pool,
      notify: async (text) => {
        const telegram = await getTelegramConnectionForUser(db, importContext.userId)
        if (telegram) await sendMessage(telegram.external_id, text)
      },
    })
}
