import { defineConfig, devices } from '@playwright/test'

const PORT = 5199

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    // Trailing slash matters: relative paths in page.goto() resolve under /nikki-ai/.
    baseURL: `http://localhost:${PORT}/nikki-ai/`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // --strictPort makes the run fail loudly instead of silently moving to another port.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/nikki-ai/`,
    // Always start a fresh server on the dedicated E2E port, locally and in CI.
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
