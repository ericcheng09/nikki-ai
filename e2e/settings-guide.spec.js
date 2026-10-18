import { test, expect, installGeminiMock, readStore } from './helpers.js'

// E2E for Phase 2 F7: collapsible 「如何取得 API key」 guide on the settings
// page (decisions.md Phase 2 設定頁). The 「？如何取得」 button on the
// 「API key」 label row expands or collapses it. Initial state, decided once
// after the settings load: expanded without a key, collapsed with one.
// Saving or deleting a key never toggles it. Only fake keys; the models
// request is always mocked.

const FAKE_KEY = 'test-key-123'
const AI_STUDIO_URL = 'https://aistudio.google.com/apikey'
const STORAGE_NOTE = 'API key 只會存在這個瀏覽器，只用來呼叫 Gemini，不會傳送到其他地方。'

const keySection = (page) => page.getByRole('region', { name: 'Gemini API key' })
const keyInput = (page) => keySection(page).getByLabel('API key', { exact: true })
const toggle = (page) => keySection(page).getByRole('button', { name: '？如何取得' })
const guide = (page) => page.getByRole('region', { name: '如何取得 API key' })
// The guide stays in the DOM while hidden; find it regardless of visibility.
const guideAny = (page) => keySection(page).locator('[role="region"]', { hasText: '如何取得 API key' })
const saveButton = (page) => keySection(page).getByRole('button', { name: '儲存', exact: true })
const deleteButton = (page) => keySection(page).getByRole('button', { name: '刪除', exact: true })
const notice = (page) => keySection(page).locator('form').getByRole('status')

let gemini

test.beforeEach(async ({ page }) => {
  gemini = await installGeminiMock(page)
})

async function openSettings(page) {
  await page.goto('./settings')
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
  await expect(keyInput(page)).toBeVisible()
}

async function saveKey(page, key = FAKE_KEY) {
  await keyInput(page).fill(key)
  await saveButton(page).click()
  await expect(notice(page)).toHaveText('已儲存')
  await expect(keySection(page).getByText('API key 可以使用', { exact: true })).toBeVisible()
}

async function expectOpen(page) {
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(guide(page)).toBeVisible()
  await expect(guide(page).locator('ol > li')).toHaveCount(3)
  await expect(guide(page).getByText(STORAGE_NOTE)).toBeVisible()
}

async function expectClosed(page) {
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(guideAny(page)).toBeHidden()
  await expect(guideAny(page)).toHaveAttribute('hidden', '')
  await expect(page.locator(`a[href="${AI_STUDIO_URL}"]`)).toBeHidden()
}

