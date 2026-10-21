import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Read at config load rather than imported, so no JSON import attributes
// are needed on any Node version the build runs on.
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// GitHub Pages serves the app under /<repo name>/, so all asset URLs
// and the router basename must be relative to this base path.
export default defineConfig({
  base: '/nikki-ai/',
  plugins: [react()],
  // package.json is the single source of the app version (decisions.md 版號);
  // it is inlined at build time, and Vitest shares this config so tests see it too.
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    environment: 'jsdom',
    // Enables global afterEach so @testing-library/react auto-cleans up between tests.
    globals: true,
    // Unit tests live in src/ and scripts/; Playwright specs in e2e/ must not run in Vitest.
    include: ['src/**/*.test.{js,jsx}', 'scripts/**/*.test.js'],
    setupFiles: ['src/setupTests.js'],
    // Pin a non-UTC timezone so local-date tests catch accidental UTC usage
    // (e.g. toISOString()) even on CI machines that run in UTC.
    env: { TZ: 'Asia/Taipei' },
  },
})
