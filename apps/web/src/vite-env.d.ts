/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  // Set to 'mock' to bypass the Better Auth login gate (matches the backend
  // APP_MODE=mock demo session). Used for LAN preview without Google sign-in.
  readonly VITE_APP_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
