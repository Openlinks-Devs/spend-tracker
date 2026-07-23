import type { Context } from 'hono'

// Variables the session guard populates and handlers read. Typing the Hono app
// with this makes context.get('userId') a string, not unknown.
export type AppVariables = {
  userId: string
}

export function getUserId(context: Context<{ Variables: AppVariables }>): string {
  return context.get('userId')
}