test.describe('settings: API key guide', () => {
  test('first visit without a key: expanded, linked to the toggle, with steps, link and note', async ({
    page,
  }) => {
    await openSettings(page)
    await expectOpen(page)
    // aria-controls points at the guide region.
    const controls = await toggle(page).getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    await expect(page.locator(`[id="${controls}"]`)).toHaveAttribute('role', 'region')
    await expect(page.locator(`[id="${controls}"]`)).toContainText('如何取得 API key')
    // The AI Studio link opens a new tab safely.
    const link = guide(page).locator(`a[href="${AI_STUDIO_URL}"]`)
    await expect(link).toHaveCount(1)
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    const rel = (await link.getAttribute('rel')).split(/\s+/)
    expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
  })

  test('with a saved key the page opens collapsed; the toggle opens it', async ({ page }) => {
    await openSettings(page)
    await saveKey(page)
    await page.reload()
    await expect(keySection(page).getByText('API key 可以使用', { exact: true })).toBeVisible()
    await expectClosed(page)
    await toggle(page).click()
    await expectOpen(page)
    const link = guide(page).locator(`a[href="${AI_STUDIO_URL}"]`)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(link).toHaveAttribute('rel', /noreferrer/)
  })

  test('click, Enter and Space toggle it; toggling never saves or sends a request', async ({
    page,
  }) => {
    await openSettings(page)
    await page.waitForLoadState('networkidle')
    const settingsBefore = await readStore(page, 'settings')
    await expectOpen(page)

    await toggle(page).click()
    await expectClosed(page)
    await toggle(page).click()
    await expectOpen(page)

    await toggle(page).focus()
    await page.keyboard.press('Enter')
    await expectClosed(page)
    await expect(toggle(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expectOpen(page)
    await page.keyboard.press('Space')
    await expectClosed(page)
    await page.keyboard.press('Space')
    await expectOpen(page)
    await expect(toggle(page)).toBeFocused()

    // With text typed in the field, the toggle does not submit it either.
    await keyInput(page).fill(FAKE_KEY)
    await toggle(page).click()
    await expectClosed(page)
    await expect(notice(page)).toHaveText('')
    await expect(keySection(page).getByRole('alert')).toHaveCount(0)
    await expect(keySection(page).getByText('尚未設定 API key', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toEqual([])
    expect(await readStore(page, 'settings')).toEqual(settingsBefore)
  })

  test('saving the first key and deleting it keep the guide as the user left it', async ({
    page,
  }) => {
    // Left open: saving does not collapse it, deleting does not change it.
    await openSettings(page)
    await expectOpen(page)
    await saveKey(page)
    await expectOpen(page)
    await deleteButton(page).click()
    await expect(notice(page)).toHaveText('已刪除')
    await expectOpen(page)

    // Closed by the user: saving and deleting do not open it.
    await toggle(page).click()
    await expectClosed(page)
    await saveKey(page)
    await expectClosed(page)
    await deleteButton(page).click()
    await expect(notice(page)).toHaveText('已刪除')
    await expect(keySection(page).getByText('尚未設定 API key', { exact: true })).toBeVisible()
    await expectClosed(page)

    // Starting collapsed (key saved), deleting the key does not open it.
    await saveKey(page)
    await page.reload()
    await expectClosed(page)
    await deleteButton(page).click()
    await expect(notice(page)).toHaveText('已刪除')
    await expectClosed(page)
    // A reload without a key starts expanded again.
    await page.reload()
    await expect(keyInput(page)).toBeVisible()
    await expectOpen(page)
  })

  test('375px: the toggle sits on the API key label row; no horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await openSettings(page)
    const checkRow = async () => {
      const label = await keySection(page).locator('label', { hasText: 'API key' }).boundingBox()
      const button = await toggle(page).boundingBox()
      const input = await keyInput(page).boundingBox()
      // The input row: the input plus its 顯示 / 隱藏 button.
      const row = await keySection(page).locator('.input-row').boundingBox()
      // Same row as the label, to its right, above the input, within the field width.
      expect(button.y).toBeLessThan(label.y + label.height)
      expect(button.y + button.height).toBeGreaterThan(label.y)
      expect(button.x).toBeGreaterThanOrEqual(label.x + label.width)
      expect(button.y + button.height).toBeLessThanOrEqual(input.y + 1)
      expect(button.x + button.width).toBeLessThanOrEqual(row.x + row.width + 1)
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    }
    await expectOpen(page)
    await checkRow()
    await toggle(page).click()
    await expectClosed(page)
    await checkRow()
    await saveKey(page)
    await checkRow()
  })

  test('if the settings cannot be read, the guide is shown expanded without a toggle', async ({
    page,
  }) => {
    // Make every IndexedDB open fail before the app starts.
    await page.addInitScript(() => {
      IDBFactory.prototype.open = function open() {
        throw new DOMException('blocked for test', 'UnknownError')
      }
    })
    await page.goto('./settings')
    await expect(keySection(page).getByRole('alert')).toHaveText('無法讀取設定，請重新整理頁面。')
    await expect(toggle(page)).toHaveCount(0)
    await expect(guide(page)).toBeVisible()
    await expect(guide(page).locator('ol > li')).toHaveCount(3)
    await expect(guide(page).locator(`a[href="${AI_STUDIO_URL}"]`)).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toEqual([])
  })
})
