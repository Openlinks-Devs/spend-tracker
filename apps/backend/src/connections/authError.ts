/**
 * Whether a Gmail call failed because the connection's token is dead rather
 * than for a transient reason.
 *
 * Shared by the poller and the manual retry: both have to flip the connection
 * to needs_reauth on this, and a second copy of the check would let the two
 * disagree about what counts as a dead token.
 */
export function isAuthError(error: unknown): boolean {
  const status =
    (error as { status?: number; code?: number }).status ?? (error as { code?: number }).code
  const message = error instanceof Error ? error.message : String(error)
  return status === 401 || /invalid_grant/i.test(message)
}
