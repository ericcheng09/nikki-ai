import { expect } from '@playwright/test'

// Shared E2E helpers.

export const HOME_URL = /\/nikki-ai\/$/
export const WELCOME_URL = /\/nikki-ai\/welcome$/

// First visit in a fresh browser context: the home page must redirect to
// the welcome page (spec 3.5); pressing 開始使用 returns to the home page.
// Tests about regular diary entries start with this. It fails if the
// redirect does not happen, so it never hides a broken first-use flow.
export async function startApp(page) {
  await page.goto('./')
  await expect(page).toHaveURL(WELCOME_URL)
  await page.getByRole('button', { name: '開始使用' }).click()
  await expect(page).toHaveURL(HOME_URL)
  await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
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
