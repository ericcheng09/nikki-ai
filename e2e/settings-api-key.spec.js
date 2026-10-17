import { test, expect } from '@playwright/test'
import { readStore, startApp } from './helpers.js'

// E2E for Phase 2 T2: Gemini API key on the settings page
// (spec 3.6, 5.4, 8.2-1; decisions.md 設定頁).
// Only fake keys are used; nothing here talks to Gemini.

const FAKE_KEY = 'test-key-123'
const OTHER_KEY = 'test-key-456'
const AI_STUDIO_URL = 'https://aistudio.google.com/apikey'

const keyInput = (page) => page.getByLabel('API key', { exact: true })
const saveButton = (page) => page.getByRole('button', { name: '儲存' })
const deleteButton = (page) => page.getByRole('button', { name: '刪除' })
const showButton = (page) => page.getByRole('button', { name: '顯示' })
const hideButton = (page) => page.getByRole('button', { name: '隱藏' })
const statusSet = (page) => page.getByText('目前已設定 API key', { exact: true })
const statusUnset = (page) => page.getByText('尚未設定 API key', { exact: true })
const notice = (page) => page.getByRole('status')
const errorAlert = (page) => page.getByRole('alert')

async function openSettings(page) {
  await page.goto('./settings')
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Gemini API key' })).toBeVisible()
}

async function storedKey(page) {
  return (await readStore(page, 'settings')).geminiApiKey
}

async function saveKey(page, key) {
  await keyInput(page).fill(key)
  await saveButton(page).click()
  await expect(notice(page)).toHaveText('已儲存')
  await expect(statusSet(page)).toBeVisible()
}

// Records and dismisses any dialog (e.g. a confirm on delete); tests
// assert the list is empty.
function collectDialogs(page) {
  const dialogs = []
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message())
    await dialog.dismiss()
  })
  return dialogs
}

