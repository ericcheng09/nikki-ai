import { test, expect } from '@playwright/test'

// Smoke test: the app is served under the GitHub Pages base path and shows the Chinese title.
test('home page under /nikki-ai/ shows the Chinese title', async ({ page }) => {
  const response = await page.goto('./')
  expect(response?.ok()).toBe(true)
  await expect(page).toHaveURL(/\/nikki-ai\/$/)
  await expect(page).toHaveTitle('外語學習日記')
  await expect(page.getByRole('heading', { level: 1, name: '外語學習日記' })).toBeVisible()
})
