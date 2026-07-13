import { getAuth } from '../auth.js'
import { loadEnv } from '../config/env.js'

const DEMO_USER = 'demo-user'

export interface ResolveSessionDependencies {
  mode: 'mock' | 'live'
  getSession: (headers: Headers) => Promise<unknown>
}

/**
 * Pure resolver: given a mode and an injected getSession, decides whether to
 * synthesize a mock session from the x-mock-user header or delegate to the
 * real session lookup. No DB or Better Auth instance required, so this is
 * unit-testable in isolation.
 */
export async function resolveSession(
  headers: Headers,
  { mode, getSession }: ResolveSessionDependencies,
): Promise<unknown> {
  if (mode === 'mock') {
    const mockUser = headers.get('x-mock-user') ?? DEMO_USER
    return { user: { id: mockUser, email: `${mockUser}@app`, name: 'Demo' } }
  }
  return getSession(headers)
}

/**
 * The mode-aware default resolver used by buildApp. Reads APP_MODE from the
 * validated environment and wires the real Better Auth session lookup for
 * live mode.
 */
export function resolveSessionFromRequest(headers: Headers): Promise<unknown> {
  return resolveSession(headers, {
    mode: loadEnv().APP_MODE,
    getSession: (requestHeaders) => getAuth().api.getSession({ headers: requestHeaders }),
  })
}
