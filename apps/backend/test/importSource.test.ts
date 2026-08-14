import { describe, it, expect, vi } from 'vitest'
import {
  clearExpiredEmailMetadata,
  countEmailLog,
  listEmailLog,
  listRetryableMessageIds,
  recordImportSource,
  shouldSkipMessage,
} from '../src/connections/importSource.js'

describe('import source dedupe', () => {
  it('skips a message that already has a row', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ verdict: 'imported', attempts: 1 }] }) }
    expect(await shouldSkipMessage(db, 'conn-1', 'msg-9')).toBe(true)
    expect(db.query.mock.calls[0][1]).toEqual(['conn-1', 'msg-9'])
  })

  it('does not skip a message with no row', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    expect(await shouldSkipMessage(db, 'conn-1', 'msg-9')).toBe(false)
  })

  it('does not skip a failed row below the attempt limit', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ verdict: 'failed', attempts: 2 }] }) }
    expect(await shouldSkipMessage(db, 'conn-1', 'msg-9')).toBe(false)
  })

  it('skips a failed row that exhausted its attempts', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ verdict: 'failed', attempts: 3 }] }) }
    expect(await shouldSkipMessage(db, 'conn-1', 'msg-9')).toBe(true)
  })
})

describe('recordImportSource', () => {
  it('writes the verdict and the descriptive columns', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await recordImportSource(db, 'conn-1', 'msg-9', {
      verdict: 'imported',
      transactionId: 'tx-1',
      sender: 'Bank <no-reply@bank.com>',
      subject: 'Consumo',
      emailDateSeconds: '1690000100',
    })
    const [insertSql, params] = db.query.mock.calls[0]
    expect(insertSql).toMatch(/ON CONFLICT/i)
    expect(params).toEqual([
      'conn-1',
      'msg-9',
      'tx-1',
      'Bank <no-reply@bank.com>',
      'Consumo',
      '1690000100',
      'imported',
    ])
  })

  it('increments attempts on a retry instead of leaving the row untouched', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await recordImportSource(db, 'conn-1', 'msg-9', { verdict: 'failed' })
    const [insertSql, params] = db.query.mock.calls[0]
    expect(insertSql).toMatch(/DO UPDATE/i)
    expect(insertSql).toMatch(/attempts\s*=\s*import_source\.attempts\s*\+\s*1/i)
    // A successful import is final: nothing may downgrade it to a failure and
    // make it eligible for a retry that would import the email a second time.
    expect(insertSql).toMatch(/WHERE import_source\.verdict IS DISTINCT FROM 'imported'/i)
    expect(params).toEqual(['conn-1', 'msg-9', null, null, null, null, 'failed'])
  })
})

describe('listRetryableMessageIds', () => {
  it('returns the failed message ids below the attempt limit', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ message_id: 'msg-1' }] }) }
    expect(await listRetryableMessageIds(db, 'conn-1')).toEqual(['msg-1'])
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/verdict = 'failed'/)
    expect(sql).toMatch(/attempts < 3/)
    expect(params).toEqual(['conn-1'])
  })
})

describe('clearExpiredEmailMetadata', () => {
  it('clears sender and subject past the retention window and leaves the rest intact', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await clearExpiredEmailMetadata(db)
    const [sql] = db.query.mock.calls[0]
    expect(sql).toMatch(/SET sender = NULL, subject = NULL/i)
    expect(sql).toMatch(/interval '30 days'/)
    expect(sql).not.toMatch(/verdict\s*=/i)
    expect(sql).not.toMatch(/DELETE/i)
  })
})

describe('email log listing', () => {
  it('scopes the listing to the session user and paginates', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await listEmailLog(db, 'user-1', { limit: 50, offset: 10 })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toMatch(/connection\.user_id = \$1/)
    expect(sql).toMatch(/ORDER BY import_source\.created_at DESC/)
    expect(params).toEqual(['user-1', 50, 10])
  })

  it('maps an imported row to its transaction', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            message_id: 'msg-1',
            connection_id: 'conn-1',
            account_email: 'a@gmail.com',
            sender: 'Bank <no-reply@bank.com>',
            subject: 'Consumo',
            email_date: '2026-08-01T10:00:00.000Z',
            received_at: '2026-08-01T10:00:05.000Z',
            verdict: 'imported',
            attempts: 1,
            transaction_id: 'tx-1',
            transaction_description: 'PLIN',
            transaction_amount: -35,
            transaction_currency: 'PEN',
          },
        ],
      }),
    }
    const items = await listEmailLog(db, 'user-1', { limit: 50, offset: 0 })
    expect(items[0]).toEqual({
      message_id: 'msg-1',
      connection_id: 'conn-1',
      account_email: 'a@gmail.com',
      sender: 'Bank <no-reply@bank.com>',
      subject: 'Consumo',
      email_date: '2026-08-01T10:00:00.000Z',
      received_at: '2026-08-01T10:00:05.000Z',
      verdict: 'imported',
      attempts: 1,
      transaction: { id: 'tx-1', description: 'PLIN', amount: -35, currency: 'PEN' },
    })
  })

  it('renders an orphaned imported row with no transaction and a backfilled row as unknown', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            message_id: 'msg-2',
            connection_id: 'conn-1',
            account_email: 'a@gmail.com',
            sender: null,
            subject: null,
            email_date: null,
            received_at: '2026-07-01T10:00:05.000Z',
            verdict: null,
            attempts: 0,
            transaction_id: null,
          },
        ],
      }),
    }
    const items = await listEmailLog(db, 'user-1', { limit: 50, offset: 0 })
    expect(items[0].transaction).toBeNull()
    expect(items[0].verdict).toBe('unknown')
  })

  it('counts the rows for the session user', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ count: 7 }] }) }
    expect(await countEmailLog(db, 'user-1')).toBe(7)
    expect(db.query.mock.calls[0][1]).toEqual(['user-1'])
  })
})
