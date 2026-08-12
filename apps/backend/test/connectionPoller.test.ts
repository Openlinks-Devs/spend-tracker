import { describe, it, expect, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { pollConnectionsOnce } from '../src/connections/poller.js'
import { parseEncryptionKeys, encryptSecret } from '../src/connections/crypto.js'

const keys = parseEncryptionKeys(`1:${randomBytes(32).toString('base64')}`)

function encryptedConnection(id: string, userId: string, email: string, cursor: string | null) {
  const { blob, keyVersion } = encryptSecret(`token-${id}`, keys, `${userId}:${email}`)
  return {
    id, user_id: userId, provider: 'gmail', status: 'active', external_id: email,
    key_version: keyVersion, cursor, created_at: 'now', secret_encrypted: blob,
  }
}

function fakeLockClient(acquired: boolean) {
  return {
    query: vi.fn(async (sql: string) =>
      /pg_try_advisory_lock/.test(sql) ? { rows: [{ acquired }] } : { rows: [] }),
    release: vi.fn(),
  }
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const lockClient = fakeLockClient(true)
  return {
    lockClient,
    deps: {
      pool: { connect: vi.fn().mockResolvedValue(lockClient) },
      db: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      keys,
      buildGmail: vi.fn().mockReturnValue({}),
      listSince: vi.fn().mockResolvedValue([]),
      fetchMessage: vi.fn(),
      parseMessage: vi.fn(),
      importEmail: vi.fn().mockResolvedValue(undefined),
      notifyGmailConnectionLost: vi.fn().mockResolvedValue(undefined),
      nowSeconds: () => '1700000000',
      ...overrides,
    },
  }
}

describe('connection poller', () => {
  it('skips the whole tick when the advisory lock is not acquired', async () => {
    const lockClient = fakeLockClient(false)
    const { deps } = baseDeps({ pool: { connect: vi.fn().mockResolvedValue(lockClient) } })
    await pollConnectionsOnce(deps as never)
    expect(deps.db.query).not.toHaveBeenCalled()
    expect(lockClient.release).toHaveBeenCalled()
  })

  it('first run stores a now cursor and imports nothing', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', null)
    const { deps } = baseDeps()
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [connection] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.listSince).not.toHaveBeenCalled()
    const cursorCall = deps.db.query.mock.calls.find(([sql]) => /SET cursor/.test(sql))
    expect(cursorCall[1]).toEqual(['conn-1', '1700000000'])
  })

  it('imports each new message for the connection user and advances the cursor to max internalDate', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi.fn().mockResolvedValue(['m1', 'm2']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi
        .fn()
        .mockReturnValueOnce({ subject: 's1', text: 't1', internalDateSeconds: '1690000100' })
        .mockReturnValueOnce({ subject: 's2', text: 't2', internalDateSeconds: '1690000050' }),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [connection] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.listSince).toHaveBeenCalledWith({}, '1690000000')
    expect(deps.importEmail).toHaveBeenCalledTimes(2)
    expect(deps.importEmail.mock.calls[0][1]).toEqual({ userId: 'user-1', connectionId: 'conn-1' })
    const cursorCall = deps.db.query.mock.calls.find(([sql]) => /SET cursor/.test(sql))
    expect(cursorCall[1]).toEqual(['conn-1', '1690000100'])
  })

  it('flips only the failing connection to needs_reauth on invalid_grant and continues', async () => {
    const failing = encryptedConnection('conn-bad', 'user-1', 'bad@gmail.com', '1690000000')
    const healthy = encryptedConnection('conn-ok', 'user-2', 'ok@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('invalid_grant'), { status: 400 }))
        .mockResolvedValueOnce([]),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [failing, healthy] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    const statusCall = deps.db.query.mock.calls.find(([sql]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['conn-bad', 'needs_reauth'])
    expect(deps.listSince).toHaveBeenCalledTimes(2)
  })

  it('alerts the user when a connection breaks', async () => {
    const failing = encryptedConnection('conn-bad', 'user-1', 'bad@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi.fn().mockRejectedValue(Object.assign(new Error('invalid_grant'), { status: 400 })),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [failing] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.notifyGmailConnectionLost).toHaveBeenCalledTimes(1)
    expect(deps.notifyGmailConnectionLost.mock.calls[0][0].id).toBe('conn-bad')
    expect(deps.notifyGmailConnectionLost.mock.calls[0][0].external_id).toBe('bad@gmail.com')
    // The status must be written before the alert goes out: a Telegram outage
    // must never leave a dead token marked active.
    const statusCall = deps.db.query.mock.calls.find(([sql]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['conn-bad', 'needs_reauth'])
    expect(deps.db.query.mock.invocationCallOrder.at(-1)).toBeLessThan(
      deps.notifyGmailConnectionLost.mock.invocationCallOrder[0],
    )
  })

  it('does not alert on a transient failure', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi.fn().mockRejectedValue(Object.assign(new Error('socket hang up'), { status: 503 })),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [connection] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.notifyGmailConnectionLost).not.toHaveBeenCalled()
    const statusCall = deps.db.query.mock.calls.find(([sql]) => /SET status/.test(sql))
    expect(statusCall).toBeUndefined()
  })

  it('keeps polling the remaining connections when the alert throws', async () => {
    const failing = encryptedConnection('conn-bad', 'user-1', 'bad@gmail.com', '1690000000')
    const healthy = encryptedConnection('conn-ok', 'user-2', 'ok@gmail.com', '1690000000')
    const { deps } = baseDeps({
      listSince: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('invalid_grant'), { status: 400 }))
        .mockResolvedValueOnce([]),
      notifyGmailConnectionLost: vi.fn().mockRejectedValue(new Error('telegram is down')),
    })
    deps.db.query = vi.fn(async (sql: string) =>
      /FROM connection/.test(sql) ? { rows: [failing, healthy] } : { rows: [] })
    await pollConnectionsOnce(deps as never)
    expect(deps.listSince).toHaveBeenCalledTimes(2)
  })
})
