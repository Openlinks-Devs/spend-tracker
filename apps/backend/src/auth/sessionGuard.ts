import type { MiddlewareHandler } from 'hono'

export function createSessionGuard(
  getSession: (headers: Headers) => Promise<unknown>,
): MiddlewareHandler {
  return async (context, next) => {
    const session = await getSession(context.req.raw.headers)
    if (!session) {
      return context.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  }
}
