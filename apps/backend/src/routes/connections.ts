import { Hono } from 'hono'
import { google } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { loadEnv } from '../config/env.js'
import { getUserId, type AppVariables } from '../http/context.js'
import { mintPairingCode } from '../connections/pairingCodes.js'
import { decryptSecret, parseEncryptionKeys } from '../connections/crypto.js'
import {
  countGmailConnections,
  deleteConnection,
  getConnectionById,
  getUserIsPremium,
  gmailLimitFor,
  listConnections,
} from '../connections/queries.js'

// Best-effort: a removed connection should not leave a live grant at Google.
async function revokeGoogleToken(refreshToken: string): Promise<void> {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    })
  } catch (error) {
    console.error('Google token revoke failed (continuing with removal):', error)
  }
}

export function createConnectionsRoute(
  resolveDb: () => Queryable = getPool,
): Hono<{ Variables: AppVariables }> {
  const route = new Hono<{ Variables: AppVariables }>()

  // Connections write rows that FK to "user"(id); mock mode has no user row.
  route.use('/api/connections/*', async (context, next) => {
    if (loadEnv().APP_MODE === 'mock') {
      return context.json({ error: 'connections_require_live_mode' }, 503)
    }
    return next()
  })
  route.use('/api/connections', async (context, next) => {
    if (loadEnv().APP_MODE === 'mock') {
      return context.json({ error: 'connections_require_live_mode' }, 503)
    }
    return next()
  })

  route.get('/api/connections', async (context) => {
    try {
      const connections = await listConnections(resolveDb(), getUserId(context))
      return context.json(connections)
    } catch (error) {
      console.error('Failed to list connections:', error)
      return context.json({ error: 'Failed to list connections' }, 500)
    }
  })

  route.delete('/api/connections/:id', async (context) => {
    const userId = getUserId(context)
    const connectionId = context.req.param('id')
    try {
      const db = resolveDb()
      const connection = await getConnectionById(db, userId, connectionId)
      if (!connection) return context.json({ error: 'Connection not found' }, 404)
      if (connection.provider === 'gmail' && connection.secret_encrypted && connection.key_version) {
        const keys = parseEncryptionKeys(loadEnv().CONNECTION_ENCRYPTION_KEYS)
        const refreshToken = decryptSecret(
          connection.secret_encrypted,
          connection.key_version,
          keys,
          connection.id,
        )
        await revokeGoogleToken(refreshToken)
      }
      await deleteConnection(db, userId, connectionId)
      return context.json({ success: true })
    } catch (error) {
      console.error('Failed to remove connection:', error)
      return context.json({ error: 'Failed to remove connection' }, 500)
    }
  })

  route.post('/api/connections/gmail/link-url', async (context) => {
    const userId = getUserId(context)
    try {
      const db = resolveDb()
      const isPremium = await getUserIsPremium(db, userId)
      const limit = gmailLimitFor(isPremium)
      const existing = await countGmailConnections(db, userId)
      if (existing >= limit) {
        return context.json({ error: 'premium_required', limit }, 402)
      }
      const state = await mintPairingCode(db, userId, 'gmail_oauth')
      const env = loadEnv()
      const oauthClient = new google.auth.OAuth2(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
        env.GOOGLE_REDIRECT_URI,
      )
      const url = oauthClient.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/gmail.readonly'],
        state,
      })
      return context.json({ url })
    } catch (error) {
      console.error('Failed to build Gmail link URL:', error)
      return context.json({ error: 'Failed to start Gmail linking' }, 500)
    }
  })

  route.post('/api/connections/telegram/pair-code', async (context) => {
    const userId = getUserId(context)
    try {
      const code = await mintPairingCode(resolveDb(), userId, 'telegram_pair')
      const deepLink = `https://t.me/${loadEnv().TELEGRAM_BOT_USERNAME}?start=${code}`
      return context.json({ deepLink })
    } catch (error) {
      console.error('Failed to mint Telegram pairing code:', error)
      return context.json({ error: 'Failed to start Telegram pairing' }, 500)
    }
  })

  return route
}
