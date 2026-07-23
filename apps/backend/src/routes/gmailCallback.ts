import { Hono } from 'hono'
import { google } from 'googleapis'
import type { Queryable } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { loadEnv } from '../config/env.js'
import { consumePairingCode } from '../connections/pairingCodes.js'
import { encryptSecret, parseEncryptionKeys } from '../connections/crypto.js'
import { upsertGmailConnection } from '../connections/queries.js'
import { resolveSessionFromRequest } from '../auth/resolveSession.js'

export interface GmailTokenExchange {
  (code: string): Promise<{ refreshToken: string | null; email: string | null }>
}

// Real exchanger: trade the auth code for tokens, then read the linked
// account's email so the connection knows which inbox it represents.
async function exchangeCodeForGmailAccount(code: string): Promise<{
  refreshToken: string | null
  email: string | null
}> {
  const env = loadEnv()
  const oauthClient = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  )
  const { tokens } = await oauthClient.getToken(code)
  if (!tokens.refresh_token) return { refreshToken: null, email: null }
  oauthClient.setCredentials(tokens)
  const gmail = google.gmail({ version: 'v1', auth: oauthClient })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  return { refreshToken: tokens.refresh_token, email: profile.data.emailAddress ?? null }
}

type SessionResolver = (headers: Headers) => Promise<unknown>

// Mounted OUTSIDE the /api/* session guard (like /telegram/webhook): the
// browser arrives here from Google with no app session on Android (Custom
// Tab), so the single-use state code is the authentication.
export function createGmailCallbackRoute(
  resolveDb: () => Queryable = getPool,
  exchange: GmailTokenExchange = exchangeCodeForGmailAccount,
  resolveSession: SessionResolver = resolveSessionFromRequest,
): Hono {
  const route = new Hono()

  route.get('/connections/gmail/callback', async (context) => {
    const env = loadEnv()
    const errorRedirect = (errorCode: string) =>
      context.redirect(`${env.APP_BASE_URL}/integrations?error=${errorCode}`)

    const code = context.req.query('code')
    const state = context.req.query('state')
    if (!code || !state) return errorRedirect('link_invalid')

    try {
      const db = resolveDb()
      const stateUserId = await consumePairingCode(db, state, 'gmail_oauth')
      if (!stateUserId) return errorRedirect('link_invalid')

      // Anti-phishing: a logged-in browser must be the same user the state was
      // minted for, else an attacker link could bind a victim's Gmail to the
      // attacker's account. No session (Android Custom Tab) is fine.
      const session = (await resolveSession(context.req.raw.headers)) as
        | { user?: { id?: string } }
        | null
      if (session?.user?.id && session.user.id !== stateUserId) {
        return errorRedirect('session_mismatch')
      }

      const { refreshToken, email } = await exchange(code)
      if (!refreshToken || !email) return errorRedirect('no_refresh_token')

      const keys = parseEncryptionKeys(env.CONNECTION_ENCRYPTION_KEYS)
      // AAD binds the blob to the user+email identity of the row (stable across
      // upsert, unlike the row id which is unknown before insert).
      const { blob, keyVersion } = encryptSecret(refreshToken, keys, `${stateUserId}:${email}`)
      await upsertGmailConnection(db, stateUserId, email, blob, keyVersion)

      const returnUrl = `${env.APP_BASE_URL}/integrations?linked=gmail`
      // Interstitial instead of a bare 302: Chrome Custom Tabs do not reliably
      // fire Android App Links on server redirects, so give the user a button.
      return context.html(
        `<!doctype html><meta charset="utf-8"><title>Gmail linked</title>
         <body style="font-family:sans-serif;display:grid;place-items:center;min-height:90vh">
           <div style="text-align:center">
             <h1>Gmail linked</h1>
             <p>You can return to SpendTracker.</p>
             <p><a href="${returnUrl}">Return to app</a></p>
           </div>
         </body>`,
      )
    } catch (error) {
      console.error('Gmail callback failed:', error)
      return errorRedirect('link_failed')
    }
  })

  return route
}
