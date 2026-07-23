import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-5-mini'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().min(1),
  GOOGLE_REFRESH_TOKEN: z.string().min(1),
  GMAIL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_WEBHOOK_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().min(1),
  ALLOWED_EMAILS: z.string().default('misaelabanto@gmail.com'),
  APP_MODE: z.enum(['mock', 'live']).default('mock'),
  NODE_ENV: z.string().optional(),
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new Error(`Invalid or missing environment variables: ${missing}`)
  }
  const parsedEnv = parsed.data
  if (parsedEnv.NODE_ENV === 'production') {
    if (parsedEnv.APP_MODE === 'mock') {
      throw new Error('APP_MODE=mock is not allowed in production (it bypasses auth).')
    }
    if (!source.ALLOWED_EMAILS || source.ALLOWED_EMAILS.trim() === '') {
      throw new Error('ALLOWED_EMAILS must be set explicitly in production.')
    }
  }
  return parsedEnv
}
