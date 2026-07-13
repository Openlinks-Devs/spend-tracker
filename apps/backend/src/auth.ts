import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { getPool } from './db/pool.js'
import { loadEnv } from './config/env.js'
import { parseAllowedEmails, isEmailAllowed } from './auth/allowlist.js'

function buildAuth() {
  const env = loadEnv()
  const allowedEmails = parseAllowedEmails(env.ALLOWED_EMAILS)
  return betterAuth({
    database: getPool(),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        accessType: 'offline',
        prompt: 'select_account',
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email: string }) => {
            if (!isEmailAllowed(user.email, allowedEmails)) {
              throw new APIError('FORBIDDEN', { message: 'This account is not authorized.' })
            }
            return { data: user }
          },
        },
      },
    },
  })
}

let authInstance: ReturnType<typeof buildAuth> | undefined

export function getAuth(): ReturnType<typeof buildAuth> {
  if (!authInstance) {
    authInstance = buildAuth()
  }
  return authInstance
}
