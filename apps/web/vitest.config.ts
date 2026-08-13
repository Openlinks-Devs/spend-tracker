import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // jest-dom's matchers have to be registered from a setup file. Importing
  // '@testing-library/jest-dom/vitest' at the top of a test file extends a
  // different expect instance than the global one this config installs, which
  // is why assertions like toBeInTheDocument used to fail with "Invalid Chai
  // property" even though the import was right there.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
