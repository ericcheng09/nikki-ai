import { defineConfig, devices } from '@playwright/test'

const PORT = 5199

// Two targets:
// - dev (default locally): the Vite dev server.
// - prod (CI, or `npm run test:e2e:prod`): the built dist/ served by
//   scripts/pages-server.js, which behaves like GitHub Pages (404.html for
//   unknown paths). It does not build; run `npm run build` first.
export function makeConfig({ prod }) {
  return defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // CI also writes an HTML report (playwright-report/), uploaded by the
    // workflow when tests fail.
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
      // Trailing slash matters: relative paths in page.goto() resolve under /nikki-ai/.
      baseURL: `http://localhost:${PORT}/nikki-ai/`,
      trace: 'on-first-retry',
    },
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
      command: prod
        ? `node scripts/pages-server.js --port ${PORT} --dir dist`
        : // --strictPort makes the run fail loudly instead of silently moving to another port.
          `npm run dev -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/nikki-ai/`,
      // Always start a fresh server on the dedicated E2E port, locally and in CI.
      reuseExistingServer: false,
      timeout: 60_000,
    },
  })
}

export default makeConfig({ prod: !!process.env.CI })
