import type { gmail_v1 } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import type { VersionedKey } from './crypto.js'
import { decryptSecret } from './crypto.js'
import {
  clearExpiredEmailMetadata,
  listRetryableMessageIds,
  recordImportSource,
  shouldSkipMessage,
} from './importSource.js'
import type { ImportFailure } from './notifyImportFailures.js'
import {
  listActiveGmailConnections,
  setConnectionCursor,
  setConnectionStatus,
  type Connection,
} from './queries.js'

const POLL_LOCK_ID = 727401

// GMAIL_POLL_INTERVAL_MS defaults to a minute, and nothing in the data model
// gates a repeated import-failure alert the way the connection status gates the
// disconnect alert. Without this cooldown an hour-long provider outage on a busy
// inbox would send up to sixty messages. Deliberately in memory and so
// best-effort: it resets on restart, which is cheaper than a schema column for
// throttling state.
const FAILURE_ALERT_COOLDOWN_SECONDS = 3600
const lastFailureAlertAtSeconds = new Map<string, number>()

// Exported for tests: module state would otherwise leak between them.
export function resetImportFailureAlerts(): void {
  lastFailureAlertAtSeconds.clear()
}

function claimFailureAlertSlot(connectionId: string, nowSeconds: number): boolean {
  const lastSentAt = lastFailureAlertAtSeconds.get(connectionId)
  if (lastSentAt !== undefined && nowSeconds - lastSentAt < FAILURE_ALERT_COOLDOWN_SECONDS) {
    return false
  }
  // Claimed on the attempt, not on success: the notifier never throws, so
  // "attempted" is the only thing this side can observe.
  lastFailureAlertAtSeconds.set(connectionId, nowSeconds)
  return true
}

interface PoolClientLike extends Queryable {
  release: () => void
}

export interface ConnectionPollerDeps {
  pool: { connect: () => Promise<PoolClientLike> }
  db: Queryable
  keys: VersionedKey[]
  buildGmail: (refreshToken: string) => gmail_v1.Gmail
  listSince: (gmail: gmail_v1.Gmail, afterEpochSeconds: string) => Promise<string[]>
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
    importContext: { userId: string; connectionId: string },
  ) => Promise<void>
  notifyGmailConnectionLost: (connection: Connection) => Promise<void>
  notifyImportFailures: (connection: Connection, failures: ImportFailure[]) => Promise<void>
  nowSeconds: () => string
}

function isAuthError(error: unknown): boolean {
  const status =
    (error as { status?: number; code?: number }).status ??
    (error as { code?: number }).code
  const message = error instanceof Error ? error.message : String(error)
  return status === 401 || /invalid_grant/i.test(message)
}

// Keep the oldest connections within each user's tier cap active; billing is
// out of scope, so this UPDATE is the only downgrade enforcement actor.
const DOWNGRADE_SQL = `
  WITH ranked AS (
    SELECT connection.id,
           row_number() OVER (PARTITION BY connection.user_id ORDER BY connection.created_at) AS position,
           CASE WHEN account_owner.is_premium THEN 5 ELSE 1 END AS cap
      FROM connection
      JOIN "user" account_owner ON account_owner.id = connection.user_id
     WHERE connection.provider = 'gmail' AND connection.status = 'active'
  )
  UPDATE connection SET updated_at = now(), status = 'disabled'
   WHERE id IN (SELECT id FROM ranked WHERE position > cap)`

export async function pollConnectionsOnce(deps: ConnectionPollerDeps): Promise<void> {
  const lockClient = await deps.pool.connect()
  try {
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS acquired', [POLL_LOCK_ID])
    if (!lock.rows[0]?.acquired) return

    await deps.db.query(DOWNGRADE_SQL)
    // Cheap and idempotent, so it rides along with the cycle rather than
    // needing a scheduler of its own. Housekeeping must never cost the cycle its
    // imports, so a statement timeout or a lock on it is logged and stepped over.
    try {
      await clearExpiredEmailMetadata(deps.db)
    } catch (error) {
      console.error('Clearing expired email metadata failed (continuing):', error)
    }
    const connections = await listActiveGmailConnections(deps.db)

    for (const connection of connections) {
      try {
        await pollOneConnection(connection, deps)
      } catch (error) {
        if (isAuthError(error)) {
          // Status first: a Telegram outage must never leave a dead token
          // marked active, or the poller retries it forever.
          await setConnectionStatus(deps.db, connection.id, 'needs_reauth')
          console.error(`Connection ${connection.id} needs re-auth:`, error)
          try {
            await deps.notifyGmailConnectionLost(connection)
          } catch (notifyError) {
            console.error(`Failed to alert about connection ${connection.id}:`, notifyError)
          }
        } else {
          console.error(`Connection ${connection.id} poll failed (will retry):`, error)
        }
      }
    }
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [POLL_LOCK_ID])
    } catch {
      // The lock dies with the session either way.
    }
    lockClient.release()
  }
}

