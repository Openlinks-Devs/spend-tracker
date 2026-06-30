import { google, type gmail_v1 } from 'googleapis'
import { loadEnv } from '../config/env.js'
import type { GmailMessage } from './parse.js'

export function createGmailClient(): gmail_v1.Gmail {
  const env = loadEnv()
  const auth = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  )
  auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

export async function getCurrentHistoryId(gmail: gmail_v1.Gmail): Promise<string> {
  const profile = await gmail.users.getProfile({ userId: 'me' })
  return String(profile.data.historyId)
}

export async function fetchNewMessageIds(
  gmail: gmail_v1.Gmail,
  startHistoryId: string,
): Promise<{ messageIds: string[]; newHistoryId: string }> {
  const messageIds: string[] = []
  let pageToken: string | undefined
  let newHistoryId = startHistoryId
  do {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      pageToken,
    })
    if (response.data.historyId) newHistoryId = String(response.data.historyId)
    for (const history of response.data.history ?? []) {
      for (const added of history.messagesAdded ?? []) {
        if (added.message?.id) messageIds.push(added.message.id)
      }
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)
  return { messageIds: [...new Set(messageIds)], newHistoryId }
}

export async function fetchMessage(gmail: gmail_v1.Gmail, id: string): Promise<GmailMessage> {
  const response = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
  return response.data
}
