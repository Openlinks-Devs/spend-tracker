import type { MiddlewareHandler } from 'hono'
import type { AppVariables } from '../http/context.js'

// A session shaped like Better Auth's getSession result (and the mock resolver):
// { user: { id, ... } }. Only the id is needed to scope data.
type ResolvedSession = { user: { id: string } } | null | undefined

export function createSessionGuard(
  getSession: (headers: Headers) => Promise<unknown>,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    const session = (await getSession(context.req.raw.headers)) as ResolvedSession
    if (!session || !session.user?.id) {
      return context.json({ error: 'Unauthorized' }, 401)
    }
    context.set('userId', session.user.id)
    await next()
  }
}