async function pollOneConnection(
  connection: Connection & { secret_encrypted: Buffer },
  deps: ConnectionPollerDeps,
): Promise<void> {
  if (!connection.cursor) {
    await setConnectionCursor(deps.db, connection.id, deps.nowSeconds())
    return
  }
  const refreshToken = decryptSecret(
    connection.secret_encrypted,
    connection.key_version ?? 0,
    deps.keys,
    `${connection.user_id}:${connection.external_id}`,
  )
  const gmail = deps.buildGmail(refreshToken)
  // Retries work by message id, independent of the cursor, so the two lists
  // merge into the one loop. Retried messages are older than the cursor and the
  // "only advance if greater" comparison below keeps them from dragging it back.
  const listedMessageIds = await deps.listSince(gmail, connection.cursor)
  const retryableMessageIds = await listRetryableMessageIds(deps.db, connection.id)
  const messageIds = [...new Set([...listedMessageIds, ...retryableMessageIds])]

  let maxInternalDateSeconds = connection.cursor
  const failures: ImportFailure[] = []

  for (const messageId of messageIds) {
    // The per-message catch below is what keeps one bad email from aborting the
    // batch, but an auth error is rethrown from it untouched: a Gmail 401
    // mid-batch has to keep reaching the isAuthError handler in
    // pollConnectionsOnce, or the connection never flips to needs_reauth and the
    // user gets import-failure alerts every cycle instead of the reconnect one.
    let parsed: { subject: string; text: string; sender: string | null; internalDateSeconds: string }
    try {
      // Ask before fetching, not only inside processEmail. Gmail's after: query
      // is inclusive at the boundary second, so the newest already-imported
      // message comes back every cycle: a transient fetch error on it would
      // otherwise record a failure over its imported row and have the retry
      // import the same email twice. It also stops a permanently unfetchable
      // message from burning a fetch and an alert on every cycle forever.
      if (await shouldSkipMessage(deps.db, connection.id, messageId)) continue
      const rawMessage = await deps.fetchMessage(gmail, messageId)
      parsed = deps.parseMessage(rawMessage)
    } catch (error) {
      if (isAuthError(error)) throw error
      console.error(`Could not read message ${messageId} of connection ${connection.id}:`, error)
      // Nothing was parsed, so there is no sender or subject to record. The row
      // still goes in, so the email appears in the Inbox instead of vanishing.
      failures.push({ sender: null, subject: null })
      try {
        await recordImportSource(deps.db, connection.id, messageId, { verdict: 'failed' })
      } catch (recordError) {
        console.error(`Failed to record a failure for message ${messageId}:`, recordError)
      }
      // No parsed date, so this message cannot move the cursor either way.
      continue
    }

    let rowRecorded = false
    try {
      await deps.importEmail(
        {
          subject: parsed.subject,
          text: parsed.text,
          messageId,
          sender: parsed.sender,
          emailDateSeconds: parsed.internalDateSeconds,
        },
        { userId: connection.user_id, connectionId: connection.id },
      )
      rowRecorded = true
    } catch (error) {
      if (isAuthError(error)) throw error
      console.error(`Import of message ${messageId} failed:`, error)
      failures.push({ sender: parsed.sender, subject: parsed.subject })
      // processEmail already wrote its own 'failed' row; writing another here
      // would spend two of the three attempts on one real attempt. Whether that
      // write landed is not observable from here, so this message contributes
      // nothing to the cursor. A newer message in the same batch can still carry
      // the cursor past it, which is what the row and the retry-by-id list are
      // for: they, not the cursor, are what keep a failed email reachable.
    }

    if (rowRecorded && Number(parsed.internalDateSeconds) > Number(maxInternalDateSeconds)) {
      maxInternalDateSeconds = parsed.internalDateSeconds
    }
  }

  if (maxInternalDateSeconds !== connection.cursor) {
    await setConnectionCursor(deps.db, connection.id, maxInternalDateSeconds)
  }

  // One message per connection per cycle, and at most one per hour. State
  // first, then notify, as with the disconnect alert.
  if (failures.length > 0 && claimFailureAlertSlot(connection.id, Number(deps.nowSeconds()))) {
    try {
      await deps.notifyImportFailures(connection, failures)
    } catch (error) {
      console.error(`Failed to alert about failed imports on ${connection.id}:`, error)
    }
  }
}

export function startConnectionPolling(deps: ConnectionPollerDeps, intervalMs: number): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      await pollConnectionsOnce(deps)
    } catch (error) {
      console.error('Connection poll cycle failed:', error)
    }
    if (!stopped) setTimeout(tick, intervalMs)
  }
  void tick()
  return () => {
    stopped = true
  }
}
