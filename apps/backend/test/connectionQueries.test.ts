import { describe, it, expect, vi } from 'vitest'
import {
  countGmailConnections,
  gmailLimitFor,
  listConnections,
  replaceTelegramConnection,
  upsertGmailConnection,
} from '../src/connections/queries.js'

describe('connection queries', () => {
  it('lists only the user connections and never selects the secret', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await listConnections(db, 'user-1')
    const [listSql, params] = db.query.mock.calls[0]
    expect(listSql).toMatch(/WHERE user_id = \$1/)
    expect(listSql).not.toMatch(/secret_encrypted/)
    expect(params).toEqual(['user-1'])
  })

  it('upsertGmailConnection replaces the token and reactivates on conflict', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'conn-1' }] }) }
    await upsertGmailConnection(db, 'user-1', 'a@gmail.com', Buffer.from('blob'), 2)
    const [upsertSql, params] = db.query.mock.calls[0]
    expect(upsertSql).toMatch(/ON CONFLICT \(user_id, provider, external_id\)/i)
    expect(upsertSql).toMatch(/status = 'active'/)
    expect(params[0]).toBe('user-1')
    expect(params[1]).toBe('a@gmail.com')
  })

  it('replaceTelegramConnection deletes the old row and inserts in one statement', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'conn-2' }] }) }
    await replaceTelegramConnection(db, 'user-1', 'chat-99')
    const [replaceSql] = db.query.mock.calls[0]
    expect(replaceSql).toMatch(/WITH removed AS \(/i)
    expect(replaceSql).toMatch(/DELETE FROM connection/i)
    expect(replaceSql).toMatch(/INSERT INTO connection/i)
  })

  it('counts gmail connections regardless of status', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ count: '3' }] }) }
    expect(await countGmailConnections(db, 'user-1')).toBe(3)
    const [countSql] = db.query.mock.calls[0]
    expect(countSql).not.toMatch(/status/)
  })

  it('gmailLimitFor returns 1 free and 5 premium', () => {
    expect(gmailLimitFor(false)).toBe(1)
    expect(gmailLimitFor(true)).toBe(5)
  })
})
