import { loadEnv } from '../config/env.js'

const env = loadEnv()
const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`
const response = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: env.TELEGRAM_WEBHOOK_URL, secret_token: env.TELEGRAM_WEBHOOK_SECRET }),
})
console.log(await response.json())
