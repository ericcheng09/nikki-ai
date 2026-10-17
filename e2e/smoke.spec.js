import { test, expect } from '@playwright/test'

// Smoke test: the app is served under the GitHub Pages base path and shows the Chinese title.
test('home page under /nikki-ai/ shows the Chinese title', async ({ page }) => {
  const response = await page.goto('./')
  expect(response?.ok()).toBe(true)
  // A first visit is redirected to the welcome page (spec 3.5).
  await expect(page).toHaveURL(/\/nikki-ai\/welcome$/)
  await expect(page).toHaveTitle('外語學習日記')
  await expect(page.getByRole('heading', { level: 1, name: '外語學習日記' })).toBeVisible()
})
