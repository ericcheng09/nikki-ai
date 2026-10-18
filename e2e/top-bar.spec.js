import {
  test,
  expect,
  HOME_URL,
  WELCOME_URL,
  backButton,
  guideIcon,
  readStore,
  settingsIcon,
  startApp,
  topBar,
  writeStore,
} from './helpers.js'

// E2E for the fixed top bar (decisions.md 畫面 / 首次使用說明, spec 3.5).
// Replaces the Phase 2 home menu: 「←」 返回 | 外語學習日記 | 設定 + 使用說明
// (only 開始使用 on the welcome page).

const SETTINGS_URL = /\/nikki-ai\/settings$/
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const NEW_URL = /\/nikki-ai\/entry\/new$/
const ENTRY_ID = 'bar-entry'
const LONG_TEXT = '今日はとても長い日記を書きました。\n'.repeat(120)

const titleLink = (page) => topBar(page).getByRole('link', { name: '外語學習日記', exact: true })
const startButton = (page) => page.getByRole('button', { name: '開始使用' })
const homeHeading = (page) => page.getByRole('heading', { level: 2, name: '我的日記' })

async function seedEntry(page, content = 'Bar test entry') {
  await writeStore(page, 'entries', [
    {
      id: ENTRY_ID,
      date: '2026-10-01',
      content,
      language: 'auto',
      createdAt: '2026-10-01T01:00:00.000Z',
      updatedAt: '2026-10-01T01:00:00.000Z',
      deleted: false,
      deletedAt: null,
      analysis: null,
    },
  ])
}

async function openEntry(page) {
  await page.goto(`./entry/${ENTRY_ID}`)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
}

async function expectSettingsPage(page) {
  await expect(page).toHaveURL(SETTINGS_URL)
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
}

