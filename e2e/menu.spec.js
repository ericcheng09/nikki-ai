import { test, expect } from '@playwright/test'
import { HOME_URL, WELCOME_URL, readStore, startApp } from './helpers.js'

// E2E for Phase 2 T1: the home page menu (設定 / 使用說明) and the settings
// page skeleton (spec 3.5, 3.6, 8.1-7; decisions.md Phase 2).

const SETTINGS_URL = /\/nikki-ai\/settings$/
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/

const menuButton = (page) => page.getByRole('button', { name: '選單' })
const settingsItem = (page) => page.getByRole('link', { name: '設定', exact: true })
const guideItem = (page) => page.getByRole('link', { name: '使用說明', exact: true })
const homeHeading = (page) => page.getByRole('heading', { level: 2, name: '我的日記' })

async function expectMenuClosed(page) {
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(settingsItem(page)).toHaveCount(0)
  await expect(guideItem(page)).toHaveCount(0)
}

async function openMenu(page) {
  await menuButton(page).click()
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(settingsItem(page)).toBeVisible()
  await expect(guideItem(page)).toBeVisible()
}

async function expectSettingsPage(page) {
  await expect(page).toHaveURL(SETTINGS_URL)
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
  await expect(page.getByRole('link', { name: '回主畫面' })).toBeVisible()
}

test.describe('home page menu', () => {
  test('the home page has a 選單 button at the top right instead of the 使用說明 link', async ({
    page,
  }) => {
    await startApp(page)
    await expect(menuButton(page)).toBeVisible()
    await expectMenuClosed(page)
    // The old standalone link is gone.
    await expect(guideItem(page)).toHaveCount(0)

    // Top right: above the list heading and in the right half of the page.
    const button = await menuButton(page).boundingBox()
    const heading = await homeHeading(page).boundingBox()
    const viewport = page.viewportSize()
    expect(button.y + button.height).toBeLessThanOrEqual(heading.y + 1)
    expect(button.x).toBeGreaterThan(viewport.width / 2)
  })

  test('opening the menu shows 設定 and 使用說明; clicking the button again closes it', async ({
    page,
  }) => {
    await startApp(page)
    await openMenu(page)
    await menuButton(page).click()
    await expectMenuClosed(page)
  })

  test('設定 goes to /settings; 回主畫面 returns home', async ({ page }) => {
    await startApp(page)
    await openMenu(page)
    await settingsItem(page).click()
    await expectSettingsPage(page)
    // The menu is not on the settings page.
    await expect(menuButton(page)).toHaveCount(0)

    await page.getByRole('link', { name: '回主畫面' }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(homeHeading(page)).toBeVisible()
    await expectMenuClosed(page)
  })

  test('使用說明 opens /welcome without resetting welcomeSeen', async ({ page }) => {
    await startApp(page)
    await openMenu(page)
    await guideItem(page).click()
    await expect(page).toHaveURL(WELCOME_URL)
    await expect(page.getByRole('heading', { level: 2, name: '歡迎使用外語學習日記' })).toBeVisible()
    expect(await readStore(page, 'settings')).toEqual({ welcomeSeen: true })

    // Leave without pressing 開始使用: home does not redirect back.
    await page.getByRole('link', { name: '外語學習日記' }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(homeHeading(page)).toBeVisible()
    await expectMenuClosed(page)

    // Not after a fresh load either.
    await page.goto('./')
    await expect(page).toHaveURL(HOME_URL)
    await expect(homeHeading(page)).toBeVisible()
  })

  test('clicking outside closes the menu', async ({ page }) => {
    await startApp(page)
    await openMenu(page)
    await homeHeading(page).click()
    await expectMenuClosed(page)
    await expect(page).toHaveURL(HOME_URL)

    // Also when clicking empty space far from the menu.
    await openMenu(page)
    await page.mouse.click(5, page.viewportSize().height - 5)
    await expectMenuClosed(page)
  })

  test('Escape closes the menu and returns focus to the button', async ({ page }) => {
    await startApp(page)
    await openMenu(page)
    // Move focus into the menu first, as a keyboard user would.
    await settingsItem(page).focus()
    await page.keyboard.press('Escape')
    await expectMenuClosed(page)
    await expect(menuButton(page)).toBeFocused()
    await expect(page).toHaveURL(HOME_URL)
  })

  test('the menu can be used with the keyboard', async ({ page }) => {
    await startApp(page)
    await menuButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Tab')
    await expect(settingsItem(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expectSettingsPage(page)
  })

  test('Tab inside the menu keeps it open; Tab out of it closes it', async ({ page }) => {
    await startApp(page)
    await openMenu(page)
    await expect(menuButton(page)).toBeFocused()

    // Moving between the button and the items keeps the menu open.
    await page.keyboard.press('Tab')
    await expect(settingsItem(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(guideItem(page)).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(settingsItem(page)).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(menuButton(page)).toBeFocused()
    await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(guideItem(page)).toBeFocused()
    await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true')

    // Tab past the last item: focus lands on the next element outside the
    // menu (新增日記) and stays there; the menu closes.
    await page.keyboard.press('Tab')
    const addLink = page.getByRole('link', { name: '新增日記' })
    await expect(addLink).toBeFocused()
    await expectMenuClosed(page)
    await expect(page).toHaveURL(HOME_URL)

    // Shift+Tab out before the button (to the header title) closes it too.
    await openMenu(page)
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('link', { name: '外語學習日記' })).toBeFocused()
    await expectMenuClosed(page)
    await expect(page).toHaveURL(HOME_URL)
  })

  test('the menu is only on the home page', async ({ page }) => {
    await startApp(page)
    await expect(menuButton(page)).toBeVisible()

    await page.goto('./settings')
    await expectSettingsPage(page)
    await expect(menuButton(page)).toHaveCount(0)

    await page.goto('./welcome')
    await expect(page.getByRole('button', { name: '開始使用' })).toBeVisible()
    await expect(menuButton(page)).toHaveCount(0)

    await page.goto('./entry/new')
    await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
    await expect(menuButton(page)).toHaveCount(0)
    await page.getByLabel('內容').fill('Menu check entry')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    await expect(menuButton(page)).toHaveCount(0)
  })
})

test.describe('settings page', () => {
  test('opening /settings directly on a first visit does not redirect', async ({ page }) => {
    await page.goto('./settings')
    await expectSettingsPage(page)
    // Stays there (no delayed redirect after settings load).
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(SETTINGS_URL)
    // 回主畫面 from here: visiting /settings did not mark the welcome page as
    // seen, so a first-time user is still sent to the welcome page.
    await page.getByRole('link', { name: '回主畫面' }).click()
    await expect(page).toHaveURL(WELCOME_URL)
  })

  test('reloading /settings keeps the settings page', async ({ page }) => {
    await startApp(page)
    await openMenu(page)
    await settingsItem(page).click()
    await expectSettingsPage(page)
    await page.reload()
    await expectSettingsPage(page)
  })

  test('browser back from /settings returns home with the menu closed', async ({ page }) => {
    await startApp(page)
    await openMenu(page)
    await settingsItem(page).click()
    await expectSettingsPage(page)
    await page.goBack()
    await expect(page).toHaveURL(HOME_URL)
    await expect(homeHeading(page)).toBeVisible()
    await expectMenuClosed(page)
  })
})
