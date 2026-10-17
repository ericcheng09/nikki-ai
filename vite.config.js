import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app under /<repo name>/, so all asset URLs
// and the router basename must be relative to this base path.
export default defineConfig({
  base: '/nikki-ai/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Enables global afterEach so @testing-library/react auto-cleans up between tests.
    globals: true,
    // Only pick up unit tests under src/; Playwright specs in e2e/ must not run in Vitest.
    include: ['src/**/*.test.{js,jsx}'],
    // Pin a non-UTC timezone so local-date tests catch accidental UTC usage
    // (e.g. toISOString()) even on CI machines that run in UTC.
    env: { TZ: 'Asia/Taipei' },
  },
})
