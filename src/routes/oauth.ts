import { Hono } from 'hono'
import { google } from 'googleapis'
import { loadEnv } from '../config/env.js'

export const oauthRoute = new Hono()

function buildOAuthClient() {
  const env = loadEnv()
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI)
}

oauthRoute.get('/oauth/start', (context) => {
  const authClient = buildOAuthClient()
  const url = authClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  })
  return context.redirect(url)
})

oauthRoute.get('/oauth/callback', async (context) => {
  const code = context.req.query('code')
  if (!code) return context.text('Missing code', 400)
  const authClient = buildOAuthClient()
  const { tokens } = await authClient.getToken(code)
  return context.text(`Refresh token (copy into env): ${tokens.refresh_token ?? 'none returned'}`)
})
