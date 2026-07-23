import type { Queryable } from '../db/pool.js'

export interface Connection {
  id: string
  user_id: string
  provider: 'gmail' | 'telegram'
  status: 'active' | 'needs_reauth' | 'disabled'
  external_id: string
  key_version: number | null
  cursor: string | null
  created_at: string
}

const PUBLIC_COLUMNS = 'id, user_id, provider, status, external_id, key_version, cursor, created_at'

export function gmailLimitFor(isPremium: boolean): number {
  return isPremium ? 5 : 1
}

export async function listConnections(db: Queryable, userId: string): Promise<Connection[]> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM connection WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  )
  return result.rows as Connection[]
}

export async function getConnectionById(
  db: Queryable,
  userId: string,
  id: string,
): Promise<(Connection & { secret_encrypted: Buffer | null }) | null> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, secret_encrypted FROM connection WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return result.rows.length ? (result.rows[0] as Connection & { secret_encrypted: Buffer | null }) : null
}

// All non-removed gmail rows count toward the limit regardless of status, so a
// dead connection still occupies a slot until explicitly removed.
export async function countGmailConnections(db: Queryable, userId: string): Promise<number> {
  const result = await db.query(
    `SELECT count(*)::int AS count FROM connection WHERE user_id = $1 AND provider = 'gmail'`,
    [userId],
  )
  return Number(result.rows[0].count)
}

export async function upsertGmailConnection(
  db: Queryable,
  userId: string,
  email: string,
  secretBlob: Buffer,
  keyVersion: number,
): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO connection (user_id, provider, status, external_id, secret_encrypted, key_version)
     VALUES ($1, 'gmail', 'active', $2, $3, $4)
     ON CONFLICT (user_id, provider, external_id)
     DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted,
                   key_version = EXCLUDED.key_version,
                   status = 'active',
                   updated_at = now()
     RETURNING id`,
    [userId, email, secretBlob, keyVersion],
  )
  return { id: result.rows[0].id as string }
}

// Exactly one telegram connection per user: pairing replaces any prior chat.
export async function replaceTelegramConnection(
  db: Queryable,
  userId: string,
  chatId: string,
): Promise<{ id: string }> {
  const result = await db.query(
    `WITH removed AS (
       DELETE FROM connection WHERE user_id = $1 AND provider = 'telegram'
     )
     INSERT INTO connection (user_id, provider, status, external_id)
     VALUES ($1, 'telegram', 'active', $2)
     RETURNING id`,
    [userId, chatId],
  )
  return { id: result.rows[0].id as string }
}

export async function getTelegramConnectionByChatId(
  db: Queryable,
  chatId: string,
): Promise<Connection | null> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM connection WHERE provider = 'telegram' AND external_id = $1`,
    [chatId],
  )
  return result.rows.length ? (result.rows[0] as Connection) : null
}

export async function getTelegramConnectionForUser(
  db: Queryable,
  userId: string,
): Promise<Connection | null> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM connection
      WHERE user_id = $1 AND provider = 'telegram' AND status = 'active'`,
    [userId],
  )
  return result.rows.length ? (result.rows[0] as Connection) : null
}

export async function deleteConnection(db: Queryable, userId: string, id: string): Promise<boolean> {
  const result = await db.query(
    'DELETE FROM connection WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId],
  )
  return result.rows.length > 0
}

export async function setConnectionStatus(
  db: Queryable,
  connectionId: string,
  status: Connection['status'],
): Promise<void> {
  await db.query('UPDATE connection SET status = $2, updated_at = now() WHERE id = $1', [
    connectionId,
    status,
  ])
}

export async function setConnectionCursor(
  db: Queryable,
  connectionId: string,
  cursor: string,
): Promise<void> {
  await db.query('UPDATE connection SET cursor = $2, updated_at = now() WHERE id = $1', [
    connectionId,
    cursor,
  ])
}

export async function listActiveGmailConnections(
  db: Queryable,
): Promise<Array<Connection & { secret_encrypted: Buffer }>> {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, secret_encrypted FROM connection
      WHERE provider = 'gmail' AND status = 'active' ORDER BY created_at`,
  )
  return result.rows as Array<Connection & { secret_encrypted: Buffer }>
}

export async function getUserIsPremium(db: Queryable, userId: string): Promise<boolean> {
  const result = await db.query('SELECT is_premium FROM "user" WHERE id = $1', [userId])
  return Boolean(result.rows[0]?.is_premium)
}
