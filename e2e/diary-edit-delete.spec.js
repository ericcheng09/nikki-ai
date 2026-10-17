import { test, expect, startApp } from './helpers.js'

// E2E for T5: open, edit and (soft) delete diary entries.
// Each test runs in a fresh browser context, so IndexedDB starts empty and
// the first visit goes through the welcome page (startApp() handles it).
// Dates are derived from the browser clock at runtime, never hard-coded.

const CONFIRM_MESSAGE = '確定要刪除這篇日記嗎？刪除後無法復原。'
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const HOME_URL = /\/nikki-ai\/$/

const entryItems = (page) => page.locator('ul.entries > li')

async function browserLocalDate(page, offsetDays = 0) {
  return page.evaluate((offset) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }, offsetDays)
}

// Reads every record of the app's IndexedDB "entries" store, as stored.
async function readStoredEntries(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('nikki-ai')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const request = db.transaction('entries', 'readonly').objectStore('entries').getAll()
          request.onsuccess = () => {
            db.close()
            resolve(request.result)
          }
          request.onerror = () => reject(request.error)
        }
      }),
  )
}

async function openHome(page) {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
}

// Creates an entry from the list and returns its id; stays on the entry page.
async function createEntry(page, content, date) {
  await page.getByRole('link', { name: '新增日記' }).click()
  if (date) await page.getByLabel('日期').fill(date)
  await page.getByLabel('內容').fill(content)
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page).toHaveURL(ENTRY_URL)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
  return new URL(page.url()).pathname.split('/').pop()
}

async function listedPreviews(page) {
  return entryItems(page).locator('.entry-preview').allTextContents()
}

