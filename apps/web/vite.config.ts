import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000'

// Everything the backend owns, not just /api. Two of its routes are mounted
// outside that prefix on purpose, because they are entered by a third party
// rather than by the app: Google redirects to /connections/gmail/callback after
// consent, and Telegram POSTs to /telegram/webhook. Forwarding only /api leaves
// both resolving against the static web host, where they 404. Any production
// reverse proxy needs these same three prefixes.
const backendPrefixes = ['/api', '/connections', '/telegram']

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    // Vite refuses requests whose Host header it does not recognise, which
    // blocks reaching the dev server by hostname (LAN, Tailscale) rather than
    // by IP. Supply those names as a comma-separated VITE_ALLOWED_HOSTS; left
    // unset, Vite keeps its default behaviour.
    allowedHosts: process.env.VITE_ALLOWED_HOSTS
      ?.split(',')
      .map((hostname) => hostname.trim())
      .filter((hostname) => hostname.length > 0),
    proxy: Object.fromEntries(
      backendPrefixes.map((prefix) => [prefix, { target: backendTarget, changeOrigin: true }]),
    ),
  },
})
