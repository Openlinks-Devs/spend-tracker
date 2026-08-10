// In mock mode the backend synthesizes a demo session for every request
// (APP_MODE=mock, see apps/backend/src/auth/resolveSession.ts), so there is no
// real Better Auth session for the web app to check or to end. Both the login
// gate and the sign-out control key off this single flag so they cannot drift:
// a build that skips the gate must also hide sign out, or the user is left with
// a button that can never do anything.
export const isMockMode = import.meta.env.VITE_APP_MODE === 'mock'