test.describe('open, edit and delete a diary entry', () => {
  test('after creating, the entry page opens and Back returns to the list', async ({ page }) => {
    await startApp(page)
    const id = await createEntry(page, 'Created entry')
    expect(page.url()).toContain(`/nikki-ai/entry/${id}`)
    await expect(page.getByLabel('內容')).toHaveValue('Created entry')

    await page.goBack()
    await expect(page).toHaveURL(HOME_URL)
    await expect(entryItems(page)).toHaveCount(1)
    // The empty new-entry form was replaced in history, not left behind.
    await page.goForward()
    await expect(page).toHaveURL(ENTRY_URL)
  })

  test('opening an entry from the list shows its date and full content', async ({ page }) => {
    await startApp(page)
    const longText = 'Line one.\nLine two with more words. '.repeat(5).trim()
    const id = await createEntry(page, longText)
    const today = await browserLocalDate(page)
    await page.goBack()

    await entryItems(page).first().getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/nikki-ai/entry/${id}$`))
    await expect(page.getByLabel('日期')).toHaveValue(today)
    // Full text (not the list preview), newlines preserved.
    await expect(page.getByLabel('內容')).toHaveValue(longText)
  })

  test('edit content and date: shows 已儲存, persists, and the list re-sorts', async ({ page }) => {
    const consoleMessages = []
    page.on('console', (msg) => consoleMessages.push(msg.text()))

    await startApp(page)
    const today = await browserLocalDate(page)
    const yesterday = await browserLocalDate(page, -1)
    const lastWeek = await browserLocalDate(page, -7)

    await createEntry(page, 'Entry A', yesterday)
    await page.goBack()
    await createEntry(page, 'Entry B', lastWeek)
    await page.goBack()
    expect(await listedPreviews(page)).toEqual(['Entry A', 'Entry B'])

    // Open B (last week) and move it to today with new content.
    await entryItems(page).filter({ hasText: 'Entry B' }).getByRole('link').click()
    const idB = new URL(page.url()).pathname.split('/').pop()
    const createdBefore = (await readStoredEntries(page)).find((e) => e.id === idB)

    await page.getByLabel('日期').fill(today)
    await page.getByLabel('內容').fill('Entry B edited 編集しました')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('status')).toHaveText('已儲存')
    // Editing stays on the same page.
    await expect(page).toHaveURL(new RegExp(`/nikki-ai/entry/${idB}$`))

    // Stored record: same id/createdAt, newer updatedAt, new content and date.
    const stored = (await readStoredEntries(page)).find((e) => e.id === idB)
    expect(stored.content).toBe('Entry B edited 編集しました')
    expect(stored.date).toBe(today)
    expect(stored.createdAt).toBe(createdBefore.createdAt)
    expect(stored.updatedAt > createdBefore.updatedAt).toBe(true)
    expect(stored.deleted).toBe(false)

    // Reload keeps the new content.
    await page.reload()
    await expect(page.getByLabel('內容')).toHaveValue('Entry B edited 編集しました')
    await expect(page.getByLabel('日期')).toHaveValue(today)
    // The status region is always rendered; it must not say 已儲存.
    await expect(page.getByRole('status')).toHaveText('')

    // List reflects new content and new date order; still two entries.
    await openHome(page)
    await expect(entryItems(page)).toHaveCount(2)
    expect(await listedPreviews(page)).toEqual(['Entry B edited 編集しました', 'Entry A'])
    await expect(entryItems(page).locator('time')).toHaveText([today, yesterday])

    expect(consoleMessages.filter((m) => m.includes('Entry B'))).toEqual([])
  })

  test('editing to whitespace only is rejected and the original is kept', async ({ page }) => {
    await startApp(page)
    const id = await createEntry(page, 'Original text')

    for (const blank of ['', '  \n ', '　\t　']) {
      await page.getByLabel('內容').fill(blank)
      await page.getByRole('button', { name: '儲存' }).click()
      await expect(page.getByRole('alert')).toHaveText('內容不能空白')
      // The status region is always rendered; it must not say 已儲存.
      await expect(page.getByRole('status')).toHaveText('')
    }

    const stored = (await readStoredEntries(page)).find((e) => e.id === id)
    expect(stored.content).toBe('Original text')

    await page.reload()
    await expect(page.getByLabel('內容')).toHaveValue('Original text')
    await openHome(page)
    expect(await listedPreviews(page)).toEqual(['Original text'])
  })

  test('cancelling the delete confirmation keeps the entry', async ({ page }) => {
    await startApp(page)
    const id = await createEntry(page, 'Keep me')

    const messages = []
    page.once('dialog', (dialog) => {
      messages.push(`${dialog.type()}:${dialog.message()}`)
      dialog.dismiss()
    })
    await page.getByRole('button', { name: '刪除' }).click()
    await expect.poll(() => messages).toEqual([`confirm:${CONFIRM_MESSAGE}`])

    // Still on the entry page with the content intact.
    await expect(page).toHaveURL(new RegExp(`/nikki-ai/entry/${id}$`))
    await expect(page.getByLabel('內容')).toHaveValue('Keep me')
    const stored = (await readStoredEntries(page)).find((e) => e.id === id)
    expect(stored.deleted).toBe(false)
    expect(stored.content).toBe('Keep me')

    await openHome(page)
    expect(await listedPreviews(page)).toEqual(['Keep me'])
  })

  test('confirming delete soft-deletes, returns home and hides the entry for good', async ({
    page,
  }) => {
    await startApp(page)
    const id = await createEntry(page, 'Delete me please')
    await page.goBack()
    await createEntry(page, 'Other entry stays')
    await page.goBack()
    await expect(entryItems(page)).toHaveCount(2)

    await entryItems(page).filter({ hasText: 'Delete me please' }).getByRole('link').click()
    const before = (await readStoredEntries(page)).find((e) => e.id === id)

    const messages = []
    page.once('dialog', (dialog) => {
      messages.push(`${dialog.type()}:${dialog.message()}`)
      dialog.accept()
    })
    await page.getByRole('button', { name: '刪除' }).click()
    await expect.poll(() => messages).toEqual([`confirm:${CONFIRM_MESSAGE}`])

    await expect(page).toHaveURL(HOME_URL)
    await expect(entryItems(page)).toHaveCount(1)
    expect(await listedPreviews(page)).toEqual(['Other entry stays'])

    // IndexedDB keeps only the 4-field tombstone; content is gone.
    const all = await readStoredEntries(page)
    expect(all).toHaveLength(2)
    const tombstone = all.find((e) => e.id === id)
    expect(Object.keys(tombstone).sort()).toEqual(['deleted', 'deletedAt', 'id', 'updatedAt'])
    expect(tombstone.deleted).toBe(true)
    expect(tombstone.deletedAt).toBe(tombstone.updatedAt)
    expect(tombstone.updatedAt > before.updatedAt).toBe(true)
    expect(JSON.stringify(all)).not.toContain('Delete me please')

    // Still hidden after a reload.
    await page.reload()
    await expect(entryItems(page)).toHaveCount(1)
    expect(await listedPreviews(page)).toEqual(['Other entry stays'])

    // Opening the deleted entry directly shows "not found".
    await page.goto(`./entry/${id}`)
    await expect(page.getByText('找不到這篇日記')).toBeVisible()
    await expect(page.getByLabel('內容')).toHaveCount(0)
    await page.getByRole('link', { name: '回主畫面' }).click()
    await expect(page).toHaveURL(HOME_URL)
  })

  test('opening an id that does not exist shows "not found"', async ({ page }) => {
    await startApp(page)
    await page.goto('./entry/00000000-0000-4000-8000-000000000000')
    await expect(page.getByText('找不到這篇日記')).toBeVisible()
    await expect(page.getByRole('button', { name: '刪除' })).toHaveCount(0)
    await page.getByRole('link', { name: '回主畫面' }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
  })

  test('the new-entry form has no delete button', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
    await expect(page.getByRole('button', { name: '刪除' })).toHaveCount(0)
  })
})
