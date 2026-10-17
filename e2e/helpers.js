import { expect } from '@playwright/test'

// Shared E2E helpers.

export const SAMPLE_CONFIRM_MESSAGE = '確定要刪除這篇範例日記嗎？刪除後不會再出現。'

// A fresh browser context always starts with the sample entry (spec 3.5).
// Tests about regular diary entries call this first so their assertions
// (exact list contents, record counts) only concern their own entries.
// It deletes the sample through the UI and fails if the sample is missing,
// so it never hides a seeding regression.
export async function dismissSample(page) {
  await expect(page).toHaveURL(/\/nikki-ai\/$/)
  const sampleItem = page.locator('ul.entries > li').filter({
    has: page.locator('.badge', { hasText: '範例' }),
  })
  await expect(sampleItem).toHaveCount(1)
  await sampleItem.getByRole('link').click()
  await expect(page.getByRole('heading', { level: 2, name: /範例日記/ })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '刪除' }).click()
  await expect(page).toHaveURL(/\/nikki-ai\/$/)
  await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
  await expect(page.getByText(/還沒有日記/)).toBeVisible()
}

// Reads every record of an IndexedDB object store of the app, as stored.
// For the out-of-line-keyed "settings" store, returns { key: value }.
export async function readStore(page, storeName) {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('nikki-ai')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const store = db.transaction(name, 'readonly').objectStore(name)
          const values = store.getAll()
          const keys = store.getAllKeys()
          keys.onsuccess = () => {
            db.close()
            if (store.keyPath) {
              resolve(values.result)
            } else {
              resolve(Object.fromEntries(keys.result.map((k, i) => [k, values.result[i]])))
            }
          }
          keys.onerror = () => reject(keys.error)
        }
      }),
    storeName,
  )
}
