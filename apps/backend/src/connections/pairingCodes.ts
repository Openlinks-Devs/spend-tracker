import { randomBytes } from 'node:crypto'
import type { Queryable } from '../db/pool.js'

export type PairingPurpose = 'gmail_oauth' | 'telegram_pair'

const CODE_TTL_MINUTES = 10

// 24 random bytes = 192 bits, base64url (32 chars): fits Telegram's 64-char
// /start payload and exceeds the 128-bit floor from the spec.
export async function mintPairingCode(
  db: Queryable,
  userId: string,
  purpose: PairingPurpose,
): Promise<string> {
  const code = randomBytes(24).toString('base64url')
  await db.query(
    `INSERT INTO pairing_code (code, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + interval '${CODE_TTL_MINUTES} minutes')`,
    [code, userId, purpose],
  )
  return code
}

// Atomic single-use consumption: the WHERE guards make a concurrent second
// redeem return zero rows, closing the double-redeem race.
export async function consumePairingCode(
  db: Queryable,
  code: string,
  purpose: PairingPurpose,
): Promise<string | null> {
  const result = await db.query(
    `UPDATE pairing_code SET consumed_at = now()
      WHERE code = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [code, purpose],
  )
  return result.rows.length ? (result.rows[0].user_id as string) : null
}

export async function purgeExpiredPairingCodes(db: Queryable): Promise<void> {
  await db.query('DELETE FROM pairing_code WHERE expires_at < now() OR consumed_at IS NOT NULL')
}