test.describe('settings: Gemini API key', () => {
  test('initial state: not set, hidden input, no 刪除, help with three steps', async ({ page }) => {
    await openSettings(page)
    await expect(statusUnset(page)).toBeVisible()
    await expect(statusSet(page)).toHaveCount(0)
    await expect(keyInput(page)).toHaveAttribute('type', 'password')
    await expect(keyInput(page)).toHaveValue('')
    await expect(showButton(page)).toBeVisible()
    await expect(saveButton(page)).toBeVisible()
    await expect(deleteButton(page)).toHaveCount(0)

    await expect(page.getByRole('heading', { name: '如何取得 API key' })).toBeVisible()
    await expect(page.locator('ol.settings-steps > li')).toHaveCount(3)
    const link = page.locator(`a[href="${AI_STUDIO_URL}"]`)
    await expect(link).toHaveCount(1)
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    const rel = (await link.getAttribute('rel')).split(/\s+/)
    expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
  })

  test('saving trims whitespace and persists across reload', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, `  ${FAKE_KEY}\t `)
    await expect(deleteButton(page)).toBeVisible()
    await expect(errorAlert(page)).toHaveCount(0)
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    expect(await storedKey(page)).toBe(FAKE_KEY)

    await page.reload()
    await expect(statusSet(page)).toBeVisible()
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    await expect(keyInput(page)).toHaveAttribute('type', 'password')
    await expect(deleteButton(page)).toBeVisible()
    // The 已儲存 notice is not shown again after a reload.
    await expect(notice(page)).toHaveText('')
  })

  test('the key is saved after going through the menu and survives a new browser', async ({
    browser,
  }) => {
    const first = await browser.newContext()
    const page = await first.newPage()
    await startApp(page)
    await page.getByRole('button', { name: '選單' }).click()
    await page.getByRole('link', { name: '設定', exact: true }).click()
    await expect(page.getByRole('heading', { level: 3, name: 'Gemini API key' })).toBeVisible()
    await saveKey(page, FAKE_KEY)
    const state = await first.storageState({ indexedDB: true })
    await first.close()

    const second = await browser.newContext({ storageState: state })
    const page2 = await second.newPage()
    await openSettings(page2)
    await expect(statusSet(page2)).toBeVisible()
    await expect(keyInput(page2)).toHaveValue(FAKE_KEY)
    // Saving the key did not disturb the other settings.
    expect(await readStore(page2, 'settings')).toMatchObject({
      welcomeSeen: true,
      geminiApiKey: FAKE_KEY,
    })
    await second.close()
  })

  test('顯示 / 隱藏 toggles the visibility of the key', async ({ page }) => {
    await openSettings(page)
    await keyInput(page).fill(FAKE_KEY)
    await expect(keyInput(page)).toHaveAttribute('type', 'password')

    await showButton(page).click()
    await expect(keyInput(page)).toHaveAttribute('type', 'text')
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    await expect(showButton(page)).toHaveCount(0)

    await hideButton(page).click()
    await expect(keyInput(page)).toHaveAttribute('type', 'password')
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    await expect(hideButton(page)).toHaveCount(0)

    // Toggling does not save anything.
    await expect(statusUnset(page)).toBeVisible()

    // After a reload the field is hidden again.
    await saveKey(page, FAKE_KEY)
    await showButton(page).click()
    await page.reload()
    await expect(keyInput(page)).toHaveAttribute('type', 'password')
    await expect(showButton(page)).toBeVisible()
  })

  test('blank or whitespace-only input is not saved', async ({ page }) => {
    await openSettings(page)
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入 API key')
    await expect(statusUnset(page)).toBeVisible()
    await expect(deleteButton(page)).toHaveCount(0)

    await keyInput(page).fill('   \t  ')
    await expect(errorAlert(page)).toHaveCount(0)
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入 API key')
    await expect(notice(page)).toHaveText('')
    await expect(statusUnset(page)).toBeVisible()
    expect(await storedKey(page) ?? '').toBe('')

    await page.reload()
    await expect(statusUnset(page)).toBeVisible()
    await expect(keyInput(page)).toHaveValue('')
  })

  test('blank input keeps an existing key', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, FAKE_KEY)

    await keyInput(page).fill('    ')
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入 API key')
    await expect(notice(page)).toHaveText('')
    await expect(statusSet(page)).toBeVisible()
    await expect(deleteButton(page)).toBeVisible()
    expect(await storedKey(page)).toBe(FAKE_KEY)

    await page.reload()
    await expect(statusSet(page)).toBeVisible()
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
  })

  test('modifying the key replaces it', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, FAKE_KEY)
    await saveKey(page, ` ${OTHER_KEY} `)
    await expect(keyInput(page)).toHaveValue(OTHER_KEY)
    expect(await storedKey(page)).toBe(OTHER_KEY)

    await page.reload()
    await expect(keyInput(page)).toHaveValue(OTHER_KEY)
    await expect(statusSet(page)).toBeVisible()
  })

  test('刪除 clears the key without a confirm dialog', async ({ page }) => {
    const dialogs = collectDialogs(page)
    await openSettings(page)
    await saveKey(page, FAKE_KEY)

    await deleteButton(page).click()
    await expect(notice(page)).toHaveText('已刪除')
    await expect(statusUnset(page)).toBeVisible()
    await expect(deleteButton(page)).toHaveCount(0)
    await expect(keyInput(page)).toHaveValue('')
    expect(await storedKey(page) ?? '').toBe('')
    expect(dialogs).toEqual([])

    await page.reload()
    await expect(statusUnset(page)).toBeVisible()
    await expect(keyInput(page)).toHaveValue('')
    await expect(deleteButton(page)).toHaveCount(0)

    // A new key can be saved again afterwards.
    await saveKey(page, OTHER_KEY)
    expect(await storedKey(page)).toBe(OTHER_KEY)
  })

  test('the key never reaches the console or the network', async ({ page }) => {
    const consoleText = []
    page.on('console', (msg) => consoleText.push(msg.text()))
    page.on('pageerror', (error) => consoleText.push(error.message))
    const external = []
    const leaked = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.hostname !== 'localhost') external.push(request.url())
      const payload = [request.url(), request.postData() ?? '', JSON.stringify(request.headers())]
      if (payload.some((part) => part.includes(FAKE_KEY))) leaked.push(request.url())
    })

    await openSettings(page)
    await saveKey(page, `  ${FAKE_KEY}  `)
    await showButton(page).click()
    await page.reload()
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    // An invalid attempt and a delete, too.
    await keyInput(page).fill(' ')
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入 API key')
    await keyInput(page).fill(FAKE_KEY)
    await deleteButton(page).click()
    await expect(notice(page)).toHaveText('已刪除')
    await page.getByRole('link', { name: '回主畫面' }).click()
    await page.waitForLoadState('networkidle')

    expect(consoleText.filter((text) => text.includes(FAKE_KEY))).toEqual([])
    expect(external).toEqual([])
    expect(leaked).toEqual([])
  })
})
