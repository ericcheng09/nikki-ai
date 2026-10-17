import { test, expect, startApp } from './helpers.js'

// E2E for T4: create diary entries and show them in the list.
// Every test gets a fresh browser context (Playwright default), so each one
// starts with an empty IndexedDB; the first visit goes through the welcome
// page, which startApp() passes through. Dates are computed from the browser clock
// at runtime, never hard-coded, so the suite does not break across days.

// Local YYYY-MM-DD in the browser, `offsetDays` from today.
async function browserLocalDate(page, offsetDays = 0) {
  return page.evaluate((offset) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }, offsetDays)
}

// Each list item is an <li> wrapping a link to the entry page.
const entryItems = (page) => page.locator('ul.entries > li')

async function openHome(page) {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
}

async function expectEmptyList(page) {
  await expect(page.getByText(/還沒有日記/)).toBeVisible()
  await expect(entryItems(page)).toHaveCount(0)
}

// Creates an entry through the UI; `date` is optional (keeps the default).
// After saving, the app opens the new entry's page (replacing the new-entry
// form in history), so going back returns to the list.
async function createEntry(page, content, date) {
  await page.getByRole('link', { name: '新增日記' }).click()
  await expect(page).toHaveURL(/\/nikki-ai\/entry\/new$/)
  if (date) await page.getByLabel('日期').fill(date)
  await page.getByLabel('內容').fill(content)
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page).toHaveURL(/\/nikki-ai\/entry\/(?!new$)[^/]+$/)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
  await expect(page.getByLabel('內容')).toHaveValue(content)
  await page.goBack()
  await expect(page).toHaveURL(/\/nikki-ai\/$/)
  await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
}

async function listedPreviews(page) {
  return entryItems(page).locator('.entry-preview').allTextContents()
}

test.describe('create diary entry', () => {
  test('each test starts with an empty, isolated database', async ({ page }) => {
    await startApp(page)
    await expectEmptyList(page)
  })

  test('main flow: create, save, see it in the list, still there after reload and reopen', async ({
    page,
    context,
  }) => {
    const consoleMessages = []
    page.on('console', (msg) => consoleMessages.push(msg.text()))

    const content = 'Today I went to the park. 今日は公園に行きました。'
    await startApp(page)
    await expectEmptyList(page)
    await createEntry(page, content)

    const today = await browserLocalDate(page)
    await expect(entryItems(page)).toHaveCount(1)
    await expect(entryItems(page).first().locator('time')).toHaveText(today)
    await expect(entryItems(page).first()).toContainText(content)

    // Reload the page.
    await page.reload()
    await expect(entryItems(page)).toHaveCount(1)
    await expect(entryItems(page).first()).toContainText(content)

    // Close the tab and open a new one in the same browser profile.
    await page.close()
    const reopened = await context.newPage()
    await openHome(reopened)
    await expect(entryItems(reopened)).toHaveCount(1)
    await expect(entryItems(reopened).first()).toContainText(content)

    // Diary content must never be written to the console.
    expect(consoleMessages.filter((m) => m.includes('公園'))).toEqual([])
  })

  test('entry survives closing the browser context and restoring its storage', async ({
    newContext,
  }) => {
    const content = 'Persisted across a browser restart.'
    const first = await newContext()
    const page = await first.newPage()
    await startApp(page)
    await createEntry(page, content)
    await expect(entryItems(page)).toHaveCount(1)
    const state = await first.storageState({ indexedDB: true })
    await first.close()

    const second = await newContext({ storageState: state })
    const page2 = await second.newPage()
    await openHome(page2)
    await expect(entryItems(page2)).toHaveCount(1)
    await expect(entryItems(page2).first()).toContainText(content)
    await second.close()
  })

  test('date picker defaults to today in the browser local timezone', async ({ page }) => {
    await startApp(page)
    const before = await browserLocalDate(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    const value = await page.getByLabel('日期').inputValue()
    const after = await browserLocalDate(page)
    // Tolerate the (rare) case where the test straddles local midnight.
    expect([before, after]).toContain(value)
  })

  // At any instant at least one of these zones has a calendar day that
  // differs from UTC, so a UTC-based default would fail in one of them.
  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    test.describe(`in timezone ${timezoneId}`, () => {
      test.use({ timezoneId })

      test('default date follows the local calendar day', async ({ page }) => {
        await startApp(page)
        const before = await browserLocalDate(page)
        await page.getByRole('link', { name: '新增日記' }).click()
        const value = await page.getByLabel('日期').inputValue()
        const after = await browserLocalDate(page)
        expect([before, after]).toContain(value)
      })
    })
  }

  test('whitespace-only content is not saved and shows a message', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()

    for (const blank of ['', '   ', '\n\n', '　　', ' \t\n　 ']) {
      await page.getByLabel('內容').fill(blank)
      await page.getByRole('button', { name: '儲存' }).click()
      await expect(page.getByRole('alert')).toHaveText('內容不能空白')
      await expect(page).toHaveURL(/\/nikki-ai\/entry\/new$/)
    }

    await page.getByRole('link', { name: '取消' }).click()
    await expectEmptyList(page)
    // Nothing was written, even after a reload.
    await page.reload()
    await expectEmptyList(page)
  })

  test('a cleared date is not saved and shows a message', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    await page.getByLabel('日期').fill('')
    await page.getByLabel('內容').fill('No date here')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('alert')).toHaveText('請選擇日期')
    await expect(page).toHaveURL(/\/nikki-ai\/entry\/new$/)
    // Typed content is kept.
    await expect(page.getByLabel('內容')).toHaveValue('No date here')

    await page.getByRole('link', { name: '取消' }).click()
    await expectEmptyList(page)
  })

  test('several entries on the same day are all kept, later one on top', async ({ page }) => {
    await startApp(page)
    await createEntry(page, 'First entry of the day')
    await createEntry(page, 'Second entry of the day')
    await createEntry(page, 'Third entry of the day')

    const today = await browserLocalDate(page)
    await expect(entryItems(page)).toHaveCount(3)
    await expect(entryItems(page).locator('time')).toHaveText([today, today, today])
    expect(await listedPreviews(page)).toEqual([
      'Third entry of the day',
      'Second entry of the day',
      'First entry of the day',
    ])

    // Order is the same after a reload.
    await page.reload()
    await expect(entryItems(page)).toHaveCount(3)
    expect(await listedPreviews(page)).toEqual([
      'Third entry of the day',
      'Second entry of the day',
      'First entry of the day',
    ])
  })

  test('newer diary dates are listed first, regardless of writing order', async ({ page }) => {
    await startApp(page)
    const today = await browserLocalDate(page)
    const threeDaysAgo = await browserLocalDate(page, -3)
    const lastMonth = await browserLocalDate(page, -40)

    // Written today first, then back-filled older dates.
    await createEntry(page, 'Entry for today')
    await createEntry(page, 'Entry for forty days ago', lastMonth)
    await createEntry(page, 'Entry for three days ago', threeDaysAgo)

    await expect(entryItems(page)).toHaveCount(3)
    await expect(entryItems(page).locator('time')).toHaveText([today, threeDaysAgo, lastMonth])
    expect(await listedPreviews(page)).toEqual([
      'Entry for today',
      'Entry for three days ago',
      'Entry for forty days ago',
    ])
  })
})
