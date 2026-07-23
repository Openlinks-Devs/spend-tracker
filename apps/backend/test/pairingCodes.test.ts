import { describe, it, expect, vi } from 'vitest'
import { mintPairingCode, consumePairingCode } from '../src/connections/pairingCodes.js'

describe('pairing codes', () => {
  it('mints a >=128-bit base64url code bound to the user and purpose', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const code = await mintPairingCode(db, 'user-1', 'telegram_pair')
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(code.length).toBeGreaterThanOrEqual(22)
    const [insertSql, params] = db.query.mock.calls[0]
    expect(insertSql).toMatch(/INSERT INTO pairing_code/i)
    expect(params).toEqual([code, 'user-1', 'telegram_pair'])
  })

  it('consume uses one atomic UPDATE guarded on consumed_at and expiry', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ user_id: 'user-1' }] }) }
    const userId = await consumePairingCode(db, 'code-abc', 'gmail_oauth')
    expect(userId).toBe('user-1')
    const [updateSql] = db.query.mock.calls[0]
    expect(updateSql).toMatch(/UPDATE pairing_code SET consumed_at = now\(\)/i)
    expect(updateSql).toMatch(/consumed_at IS NULL/i)
    expect(updateSql).toMatch(/expires_at > now\(\)/i)
    expect(updateSql).toMatch(/RETURNING user_id/i)
  })

  it('consume returns null when no row matches (expired, used, or unknown)', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    expect(await consumePairingCode(db, 'stale', 'gmail_oauth')).toBeNull()
  })
})
