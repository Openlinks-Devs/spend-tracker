import type { Queryable } from '../db/pool.js'
import {
  getAccounts,
  getCategories,
  getDistinctTags,
  insertTransaction,
  type TransactionalPool,
} from '../db/queries.js'
import { detectTransaction } from '../ai/detect.js'
import { extractTransaction } from '../ai/extract.js'
import { formatNewTransaction } from '../telegram/format.js'
import { recordImportSource, shouldSkipMessage } from '../connections/importSource.js'

export interface ImportedEmail {
  subject: string
  text: string
  messageId: string
  // Both are null when the poller could not parse the message, and on the
  // Telegram-driven paths that reuse this pipeline.
  sender?: string | null
  emailDateSeconds?: string | null
}

export interface ProcessDeps {
  db: Queryable
  // A transactional pool so the transaction insert and its import_source dedupe
  // row land atomically, mirroring createTransfer in db/queries.ts.
  pool: TransactionalPool
  now: () => string
  detect: typeof detectTransaction
  extract: typeof extractTransaction
  // Already chat-resolved by the caller (the poller builds it per connection);
  // a no-op when the owner has no Telegram connection.
  notify: (text: string) => Promise<void>
}

// The static AI/time deps that every import shares. The per-connection deps
// (db, pool, notify) are supplied by the caller because they vary per user.
export const defaultProcessDeps: Pick<ProcessDeps, 'now' | 'detect' | 'extract'> = {
  now: () => new Date().toISOString(),
  detect: detectTransaction,
  extract: extractTransaction,
}

// The import runs server-side with no session, so the caller passes the owner
// user id and the source connection explicitly. Per-user connections supply
// these from the linked account (see
// docs/superpowers/specs/2026-07-17-per-user-connections-design.md).
export async function processEmail(
  email: ImportedEmail,
  importContext: { userId: string; connectionId: string },
  deps: ProcessDeps,
): Promise<void> {
  const { userId, connectionId } = importContext
  // Every exit path names its verdict, so the Inbox can say what happened
  // instead of showing the same shapeless row for every unsuccessful outcome.
  const describedEmail = {
    sender: email.sender ?? null,
    subject: email.subject,
    emailDateSeconds: email.emailDateSeconds ?? null,
  }

  // Dedupe before any AI work: a crash-replay must cost no tokens and send no
  // duplicate notification. A failed row with attempts left is not a skip: it
  // is this cycle's retry.
  if (await shouldSkipMessage(deps.db, connectionId, email.messageId)) return

  try {
    const isTransaction = await deps.detect({ subject: email.subject, text: email.text })
    if (!isTransaction) {
      await recordImportSource(deps.db, connectionId, email.messageId, {
        ...describedEmail,
        verdict: 'not_transaction',
      })
      return
    }

    const [categories, accounts, tags] = await Promise.all([
      getCategories(deps.db, userId),
      getAccounts(deps.db, userId),
      getDistinctTags(deps.db, userId),
    ])

    // Onboarding guard: with no accounts or categories nothing can be
    // attributed; record the message so it is never retried, and skip without
    // error.
    if (accounts.length === 0 || categories.length === 0) {
      await recordImportSource(deps.db, connectionId, email.messageId, {
        ...describedEmail,
        verdict: 'not_configured',
      })
      return
    }

    const extracted = await deps.extract({
      text: email.text,
      categories,
      accounts,
      tags,
      now: deps.now(),
    })

    if (!extracted) {
      await recordImportSource(deps.db, connectionId, email.messageId, {
        ...describedEmail,
        verdict: 'extract_failed',
      })
      return
    }

    // Insert transaction + log row atomically, mirroring createTransfer's
    // client/BEGIN/COMMIT pattern in db/queries.ts.
    const client = await deps.pool.connect()
    let insertedId: string
    try {
      await client.query('BEGIN')
      const inserted = await insertTransaction(client, userId, extracted)
      insertedId = inserted.id
      await recordImportSource(client, connectionId, email.messageId, {
        ...describedEmail,
        verdict: 'imported',
        transactionId: inserted.id,
      })
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    const account = accounts.find((candidate) => candidate.id === extracted.account_id)
    const category = categories.find((candidate) => candidate.id === extracted.category_id)
    try {
      await deps.notify(
        formatNewTransaction({
          id: insertedId,
          description: extracted.description,
          accountName: account?.name ?? extracted.account_id,
          categoryName: category?.name ?? extracted.category_id,
          tags: extracted.tags,
          currency: extracted.currency,
          amount: extracted.amount,
          created_at: extracted.created_at,
        }),
      )
    } catch (error) {
      console.error('Import notify failed (import kept):', error)
    }
  } catch (error) {
    // Leave a row, then rethrow so the poller can hold the cursor back and
    // alert. Without the row the email would vanish with no trace at all, which
    // is the bug this log exists to fix. A failure to write the row must not
    // mask the original error.
    try {
      await recordImportSource(deps.db, connectionId, email.messageId, {
        ...describedEmail,
        verdict: 'failed',
      })
    } catch (recordError) {
      console.error('Failed to record an import failure:', recordError)
    }
    throw error
  }
}
