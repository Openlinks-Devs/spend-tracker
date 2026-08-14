import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { pollConnectionsOnce, resetImportFailureAlerts } from '../src/connections/poller.js'
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

// A db mock that answers the connection listing, the retry listing and the
// per-message skip check, and returns nothing for every write.
function fakeDb(
  connections: unknown[],
  retryableMessageIds: string[] = [],
  importedMessageIds: string[] = [],
) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM connection\b/.test(sql) && /secret_encrypted/.test(sql)) return { rows: connections }
      if (/FROM import_source/.test(sql) && /verdict = 'failed'/.test(sql)) {
        return { rows: retryableMessageIds.map((messageId) => ({ message_id: messageId })) }
      }
      if (/SELECT verdict, attempts FROM import_source/.test(sql)) {
        return importedMessageIds.includes(params?.[1] as string)
          ? { rows: [{ verdict: 'imported', attempts: 1 }] }
          : { rows: [] }
      }
      return { rows: [] }
    }),
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
      notifyImportFailures: vi.fn().mockResolvedValue(undefined),
      nowSeconds: () => '1700000000',
      ...overrides,
    },
  }
}

function parsedMessage(subject: string, internalDateSeconds: string, sender = 'Bank <bank@x.com>') {
  return { subject, text: `body of ${subject}`, sender, internalDateSeconds }
}

function cursorParams(db: { query: { mock: { calls: unknown[][] } } }): unknown {
  return db.query.mock.calls.find(([sql]) => /SET cursor/.test(sql as string))?.[1]
}

function recordedFailures(db: { query: { mock: { calls: unknown[][] } } }): unknown[][] {
  return db.query.mock.calls
    .filter(([sql]) => /INSERT INTO import_source/i.test(sql as string))
    .map((call) => call[1] as unknown[])
}

beforeEach(() => {
  resetImportFailureAlerts()
})

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
    const { deps } = baseDeps({ db: fakeDb([connection]) })
    await pollConnectionsOnce(deps as never)
    expect(deps.listSince).not.toHaveBeenCalled()
    expect(cursorParams(deps.db)).toEqual(['conn-1', '1700000000'])
  })

  it('clears expired email metadata once per cycle', async () => {
    const { deps } = baseDeps({ db: fakeDb([]) })
    await pollConnectionsOnce(deps as never)
    const retentionCalls = deps.db.query.mock.calls.filter(([sql]: [string]) =>
      /SET sender = NULL, subject = NULL/.test(sql))
    expect(retentionCalls).toHaveLength(1)
  })

  it('still imports when the retention statement fails', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const db = fakeDb([connection])
    const answerQuery = db.query
    db.query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (/SET sender = NULL, subject = NULL/.test(sql)) throw new Error('statement timeout')
      return answerQuery(sql, params)
    })
    const { deps } = baseDeps({
      db,
      listSince: vi.fn().mockResolvedValue(['m1']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi.fn().mockReturnValue(parsedMessage('s1', '1690000100')),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.importEmail).toHaveBeenCalledTimes(1)
  })

  it('imports each new message for the connection user and advances the cursor to max internalDate', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection]),
      listSince: vi.fn().mockResolvedValue(['m1', 'm2']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi
        .fn()
        .mockReturnValueOnce(parsedMessage('s1', '1690000100'))
        .mockReturnValueOnce(parsedMessage('s2', '1690000050')),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.listSince).toHaveBeenCalledWith({}, '1690000000')
    expect(deps.importEmail).toHaveBeenCalledTimes(2)
    expect(deps.importEmail.mock.calls[0][0]).toEqual({
      subject: 's1',
      text: 'body of s1',
      messageId: 'm1',
      sender: 'Bank <bank@x.com>',
      emailDateSeconds: '1690000100',
    })
    expect(deps.importEmail.mock.calls[0][1]).toEqual({ userId: 'user-1', connectionId: 'conn-1' })
    expect(cursorParams(deps.db)).toEqual(['conn-1', '1690000100'])
  })

  it('flips only the failing connection to needs_reauth on invalid_grant and continues', async () => {
    const failing = encryptedConnection('conn-bad', 'user-1', 'bad@gmail.com', '1690000000')
    const healthy = encryptedConnection('conn-ok', 'user-2', 'ok@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([failing, healthy]),
      listSince: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('invalid_grant'), { status: 400 }))
        .mockResolvedValueOnce([]),
    })
    await pollConnectionsOnce(deps as never)
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['conn-bad', 'needs_reauth'])
    expect(deps.listSince).toHaveBeenCalledTimes(2)
  })

  it('alerts the user when a connection breaks', async () => {
    const failing = encryptedConnection('conn-bad', 'user-1', 'bad@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([failing]),
      listSince: vi.fn().mockRejectedValue(Object.assign(new Error('invalid_grant'), { status: 400 })),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.notifyGmailConnectionLost).toHaveBeenCalledTimes(1)
    expect(deps.notifyGmailConnectionLost.mock.calls[0][0].id).toBe('conn-bad')
    expect(deps.notifyGmailConnectionLost.mock.calls[0][0].external_id).toBe('bad@gmail.com')
    // The status must be written before the alert goes out: a Telegram outage
    // must never leave a dead token marked active.
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['conn-bad', 'needs_reauth'])
    expect(deps.db.query.mock.invocationCallOrder.at(-1)).toBeLessThan(
      deps.notifyGmailConnectionLost.mock.invocationCallOrder[0],
    )
  })

  it('does not alert on a transient failure', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection]),
      listSince: vi.fn().mockRejectedValue(Object.assign(new Error('socket hang up'), { status: 503 })),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.notifyGmailConnectionLost).not.toHaveBeenCalled()
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall).toBeUndefined()
  })

  it('keeps polling the remaining connections when the alert throws', async () => {
    const failing = encryptedConnection('conn-bad', 'user-1', 'bad@gmail.com', '1690000000')
    const healthy = encryptedConnection('conn-ok', 'user-2', 'ok@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([failing, healthy]),
      listSince: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('invalid_grant'), { status: 400 }))
        .mockResolvedValueOnce([]),
      notifyGmailConnectionLost: vi.fn().mockRejectedValue(new Error('telegram is down')),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.listSince).toHaveBeenCalledTimes(2)
  })
})

