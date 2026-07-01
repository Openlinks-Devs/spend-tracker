import { describe, it, expect, vi } from 'vitest'
import { pollOnce } from '../src/gmail/poller.js'
import * as gmailClient from '../src/gmail/client.js'

vi.mock('../src/gmail/client.js', () => ({
  getCurrentHistoryId: vi.fn().mockResolvedValue('100'),
  fetchNewMessageIds: vi.fn().mockResolvedValue({ messageIds: ['m1'], newHistoryId: '101' }),
  fetchMessage: vi.fn().mockResolvedValue({
    payload: { headers: [{ name: 'Subject', value: 'S' }], mimeType: 'text/plain',
      body: { data: Buffer.from('hello').toString('base64url') } },
  }),
}))

function fakeDb(initial: Record<string, string> = {}) {
  const store = { ...initial }
  return {
    store,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/create table/i.test(sql)) return { rows: [] }
      if (/select value/i.test(sql)) {
        const key = params![0] as string
        return { rows: key in store ? [{ value: store[key] }] : [] }
      }
      if (/insert into agent_state/i.test(sql)) {
        store[params![0] as string] = params![1] as string
        return { rows: [] }
      }
      return { rows: [] }
    }),
  }
}

describe('pollOnce', () => {
  it('seeds the cursor on first run and does not emit emails', async () => {
    const db = fakeDb()
    const onEmail = vi.fn()
    await pollOnce({ gmail: {} as never, db, onEmail })
    expect(onEmail).not.toHaveBeenCalled()
    expect(db.store['gmail_history_id']).toBe('100')
  })

  it('emits parsed emails and advances the cursor on later runs', async () => {
    const db = fakeDb({ gmail_history_id: '100' })
    const onEmail = vi.fn()
    await pollOnce({ gmail: {} as never, db, onEmail })
    expect(onEmail).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', subject: 'S', text: 'hello' }),
    )
    expect(db.store['gmail_history_id']).toBe('101')
  })

  it('skips a failing message, delivers the other, and still advances the cursor', async () => {
    vi.mocked(gmailClient.fetchNewMessageIds).mockResolvedValueOnce({
      messageIds: ['bad-id', 'm1'],
      newHistoryId: '102',
    })
    vi.mocked(gmailClient.fetchMessage).mockImplementation(async (_gmail, messageId) => {
      if (messageId === 'bad-id') throw new Error('fetch failed')
      return {
        payload: {
          headers: [{ name: 'Subject', value: 'S' }],
          mimeType: 'text/plain',
          body: { data: Buffer.from('hello').toString('base64url') },
        },
      }
    })

    const db = fakeDb({ gmail_history_id: '101' })
    const onEmail = vi.fn()
    await pollOnce({ gmail: {} as never, db, onEmail })

    // The good message was delivered
    expect(onEmail).toHaveBeenCalledTimes(1)
    expect(onEmail).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm1' }))
    // The cursor advanced despite the failing message
    expect(db.store['gmail_history_id']).toBe('102')
  })
})
