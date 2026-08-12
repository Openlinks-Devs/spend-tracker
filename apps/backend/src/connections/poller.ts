import type { gmail_v1 } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import type { VersionedKey } from './crypto.js'
import { decryptSecret } from './crypto.js'
import {
  listActiveGmailConnections,
  setConnectionCursor,
  setConnectionStatus,
  type Connection,
} from './queries.js'

const POLL_LOCK_ID = 727401

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
  parseMessage: (message: unknown) => { subject: string; text: string; internalDateSeconds: string }
  importEmail: (
    email: { subject: string; text: string; messageId: string },
    importContext: { userId: string; connectionId: string },
  ) => Promise<void>
  notifyGmailConnectionLost: (connection: Connection) => Promise<void>
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
  const messageIds = await deps.listSince(gmail, connection.cursor)

  let maxInternalDateSeconds = connection.cursor
  for (const messageId of messageIds) {
    const rawMessage = await deps.fetchMessage(gmail, messageId)
    const parsed = deps.parseMessage(rawMessage)
    await deps.importEmail(
      { subject: parsed.subject, text: parsed.text, messageId },
      { userId: connection.user_id, connectionId: connection.id },
    )
    if (Number(parsed.internalDateSeconds) > Number(maxInternalDateSeconds)) {
      maxInternalDateSeconds = parsed.internalDateSeconds
    }
  }
  if (maxInternalDateSeconds !== connection.cursor) {
    await setConnectionCursor(deps.db, connection.id, maxInternalDateSeconds)
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