describe('connection poller import failures', () => {
  it('keeps importing the rest of the batch when one email throws', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection]),
      listSince: vi.fn().mockResolvedValue(['m1', 'm2', 'm3']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi
        .fn()
        .mockReturnValueOnce(parsedMessage('s1', '1690000100'))
        .mockReturnValueOnce(parsedMessage('s2', '1690000200'))
        .mockReturnValueOnce(parsedMessage('s3', '1690000300')),
      importEmail: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('the AI provider is down'))
        .mockResolvedValueOnce(undefined),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.importEmail).toHaveBeenCalledTimes(3)
  })

  it('does not advance the cursor past a message that ended with no row', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection]),
      listSince: vi.fn().mockResolvedValue(['m1', 'm2']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi
        .fn()
        .mockReturnValueOnce(parsedMessage('s1', '1690000100'))
        .mockReturnValueOnce(parsedMessage('s2', '1690000200')),
      importEmail: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('the AI provider is down')),
    })
    await pollConnectionsOnce(deps as never)
    // The newest message failed, so the cursor stops at the one that succeeded.
    expect(cursorParams(deps.db)).toEqual(['conn-1', '1690000100'])
  })

  it('records a failed row with no sender or subject when the message cannot be fetched', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection]),
      listSince: vi.fn().mockResolvedValue(['m1']),
      fetchMessage: vi.fn().mockRejectedValue(Object.assign(new Error('bad gateway'), { status: 502 })),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.importEmail).not.toHaveBeenCalled()
    expect(recordedFailures(deps.db)).toEqual([
      ['conn-1', 'm1', null, null, null, null, 'failed'],
    ])
    // No row-bearing message, so the cursor stays where it was.
    expect(cursorParams(deps.db)).toBeUndefined()
  })

  it('never turns an already-imported message into a failure when Gmail cannot serve it', async () => {
    // Gmail's after: query is inclusive at the boundary second, so the newest
    // imported message is re-listed every cycle. A transient fetch error on it
    // must not overwrite its imported row, or the retry would import it twice.
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection], [], ['already-imported']),
      listSince: vi.fn().mockResolvedValue(['already-imported']),
      fetchMessage: vi.fn().mockRejectedValue(Object.assign(new Error('bad gateway'), { status: 502 })),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.fetchMessage).not.toHaveBeenCalled()
    expect(recordedFailures(deps.db)).toEqual([])
    expect(deps.notifyImportFailures).not.toHaveBeenCalled()
  })

  it('does not record a second row when processEmail already recorded its failure', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection]),
      listSince: vi.fn().mockResolvedValue(['m1']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi.fn().mockReturnValue(parsedMessage('s1', '1690000100')),
      importEmail: vi.fn().mockRejectedValue(new Error('the AI provider is down')),
    })
    await pollConnectionsOnce(deps as never)
    expect(recordedFailures(deps.db)).toEqual([])
  })

  it('lets an auth error from fetchMessage flip the connection without counting as an import failure', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection]),
      listSince: vi.fn().mockResolvedValue(['m1']),
      fetchMessage: vi.fn().mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 })),
    })
    await pollConnectionsOnce(deps as never)
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall[1]).toEqual(['conn-1', 'needs_reauth'])
    expect(deps.notifyGmailConnectionLost).toHaveBeenCalledTimes(1)
    expect(deps.notifyImportFailures).not.toHaveBeenCalled()
    expect(recordedFailures(deps.db)).toEqual([])
  })

  it('sends exactly one alert for many failures in a cycle and none in the next hour', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const buildDeps = (nowSeconds: string) =>
      baseDeps({
        db: fakeDb([connection]),
        listSince: vi.fn().mockResolvedValue(['m1', 'm2', 'm3']),
        fetchMessage: vi.fn().mockResolvedValue({}),
        parseMessage: vi
          .fn()
          .mockReturnValueOnce(parsedMessage('s1', '1690000100', 'Bank <bank@x.com>'))
          .mockReturnValueOnce(parsedMessage('s2', '1690000200'))
          .mockReturnValueOnce(parsedMessage('s3', '1690000300')),
        importEmail: vi.fn().mockRejectedValue(new Error('the AI provider is down')),
        nowSeconds: () => nowSeconds,
      }).deps

    const firstCycle = buildDeps('1700000000')
    await pollConnectionsOnce(firstCycle as never)
    expect(firstCycle.notifyImportFailures).toHaveBeenCalledTimes(1)
    const [alertedConnection, failures] = firstCycle.notifyImportFailures.mock.calls[0]
    expect(alertedConnection.id).toBe('conn-1')
    expect(failures).toEqual([
      { sender: 'Bank <bank@x.com>', subject: 's1' },
      { sender: 'Bank <bank@x.com>', subject: 's2' },
      { sender: 'Bank <bank@x.com>', subject: 's3' },
    ])

    const secondCycle = buildDeps('1700001800')
    await pollConnectionsOnce(secondCycle as never)
    expect(secondCycle.notifyImportFailures).not.toHaveBeenCalled()

    const laterCycle = buildDeps('1700003700')
    await pollConnectionsOnce(laterCycle as never)
    expect(laterCycle.notifyImportFailures).toHaveBeenCalledTimes(1)
  })

  it('keeps the cycle alive when the failure alert throws', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection]),
      listSince: vi.fn().mockResolvedValue(['m1']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi.fn().mockReturnValue(parsedMessage('s1', '1690000100')),
      importEmail: vi.fn().mockRejectedValue(new Error('the AI provider is down')),
      notifyImportFailures: vi.fn().mockRejectedValue(new Error('telegram is down')),
    })
    await pollConnectionsOnce(deps as never)
    const statusCall = deps.db.query.mock.calls.find(([sql]: [string]) => /SET status/.test(sql))
    expect(statusCall).toBeUndefined()
  })
})

