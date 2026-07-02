import type { gmail_v1 } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import { ensureStateTable, getState, setState } from '../db/queries.js'
import { fetchMessage, fetchNewMessageIds, getCurrentHistoryId } from './client.js'
import { parseMessage } from './parse.js'

const HISTORY_KEY = 'gmail_history_id'

export interface PollDeps {
  gmail: gmail_v1.Gmail
  db: Queryable
  onEmail: (email: { subject: string; text: string; messageId: string }) => Promise<void>
}

export async function pollOnce(deps: PollDeps): Promise<void> {
  await ensureStateTable(deps.db)
  const cursor = await getState(deps.db, HISTORY_KEY)

  if (!cursor) {
    const current = await getCurrentHistoryId(deps.gmail)
    await setState(deps.db, HISTORY_KEY, current)
    return
  }

  const { messageIds, newHistoryId } = await fetchNewMessageIds(deps.gmail, cursor)
  for (const messageId of messageIds) {
    try {
      const message = await fetchMessage(deps.gmail, messageId)
      const parsed = parseMessage(message)
      await deps.onEmail({ ...parsed, messageId })
    } catch (error) {
      console.error(`Failed to process Gmail message ${messageId}:`, error)
    }
  }
  await setState(deps.db, HISTORY_KEY, newHistoryId)
}

export function startPolling(deps: PollDeps, intervalMs: number): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      await pollOnce(deps)
    } catch (error) {
      console.error('Gmail poll failed:', error)
    }
    if (!stopped) setTimeout(tick, intervalMs)
  }
  void tick()
  return () => {
    stopped = true
  }
}
