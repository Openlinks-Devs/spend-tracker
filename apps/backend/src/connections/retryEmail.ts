import type { gmail_v1 } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import type { EmailLogItem, ImportVerdict } from '../db/types.js'
import { isAuthError } from './authError.js'
import { decryptSecret } from './crypto.js'
import type { VersionedKey } from './crypto.js'
import { getEmailLogItem } from './importSource.js'
import { setConnectionStatus } from './queries.js'

// Only an outcome the user can act on is retryable. 'imported' is excluded
// because re-running it would insert the transaction a second time,
// 'not_transaction' and 'not_configured' because a retry would reach the same
// verdict from the same email. The web and Android clients gate the button on
// this same set (see the VERDICT labels in InboxPage.tsx and InboxScreen.kt).
export const RETRYABLE_VERDICTS: ReadonlySet<ImportVerdict> = new Set<ImportVerdict>([
  'failed',
  'extract_failed',
])

export type RetryFailureReason =
  | 'email_not_found'
  | 'verdict_not_retryable'
  | 'connection_needs_reauth'

export type RetryResult =
  | { ok: true; email: EmailLogItem }
  | { ok: false; reason: RetryFailureReason }

export interface RetryEmailDeps {
  db: Queryable
  keys: VersionedKey[]
  buildGmail: (refreshToken: string) => gmail_v1.Gmail
  fetchMessage: (gmail: gmail_v1.Gmail, id: string) => Promise<unknown>
  parseMessage: (message: unknown) => {
    subject: string
    text: string
    sender: string | null
    internalDateSeconds: string
  }
  importEmail: (
    email: {
      subject: string
      text: string
      messageId: string
      sender: string | null
      emailDateSeconds: string
    },
    importContext: { userId: string; connectionId: string; force: boolean },
  ) => Promise<void>
}

interface RetryableRow {
  verdict: ImportVerdict
  connection_provider: string
  connection_status: string
  connection_external_id: string
  connection_key_version: number | null
  connection_secret: Buffer | null
}

// One query rather than a row read followed by a connection read: the join is
// what scopes the message to the caller, so a message id belonging to another
// user cannot be distinguished from one that does not exist.
const RETRY_ROW_SELECT = `
  SELECT import_source.verdict,
         connection.provider AS connection_provider,
         connection.status AS connection_status,
         connection.external_id AS connection_external_id,
         connection.key_version AS connection_key_version,
         connection.secret_encrypted AS connection_secret
    FROM import_source
    JOIN connection ON connection.id = import_source.connection_id
   WHERE connection.user_id = $1
     AND import_source.connection_id = $2
     AND import_source.message_id = $3`

/**
 * Re-fetch one already-processed Gmail message and run it through the import
 * pipeline again, on the user's explicit request.
 *
 * The import is forced past the dedupe check: every row the Retry button
 * appears on is one the poller would skip, either because its verdict is
 * terminal or because it already spent its three automatic attempts. Whatever
 * the pipeline decides this time overwrites the old verdict through the usual
 * recordImportSource upsert, so the Inbox row is corrected in place rather than
 * duplicated.
 */
export async function retryEmail(
  deps: RetryEmailDeps,
  userId: string,
  connectionId: string,
  messageId: string,
): Promise<RetryResult> {
  const result = await deps.db.query(RETRY_ROW_SELECT, [userId, connectionId, messageId])
  const row = result.rows[0] as RetryableRow | undefined
  if (!row) return { ok: false, reason: 'email_not_found' }

  if (!RETRYABLE_VERDICTS.has(row.verdict)) {
    return { ok: false, reason: 'verdict_not_retryable' }
  }

  // Retrying means re-fetching the message from Gmail, so a row belonging to any
  // other provider cannot be retried this way. Only the Gmail poller writes
  // import_source rows today; this guard is what keeps that assumption explicit
  // rather than leaving a future Telegram import to fail as a confusing
  // "reconnect your Gmail account".
  if (row.connection_provider !== 'gmail') {
    return { ok: false, reason: 'verdict_not_retryable' }
  }

  // A connection the poller has parked cannot fetch anything. Saying so is what
  // lets the clients point the user at the Integrations screen instead of
  // showing a generic failure they cannot act on.
  if (row.connection_status !== 'active' || !row.connection_secret) {
    return { ok: false, reason: 'connection_needs_reauth' }
  }

  const refreshToken = decryptSecret(
    row.connection_secret,
    row.connection_key_version ?? 0,
    deps.keys,
    `${userId}:${row.connection_external_id}`,
  )

  try {
    const gmail = deps.buildGmail(refreshToken)
    const rawMessage = await deps.fetchMessage(gmail, messageId)
    const parsed = deps.parseMessage(rawMessage)
    await deps.importEmail(
      {
        subject: parsed.subject,
        text: parsed.text,
        messageId,
        sender: parsed.sender,
        emailDateSeconds: parsed.internalDateSeconds,
      },
      { userId, connectionId, force: true },
    )
  } catch (error) {
    // Same handling as the poller: a dead token has to park the connection, or
    // the user keeps pressing a button that cannot work. Every other error is
    // left to the caller, which answers 500. processEmail has already recorded
    // its own 'failed' row by then, so the Inbox still reflects the attempt.
    if (isAuthError(error)) {
      await setConnectionStatus(deps.db, connectionId, 'needs_reauth')
      return { ok: false, reason: 'connection_needs_reauth' }
    }
    throw error
  }

  const email = await getEmailLogItem(deps.db, userId, connectionId, messageId)
  // The row was there a moment ago and the pipeline always writes a verdict, so
  // this is unreachable short of a concurrent delete.
  if (!email) return { ok: false, reason: 'email_not_found' }
  return { ok: true, email }
}
