import type { Queryable } from '../db/pool.js'

export async function hasImportSource(
  db: Queryable,
  connectionId: string,
  messageId: string,
): Promise<boolean> {
  const result = await db.query(
    'SELECT 1 FROM import_source WHERE connection_id = $1 AND message_id = $2',
    [connectionId, messageId],
  )
  return result.rows.length > 0
}

export async function recordImportSource(
  db: Queryable,
  connectionId: string,
  messageId: string,
  transactionId: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO import_source (connection_id, message_id, transaction_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (connection_id, message_id) DO NOTHING`,
    [connectionId, messageId, transactionId],
  )
}