test.describe('top bar', () => {
  test('is on every page with the app name linking home', async ({ page }) => {
    await startApp(page)
    await seedEntry(page)
    const pages = [
      ['./', homeHeading(page)],
      ['./entry/new', page.getByRole('heading', { level: 2, name: '新增日記' })],
      [`./entry/${ENTRY_ID}`, page.getByRole('heading', { level: 2, name: '編輯日記' })],
      ['./entry/missing', page.getByText('找不到這篇日記')],
      ['./settings', page.getByRole('heading', { level: 2, name: '設定' })],
      ['./welcome', page.getByRole('heading', { level: 2, name: '歡迎使用外語學習日記' })],
    ]
    for (const [path, marker] of pages) {
      await page.goto(path)
      await expect(marker).toBeVisible()
      await expect(topBar(page), path).toHaveCount(1)
      await expect(titleLink(page), path).toBeVisible()
      await expect(topBar(page).getByRole('heading', { level: 1, name: '外語學習日記' })).toBeVisible()
    }
    // The title goes home (from the entry page, as an example).
    await openEntry(page)
    await titleLink(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(homeHeading(page)).toBeVisible()
  })

  test('stays at the top after scrolling a long page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 })
    await startApp(page)
    // A long home list makes the page scroll (a long diary on the entry
    // page would too, since the 內容 box grows with its text).
    await writeStore(
      page,
      'entries',
      Array.from({ length: 40 }, (_, i) => ({
        id: `long-${i}`,
        date: '2026-10-01',
        content: `${LONG_TEXT.slice(0, 60)} #${i}`,
        language: 'auto',
        createdAt: `2026-10-01T01:00:${String(i).padStart(2, '0')}.000Z`,
        updatedAt: `2026-10-01T01:00:${String(i).padStart(2, '0')}.000Z`,
        deleted: false,
        deletedAt: null,
        analysis: null,
      })),
    )
    for (const path of ['./welcome', './']) {
      await page.goto(path)
      await expect(titleLink(page)).toBeVisible()
      const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight * 1.5)
      expect(scrollable, path).toBe(true)
      await page.mouse.wheel(0, 3000)
      await expect.poll(() => page.evaluate(() => scrollY), { message: path }).toBeGreaterThan(500)
      const box = await topBar(page).boundingBox()
      expect(Math.abs(box.y), path).toBeLessThanOrEqual(1)
      await expect(titleLink(page)).toBeInViewport()
    }
  })

  test('full width, content aligned to the page width (720px / 1120px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await startApp(page)
    await seedEntry(page)
    const inner = page.locator('.app-bar-inner')

    for (const [path, width] of [
      ['./', 720],
      ['./settings', 720],
      ['./entry/new', 720],
      [`./entry/${ENTRY_ID}`, 1120],
    ]) {
      await page.goto(path)
      await expect(titleLink(page)).toBeVisible()
      await expect(page.locator('main h2').first()).toBeVisible()
      const bar = await topBar(page).boundingBox()
      expect(bar.x, path).toBe(0)
      expect(bar.width, path).toBe(1280)
      const innerBox = await inner.boundingBox()
      const appBox = await page.locator('.app').boundingBox()
      expect(innerBox.width, path).toBe(width)
      expect(appBox.width, path).toBe(width)
      expect(Math.abs(innerBox.x - appBox.x), path).toBeLessThanOrEqual(1)
      // Back button (if any) left of the title, icons right of it.
      const title = await titleLink(page).boundingBox()
      const help = await guideIcon(page).boundingBox()
      expect(help.x, path).toBeGreaterThan(title.x + title.width)
      expect(help.x + help.width, path).toBeLessThanOrEqual(innerBox.x + innerBox.width + 1)
    }

    // Narrow screens: still full width, no horizontal scroll.
    await page.setViewportSize({ width: 375, height: 800 })
    await openEntry(page)
    expect((await topBar(page).boundingBox()).width).toBe(375)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('「←」 only on settings and entry pages', async ({ page }) => {
    await startApp(page)
    await seedEntry(page)
    await expect(backButton(page)).toHaveCount(0)
    for (const path of ['./settings', './entry/new', `./entry/${ENTRY_ID}`, './entry/missing']) {
      await page.goto(path)
      await expect(titleLink(page)).toBeVisible()
      await expect(page.locator('main').getByText(/./).first()).toBeVisible()
      await expect(backButton(page), path).toBeVisible()
      await expect(backButton(page)).toHaveText('←')
    }
    await page.goto('./welcome')
    await expect(startButton(page)).toBeVisible()
    await expect(backButton(page)).toHaveCount(0)
    await page.goto('./')
    await expect(homeHeading(page)).toBeVisible()
    await expect(backButton(page)).toHaveCount(0)
  })

  test('「←」 on entry pages goes home', async ({ page }) => {
    await startApp(page)
    await seedEntry(page)

    // New page (unsaved input is simply left behind).
    await page.getByRole('link', { name: '新增日記' }).click()
    await expect(page).toHaveURL(NEW_URL)
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)

    // Entry page opened from the list.
    await page.locator('ul.entries > li a').first().click()
    await expect(page).toHaveURL(ENTRY_URL)
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)

    // Entry page opened directly (no in-app history), and from settings.
    await openEntry(page)
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await page.goto('./settings')
    await expectSettingsPage(page)
    await page.goto(`./entry/${ENTRY_ID}`)
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)

    // Not-found page: 「←」 goes home and 回主畫面 is still there.
    await page.goto('./entry/missing')
    await expect(page.getByText('找不到這篇日記')).toBeVisible()
    await expect(page.locator('main').getByRole('link', { name: '回主畫面' })).toBeVisible()
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await page.goto('./entry/missing')
    await page.locator('main').getByRole('link', { name: '回主畫面' }).click()
    await expect(page).toHaveURL(HOME_URL)
  })

  test('「←」 on settings returns to the page it was opened from', async ({ page }) => {
    await startApp(page)
    await seedEntry(page)

    // From an entry page.
    await openEntry(page)
    await settingsIcon(page).click()
    await expectSettingsPage(page)
    await backButton(page).click()
    await expect(page).toHaveURL(new RegExp(`/nikki-ai/entry/${ENTRY_ID}$`))
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()

    // From the new-entry page.
    await page.goto('./entry/new')
    await settingsIcon(page).click()
    await expectSettingsPage(page)
    await backButton(page).click()
    await expect(page).toHaveURL(NEW_URL)

    // From home.
    await titleLink(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await settingsIcon(page).click()
    await expectSettingsPage(page)
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)

    // Settings → 使用說明 → browser back → 「←」 still returns home.
    await settingsIcon(page).click()
    await guideIcon(page).click()
    await expect(page).toHaveURL(WELCOME_URL)
    await page.goBack()
    await expectSettingsPage(page)
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
  })

  test('「←」 on settings opened directly (first page of the session) goes home', async ({
    page,
  }) => {
    await startApp(page)
    // A full page load of /settings: it is the first history entry of this
    // app session (React Router key 'default'), so 「←」 goes home.
    await page.goto('./settings')
    await expectSettingsPage(page)
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(homeHeading(page)).toBeVisible()
  })

  test('「←」 on settings reloaded after an in-app visit returns to that page', async ({ page }) => {
    await startApp(page)
    await seedEntry(page)
    await openEntry(page)
    await settingsIcon(page).click()
    await expectSettingsPage(page)
    // A reload keeps the in-app history entry (and its key), so 「←」 still
    // goes back to the entry page it was opened from.
    await page.reload()
    await expectSettingsPage(page)
    await backButton(page).click()
    await expect(page).toHaveURL(new RegExp(`/nikki-ai/entry/${ENTRY_ID}$`))
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
  })

  test('「←」 on settings opened directly by a first-time user leads to the welcome page', async ({
    page,
  }) => {
    await page.goto('./settings')
    await expectSettingsPage(page)
    await backButton(page).click()
    // Home decides: welcomeSeen is not set yet.
    await expect(page).toHaveURL(WELCOME_URL)
  })

  test('gear opens settings and is hidden there; 使用說明 keeps welcomeSeen', async ({ page }) => {
    await startApp(page)
    await expect(settingsIcon(page)).toBeVisible()
    await expect(guideIcon(page)).toBeVisible()
    await settingsIcon(page).click()
    await expectSettingsPage(page)
    await expect(settingsIcon(page)).toHaveCount(0)
    await expect(guideIcon(page)).toBeVisible()

    await guideIcon(page).click()
    await expect(page).toHaveURL(WELCOME_URL)
    expect(await readStore(page, 'settings')).toMatchObject({ welcomeSeen: true })
    // Leave without 開始使用: home does not redirect back.
    await titleLink(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await page.goto('./')
    await expect(page).toHaveURL(HOME_URL)
    await expect(homeHeading(page)).toBeVisible()

    // Gear and ? on the entry pages too.
    await page.goto('./entry/new')
    await expect(settingsIcon(page)).toBeVisible()
    await expect(guideIcon(page)).toBeVisible()
  })

  test('the welcome page bar only has 開始使用; it marks welcomeSeen and goes home', async ({
    page,
  }) => {
    await page.goto('./')
    await expect(page).toHaveURL(WELCOME_URL)
    await expect(topBar(page).getByRole('button', { name: '開始使用' })).toBeVisible()
    await expect(settingsIcon(page)).toHaveCount(0)
    await expect(guideIcon(page)).toHaveCount(0)
    await expect(backButton(page)).toHaveCount(0)
    // No second 開始使用 in the page content.
    await expect(page.locator('main').getByRole('button', { name: '開始使用' })).toHaveCount(0)
    await expect(startButton(page)).toHaveCount(1)

    await startButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(homeHeading(page)).toBeVisible()
    expect(await readStore(page, 'settings')).toMatchObject({ welcomeSeen: true })
    await expect(settingsIcon(page)).toBeVisible()
    await expect(startButton(page)).toHaveCount(0)

    // No redirect loop afterwards; reopening the guide and pressing 開始使用 again.
    await page.reload()
    await expect(page).toHaveURL(HOME_URL)
    await guideIcon(page).click()
    await expect(page).toHaveURL(WELCOME_URL)
    await startButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(homeHeading(page)).toBeVisible()
  })

  test('儲存 and 刪除 still work without the bottom links', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    await expect(page.locator('main').getByRole('link', { name: '取消' })).toHaveCount(0)
    await page.getByLabel('內容').fill('Saved via the form')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(page.locator('main').getByRole('link', { name: '返回列表' })).toHaveCount(0)
    await page.getByLabel('內容').fill('Edited via the form')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.locator('form').getByRole('status')).toHaveText('已儲存')

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '刪除' }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(page.locator('ul.entries > li')).toHaveCount(0)
    const [entry] = await readStore(page, 'entries')
    expect(entry.deleted).toBe(true)
  })

  test('settings has no 回主畫面 link in the content', async ({ page }) => {
    await startApp(page)
    await page.goto('./settings')
    await expectSettingsPage(page)
    await expect(page.locator('main').getByRole('link', { name: '回主畫面' })).toHaveCount(0)
  })
})
