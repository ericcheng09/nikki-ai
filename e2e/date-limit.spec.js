import { test, expect } from '@playwright/test'
import { HOME_URL, readStore, startApp } from './helpers.js'

// E2E for T9: the diary date cannot be later than today (decisions.md,
// "新增與編輯"). Dates are computed in the browser at runtime; checks that
// compare against "today" accept either side of local midnight.

const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const entryItems = (page) => page.locator('ul.entries > li')

async function browserLocalDate(page, offsetDays = 0) {
  return page.evaluate((offset) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }, offsetDays)
}

// Reads the date input's max attribute, tolerating a midnight in between.
async function expectMaxIsToday(page) {
  const before = await browserLocalDate(page)
  const max = await page.getByLabel('日期').getAttribute('max')
  const after = await browserLocalDate(page)
  expect([before, after]).toContain(max)
}

async function createEntry(page, content) {
  await page.getByRole('link', { name: '新增日記' }).click()
  await page.getByLabel('內容').fill(content)
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page).toHaveURL(ENTRY_URL)
  return new URL(page.url()).pathname.split('/').pop()
}

test.describe('date cannot be later than today', () => {
  test('new and edit forms limit the date picker to today', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    await expectMaxIsToday(page)

    await page.getByLabel('內容').fill('Entry for the max check')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    await expectMaxIsToday(page)
  })

  // At any instant at least one of these zones is on a different calendar
  // day than UTC, so a UTC-based max would fail in one of them.
  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    test.describe(`in timezone ${timezoneId}`, () => {
      test.use({ timezoneId })

      test('max is the local calendar day', async ({ page }) => {
        await startApp(page)
        await page.getByRole('link', { name: '新增日記' }).click()
        await expectMaxIsToday(page)
      })
    })
  }

  test('today is accepted', async ({ page }) => {
    await startApp(page)
    const today = await browserLocalDate(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    await page.getByLabel('日期').fill(today)
    await page.getByLabel('內容').fill('Written today')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(page.getByLabel('日期')).toHaveValue(today)
  })

  test('creating with a future date is rejected and the input is kept', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()

    for (const offset of [1, 365]) {
      const future = await browserLocalDate(page, offset)
      // fill() sets the value directly, like typing past the picker's max.
      await page.getByLabel('日期').fill(future)
      await page.getByLabel('內容').fill('Tomorrow I will...')
      await page.getByRole('button', { name: '儲存' }).click()

      await expect(page.getByRole('alert')).toHaveText('日期不能晚於今天')
      await expect(page).toHaveURL(/\/nikki-ai\/entry\/new$/)
      await expect(page.getByLabel('日期')).toHaveValue(future)
      await expect(page.getByLabel('內容')).toHaveValue('Tomorrow I will...')
    }

    // Nothing was stored.
    expect(await readStore(page, 'entries')).toEqual([])
    await page.getByRole('link', { name: '取消' }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(entryItems(page)).toHaveCount(0)
  })

  test('the date check comes before the blank-content check', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    await page.getByLabel('日期').fill(await browserLocalDate(page, 1))
    await page.getByLabel('內容').fill('   ')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('alert')).toHaveText('日期不能晚於今天')
  })

  test('editing an entry to a future date is rejected; the stored date is kept', async ({
    page,
  }) => {
    await startApp(page)
    const id = await createEntry(page, 'Original entry')
    const today = await browserLocalDate(page)
    const tomorrow = await browserLocalDate(page, 1)

    await page.getByLabel('日期').fill(tomorrow)
    await page.getByLabel('內容').fill('Edited text that must not be saved')
    await page.getByRole('button', { name: '儲存' }).click()

    await expect(page.getByRole('alert')).toHaveText('日期不能晚於今天')
    await expect(page.getByRole('status')).toHaveText('')
    // The typed values stay in the form.
    await expect(page.getByLabel('日期')).toHaveValue(tomorrow)
    await expect(page.getByLabel('內容')).toHaveValue('Edited text that must not be saved')

    const stored = (await readStore(page, 'entries')).find((e) => e.id === id)
    expect(stored.date).toBe(today)
    expect(stored.content).toBe('Original entry')

    await page.reload()
    await expect(page.getByLabel('日期')).toHaveValue(today)
    await expect(page.getByLabel('內容')).toHaveValue('Original entry')
  })

  test('an existing future-dated entry is still listed and opens; saving it is blocked', async ({
    page,
  }) => {
    await startApp(page)
    const future = await browserLocalDate(page, 3)
    const now = new Date().toISOString()
    // Simulate data created before this rule (or on a device ahead in time).
    await page.evaluate(
      (record) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('nikki-ai')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result
            const tx = db.transaction('entries', 'readwrite')
            tx.objectStore('entries').put(record)
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.onerror = () => reject(tx.error)
          }
        }),
      {
        id: 'future-entry',
        date: future,
        content: 'From the future',
        language: 'auto',
        createdAt: now,
        updatedAt: now,
        deleted: false,
        deletedAt: null,
        analysis: null,
      },
    )

    await page.reload()
    await expect(entryItems(page)).toHaveCount(1)
    await expect(entryItems(page).locator('time')).toHaveText(future)
    await entryItems(page).getByRole('link').click()
    await expect(page).toHaveURL(/\/nikki-ai\/entry\/future-entry$/)
    await expect(page.getByLabel('日期')).toHaveValue(future)
    await expect(page.getByLabel('內容')).toHaveValue('From the future')

    await page.getByLabel('內容').fill('Edited future entry')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('alert')).toHaveText('日期不能晚於今天')
    await expect(page.getByRole('status')).toHaveText('')
    const stored = (await readStore(page, 'entries')).find((e) => e.id === 'future-entry')
    expect(stored.content).toBe('From the future')

    // Moving it back to today makes it savable.
    const today = await browserLocalDate(page)
    await page.getByLabel('日期').fill(today)
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('status')).toHaveText('已儲存')
  })
})
