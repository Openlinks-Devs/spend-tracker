import type { Queryable } from '../db/pool.js'
import type { EmailLogItem, ImportVerdict } from '../db/types.js'

// A 'failed' row is retried on later poll cycles until it hits this many
// attempts, so a transient AI or database outage does not permanently cost a
// real transaction while a poison message still stops after three cycles.
export const MAX_IMPORT_ATTEMPTS = 3

export interface ImportOutcome {
  verdict: ImportVerdict
  transactionId?: string | null
  sender?: string | null
  subject?: string | null
  // Gmail's internalDate in seconds, as a string. Converted with to_timestamp
  // for the timestamptz column.
  emailDateSeconds?: string | null
}

/**
 * Whether the poller can skip this message. A row means skip, unless the row is
 * a failure with attempts left.
 */
export async function shouldSkipMessage(
  db: Queryable,
  connectionId: string,
  messageId: string,
): Promise<boolean> {
  const result = await db.query(
    'SELECT verdict, attempts FROM import_source WHERE connection_id = $1 AND message_id = $2',
    [connectionId, messageId],
  )
  const existing = result.rows[0]
  if (!existing) return false
  if (existing.verdict === 'failed' && Number(existing.attempts) < MAX_IMPORT_ATTEMPTS) return false
  return true
}

/**
 * Write the outcome of one email. Upserts rather than ignoring a conflict,
 * because a retry has to overwrite the previous verdict and bump attempts.
 * Sender, subject and email date are kept when a retry cannot supply them (a
 * failure recorded by the poller has no parsed message to describe).
 *
 * An 'imported' row is never overwritten. Downgrading one to 'failed' would put
 * it back in the retry set with its transaction link cleared, and the retry
 * would import the same email a second time on top of the transaction the user
 * already has.
 */
export async function recordImportSource(
  db: Queryable,
  connectionId: string,
  messageId: string,
  outcome: ImportOutcome,
): Promise<void> {
  await db.query(
    `INSERT INTO import_source
       (connection_id, message_id, transaction_id, sender, subject, email_date, verdict, attempts)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6::bigint), $7, 1)
     ON CONFLICT (connection_id, message_id) DO UPDATE
       SET transaction_id = EXCLUDED.transaction_id,
           sender = COALESCE(EXCLUDED.sender, import_source.sender),
           subject = COALESCE(EXCLUDED.subject, import_source.subject),
           email_date = COALESCE(EXCLUDED.email_date, import_source.email_date),
           verdict = EXCLUDED.verdict,
           attempts = import_source.attempts + 1
     WHERE import_source.verdict IS DISTINCT FROM 'imported'`,
    [
      connectionId,
      messageId,
      outcome.transactionId ?? null,
      outcome.sender ?? null,
      outcome.subject ?? null,
      outcome.emailDateSeconds ?? null,
      outcome.verdict,
    ],
  )
}

/**
 * The failed messages this connection should try again. Retry works by message
 * id, so these are re-fetched regardless of where the cursor stands.
 */
export async function listRetryableMessageIds(
  db: Queryable,
  connectionId: string,
): Promise<string[]> {
  const result = await db.query(
    `SELECT message_id FROM import_source
      WHERE connection_id = $1 AND verdict = 'failed' AND attempts < ${MAX_IMPORT_ATTEMPTS}
      ORDER BY created_at`,
    [connectionId],
  )
  return result.rows.map((row) => row.message_id as string)
}

/**
 * Stop holding a readable record of who emails the user and about what once the
 * row is old. The row, its verdict and its dedupe value survive, so the audit
 * trail and the duplicate protection stay intact. Cheap and idempotent, so the
 * poller runs it once per cycle.
 */
export async function clearExpiredEmailMetadata(db: Queryable): Promise<void> {
  await db.query(
    `UPDATE import_source
        SET sender = NULL, subject = NULL
      WHERE created_at < now() - interval '30 days'
        AND (sender IS NOT NULL OR subject IS NOT NULL)`,
  )
}

const EMAIL_LOG_SELECT = `
  SELECT import_source.message_id,
         import_source.connection_id,
         connection.external_id AS account_email,
         import_source.sender,
         import_source.subject,
         import_source.email_date,
         import_source.created_at AS received_at,
         import_source.verdict,
         import_source.attempts,
         transactions.id AS transaction_id,
         transactions.description AS transaction_description,
         transactions.amount::float8 AS transaction_amount,
         transactions.currency AS transaction_currency
    FROM import_source
    JOIN connection ON connection.id = import_source.connection_id
    LEFT JOIN transactions ON transactions.id = import_source.transaction_id
   WHERE connection.user_id = $1
   ORDER BY import_source.created_at DESC
   LIMIT $2 OFFSET $3`

function toEmailLogItem(row: Record<string, unknown>): EmailLogItem {
  return {
    message_id: row.message_id as string,
    connection_id: row.connection_id as string,
    account_email: row.account_email as string,
    sender: (row.sender as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    email_date: (row.email_date as string | null) ?? null,
    received_at: row.received_at as string,
    // Rows written before migration 006 was backfilled read as unknown rather
    // than as a missing field the clients would have to guess at.
    verdict: ((row.verdict as ImportVerdict | null) ?? 'unknown') as ImportVerdict,
    attempts: Number(row.attempts ?? 0),
    transaction: row.transaction_id
      ? {
          id: row.transaction_id as string,
          description: row.transaction_description as string,
          amount: Number(row.transaction_amount),
          currency: row.transaction_currency as string,
        }
      : null,
  }
}

export async function listEmailLog(
  db: Queryable,
  userId: string,
  page: { limit: number; offset: number },
): Promise<EmailLogItem[]> {
  const result = await db.query(EMAIL_LOG_SELECT, [userId, page.limit, page.offset])
  return result.rows.map(toEmailLogItem)
}

export async function countEmailLog(db: Queryable, userId: string): Promise<number> {
  const result = await db.query(
    `SELECT count(*)::int AS count
       FROM import_source
       JOIN connection ON connection.id = import_source.connection_id
      WHERE connection.user_id = $1`,
    [userId],
  )
  return Number(result.rows[0]?.count ?? 0)
}
