import { createAuthClient } from 'better-auth/react'

// No explicit baseURL: better-auth resolves it from window.location.origin at
// runtime and appends the default "/api/auth" path. Passing a relative string
// like "/api/auth" here throws immediately (better-auth requires an absolute
// URL with a protocol when baseURL is provided directly).
export const authClient = createAuthClient()
export const { signIn, signOut, useSession } = authClient
