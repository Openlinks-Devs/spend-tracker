import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