describe('connection poller retry', () => {
  it('retries a failed message alongside the newly listed ones', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection], ['old-failed']),
      listSince: vi.fn().mockResolvedValue(['m1']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi
        .fn()
        .mockReturnValueOnce(parsedMessage('s1', '1690000100'))
        .mockReturnValueOnce(parsedMessage('old', '1680000000')),
    })
    await pollConnectionsOnce(deps as never)
    const importedMessageIds = deps.importEmail.mock.calls.map((call: unknown[]) =>
      (call[0] as { messageId: string }).messageId)
    expect(importedMessageIds).toEqual(['m1', 'old-failed'])
  })

  it('does not list a retried message twice when it is also newly listed', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection], ['m1']),
      listSince: vi.fn().mockResolvedValue(['m1']),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi.fn().mockReturnValue(parsedMessage('s1', '1690000100')),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.importEmail).toHaveBeenCalledTimes(1)
  })

  it('stops fetching a message whose attempts are exhausted, even while it stays in the listing window', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const db = fakeDb([connection])
    db.query = vi.fn(async (sql: string) => {
      if (/FROM connection\b/.test(sql) && /secret_encrypted/.test(sql)) return { rows: [connection] }
      if (/SELECT verdict, attempts FROM import_source/.test(sql)) {
        return { rows: [{ verdict: 'failed', attempts: 3 }] }
      }
      return { rows: [] }
    })
    const { deps } = baseDeps({
      db,
      listSince: vi.fn().mockResolvedValue(['poison']),
      fetchMessage: vi.fn().mockRejectedValue(new Error('bad gateway')),
    })
    await pollConnectionsOnce(deps as never)
    expect(deps.fetchMessage).not.toHaveBeenCalled()
    expect(deps.notifyImportFailures).not.toHaveBeenCalled()
  })

  it('does not drag the cursor backwards for a retried older message', async () => {
    const connection = encryptedConnection('conn-1', 'user-1', 'a@gmail.com', '1690000000')
    const { deps } = baseDeps({
      db: fakeDb([connection], ['old-failed']),
      listSince: vi.fn().mockResolvedValue([]),
      fetchMessage: vi.fn().mockResolvedValue({}),
      parseMessage: vi.fn().mockReturnValue(parsedMessage('old', '1680000000')),
    })
    await pollConnectionsOnce(deps as never)
    expect(cursorParams(deps.db)).toBeUndefined()
  })
})
