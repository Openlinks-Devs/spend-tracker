import { describe, it, expect, vi } from 'vitest'
import { retryEmail, type RetryEmailDeps } from '../src/connections/retryEmail.js'
import { encryptSecret, type VersionedKey } from '../src/connections/crypto.js'

const keys: VersionedKey[] = [{ version: 1, key: Buffer.alloc(32, 7) }]

function encryptedToken(userId = 'user-1', accountEmail = 'a@gmail.com'): Buffer {
  return encryptSecret('refresh-token', keys, `${userId}:${accountEmail}`).blob
}

interface RowOverrides {
  verdict?: string
  connection_provider?: string
  connection_status?: string
  connection_secret?: Buffer | null
}

// The module runs two queries: the row-plus-connection read, then the email log
// read it answers with. Both are keyed off the SQL so a test can shape each.
function retryDb(overrides: RowOverrides = {}) {
  return {
    query: vi.fn(async (sql: string) => {
      if (/FROM import_source\s+JOIN connection/.test(sql) && /connection.secret_encrypted/.test(sql)) {
        return {
          rows: [
            {
              verdict: overrides.verdict ?? 'failed',
              connection_provider: overrides.connection_provider ?? 'gmail',
              connection_status: overrides.connection_status ?? 'active',
              connection_external_id: 'a@gmail.com',
              connection_key_version: 1,
              connection_secret:
                overrides.connection_secret === undefined
                  ? encryptedToken()
                  : overrides.connection_secret,
            },
          ],
        }
      }
      if (/UPDATE connection/.test(sql)) return { rows: [] }
      return {
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
            attempts: 2,
            transaction_id: 'tx-1',
            transaction_description: 'PLIN',
            transaction_amount: -35,
            transaction_currency: 'PEN',
          },
        ],
      }
    }),
  }
}

function buildDeps(overrides: Partial<RetryEmailDeps> = {}, rowOverrides: RowOverrides = {}) {
  const deps: RetryEmailDeps = {
    db: retryDb(rowOverrides) as unknown as RetryEmailDeps['db'],
    keys,
    buildGmail: vi.fn(() => ({}) as never),
    fetchMessage: vi.fn(async () => ({ id: 'msg-1' })),
    parseMessage: vi.fn(() => ({
      subject: 'Consumo',
      text: 'Consumo de S/ 35.00',
      sender: 'Bank <no-reply@bank.com>',
      internalDateSeconds: '1787000000',
    })),
    importEmail: vi.fn(async () => {}),
    ...overrides,
  }
  return deps
}

describe('retryEmail', () => {
  it('re-fetches the message and re-imports it, forcing past the dedupe check', async () => {
    const deps = buildDeps()
    const result = await retryEmail(deps, 'user-1', 'conn-1', 'msg-1')

    expect(result.ok).toBe(true)
    expect(deps.fetchMessage).toHaveBeenCalledWith(expect.anything(), 'msg-1')
    expect(deps.importEmail).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-1', text: 'Consumo de S/ 35.00' }),
      { userId: 'user-1', connectionId: 'conn-1', force: true },
    )
  })

  it('answers with the refreshed log row so the client can patch it in place', async () => {
    const result = await retryEmail(buildDeps(), 'user-1', 'conn-1', 'msg-1')
    expect(result).toMatchObject({ ok: true, email: { message_id: 'msg-1', verdict: 'imported' } })
  })

  it('reports email_not_found when the message is not this user\'s', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) }
    const deps = buildDeps({ db: db as unknown as RetryEmailDeps['db'] })
    const result = await retryEmail(deps, 'user-1', 'conn-1', 'msg-1')

    expect(result).toEqual({ ok: false, reason: 'email_not_found' })
    expect(deps.fetchMessage).not.toHaveBeenCalled()
  })

  it('refuses to retry an imported message', async () => {
    const deps = buildDeps({}, { verdict: 'imported' })
    const result = await retryEmail(deps, 'user-1', 'conn-1', 'msg-1')

    expect(result).toEqual({ ok: false, reason: 'verdict_not_retryable' })
    // The guard has to stop before the import, or the retry would insert the
    // transaction the user already has a second time.
    expect(deps.importEmail).not.toHaveBeenCalled()
  })

  it('refuses to retry a routine not_transaction verdict', async () => {
    const result = await retryEmail(buildDeps({}, { verdict: 'not_transaction' }), 'user-1', 'conn-1', 'msg-1')
    expect(result).toEqual({ ok: false, reason: 'verdict_not_retryable' })
  })

  it('retries an extract_failed message', async () => {
    const deps = buildDeps({}, { verdict: 'extract_failed' })
    const result = await retryEmail(deps, 'user-1', 'conn-1', 'msg-1')

    expect(result.ok).toBe(true)
    expect(deps.importEmail).toHaveBeenCalled()
  })

  it('reports connection_needs_reauth when the connection is parked', async () => {
    const deps = buildDeps({}, { connection_status: 'needs_reauth' })
    const result = await retryEmail(deps, 'user-1', 'conn-1', 'msg-1')

    expect(result).toEqual({ ok: false, reason: 'connection_needs_reauth' })
    expect(deps.fetchMessage).not.toHaveBeenCalled()
  })

  it('parks the connection when Gmail rejects the token mid-retry', async () => {
    const deps = buildDeps({
      fetchMessage: vi.fn(async () => {
        throw Object.assign(new Error('invalid_grant'), { status: 401 })
      }),
    })
    const result = await retryEmail(deps, 'user-1', 'conn-1', 'msg-1')

    expect(result).toEqual({ ok: false, reason: 'connection_needs_reauth' })
    const updates = (deps.db.query as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      /UPDATE connection/.test(call[0] as string),
    )
    expect(updates).toHaveLength(1)
  })

  it('rethrows a non-auth failure so the route can answer 500', async () => {
    const deps = buildDeps({
      importEmail: vi.fn(async () => {
        throw new Error('the model is down')
      }),
    })
    await expect(retryEmail(deps, 'user-1', 'conn-1', 'msg-1')).rejects.toThrow('the model is down')
  })

  it('refuses a row that did not arrive over Gmail', async () => {
    const deps = buildDeps({}, { connection_provider: 'telegram' })
    const result = await retryEmail(deps, 'user-1', 'conn-1', 'msg-1')

    // Retrying means re-fetching from Gmail, so there is nothing to re-fetch.
    expect(result).toEqual({ ok: false, reason: 'verdict_not_retryable' })
    expect(deps.fetchMessage).not.toHaveBeenCalled()
  })
})
