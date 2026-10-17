import { test, expect } from '@playwright/test'
import { HOME_URL, WELCOME_URL, readStore, startApp } from './helpers.js'

// E2E for T6c: the first-use welcome page (spec 3.5, 4.3, 8.1-7).
// Each test runs in a fresh browser context, i.e. a real first visit.

const SAMPLE_CONTENT =
  '今日は友達と一緒に新しいカフェを行きました。店の中はとても静かで、コーヒーもおいしいでした。私はケーキを二つ食べましたから、お腹がいっぱいになりました。そのあと、公園を散歩しました。明日も早く起きるつもりです、でも少し疲れました。'

const ANALYSIS_SECTIONS = [
  '判斷的語言',
  '文法錯誤',
  '不通順或易誤會的句子',
  '更道地的說法',
  '修改後全文',
  '中文翻譯',
]

const entryItems = (page) => page.locator('ul.entries > li')
const startButton = (page) => page.getByRole('button', { name: '開始使用' })

async function expectWelcomeContent(page) {
  await expect(page.getByRole('heading', { level: 2, name: '歡迎使用外語學習日記' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: '這個 App 可以做什麼' })).toBeVisible()
  await expect(page.getByText(/^寫日記：/)).toBeVisible()
  await expect(page.getByText(/AI 批改功能即將推出/)).toBeVisible()
  await expect(page.getByText(SAMPLE_CONTENT, { exact: true })).toBeVisible()
  for (const name of ANALYSIS_SECTIONS) {
    await expect(page.getByRole('region', { name })).toBeVisible()
  }
  await expect(startButton(page)).toBeVisible()
}

async function expectHomeWithoutRedirect(page) {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
  await expect(page).toHaveURL(HOME_URL)
}

test.describe('welcome page', () => {
  test('first visit to the home page redirects to the welcome page', async ({ page }) => {
    await page.goto('./')
    await expect(page).toHaveURL(WELCOME_URL)
    await expectWelcomeContent(page)
    // The diary list is not shown on the welcome page.
    await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toHaveCount(0)
  })

  test('shows the full sample analysis with bold changes and no raw markup', async ({ page }) => {
    await page.goto('./')
    await expect(page).toHaveURL(WELCOME_URL)

    await expect(page.getByRole('region', { name: '判斷的語言' })).toContainText('日文')
    const grammar = page.getByRole('region', { name: '文法錯誤' })
    await expect(grammar.getByRole('listitem')).toHaveCount(2)
    await expect(grammar).toContainText('カフェに行きました')
    await expect(page.getByRole('region', { name: '不通順或易誤會的句子' }).getByRole('listitem')).toHaveCount(1)
    const natural = page.getByRole('region', { name: '更道地的說法' })
    await expect(natural.getByRole('listitem')).toHaveCount(2)
    await expect(natural).toContainText('ケーキを二つも食べちゃったので')
    await expect(page.getByRole('region', { name: '中文翻譯' })).toContainText('雖然有點累了')

    const corrected = page.getByRole('region', { name: '修改後全文' })
    await expect(corrected.locator('strong')).toHaveText([
      'に',
      'かった',
      '少し疲れましたが、明日も早く起きるつもりです。',
    ])
    // No raw ** markers anywhere, and no HTML elements built from AI text.
    expect(await page.locator('main').innerText()).not.toContain('**')
    await expect(page.locator('main img, main script, main iframe')).toHaveCount(0)
    // analyzedAt is not shown.
    expect(await page.locator('main').innerText()).not.toContain('2026-01-01')
  })

  test('開始使用 goes home with an empty list; the welcome page does not come back', async ({
    page,
    context,
  }) => {
    await page.goto('./')
    await expect(page).toHaveURL(WELCOME_URL)
    await startButton(page).click()

    await expect(page).toHaveURL(HOME_URL)
    await expect(page.getByText(/還沒有日記/)).toBeVisible()
    await expect(entryItems(page)).toHaveCount(0)

    // Stored state: welcomeSeen is true and the sample was never written.
    expect(await readStore(page, 'settings')).toEqual({ welcomeSeen: true })
    expect(await readStore(page, 'entries')).toEqual([])

    // Reload: no redirect.
    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
    await expect(page).toHaveURL(HOME_URL)

    // New tab in the same profile: no redirect.
    const other = await context.newPage()
    await expectHomeWithoutRedirect(other)
  })

  test('the welcome page stays dismissed after closing and reopening the browser', async ({
    browser,
  }) => {
    const first = await browser.newContext()
    const page = await first.newPage()
    await startApp(page)
    const state = await first.storageState({ indexedDB: true })
    await first.close()

    const second = await browser.newContext({ storageState: state })
    const page2 = await second.newPage()
    await expectHomeWithoutRedirect(page2)
    expect(await readStore(page2, 'settings')).toEqual({ welcomeSeen: true })
    await second.close()
  })

  test('without pressing 開始使用 the welcome page is shown again', async ({ page }) => {
    await page.goto('./')
    await expect(page).toHaveURL(WELCOME_URL)
    // Leave via the header title instead of 開始使用.
    await page.getByRole('link', { name: '外語學習日記' }).click()
    await expect(page).toHaveURL(WELCOME_URL)
    await page.reload()
    await expect(page).toHaveURL(WELCOME_URL)
    expect((await readStore(page, 'settings')).welcomeSeen).not.toBe(true)
  })

  test('if saving welcomeSeen fails, 開始使用 still leaves the welcome page', async ({ page }) => {
    // Make every write to the settings store throw, before the app loads.
    await page.addInitScript(() => {
      const originalPut = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'settings') {
          throw new DOMException('Simulated settings write failure', 'UnknownError')
        }
        return originalPut.apply(this, args)
      }
    })

    await page.goto('./')
    await expect(page).toHaveURL(WELCOME_URL)
    await startButton(page).click()

    // Home with the (empty) list, and not bounced back to /welcome.
    await expect(page).toHaveURL(HOME_URL)
    await expect(page.getByText(/還沒有日記/)).toBeVisible()
    await expect(startButton(page)).toHaveCount(0)
    // Navigating home again within this page load still does not redirect.
    await page.getByRole('link', { name: '新增日記' }).click()
    await page.getByRole('link', { name: '取消' }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()

    // Nothing was stored, so after a reload the welcome page may show again.
    expect(await readStore(page, 'settings')).toEqual({})
    await page.reload()
    await expect(page).toHaveURL(WELCOME_URL)
  })

  test('the 使用說明 link reopens the welcome page without resetting it', async ({ page }) => {
    await startApp(page)

    await page.getByRole('link', { name: '使用說明' }).click()
    await expect(page).toHaveURL(WELCOME_URL)
    await expectWelcomeContent(page)

    await startButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
    expect(await readStore(page, 'settings')).toEqual({ welcomeSeen: true })

    // Still no automatic redirect afterwards.
    await expectHomeWithoutRedirect(page)
    // Viewing it via the link and leaving another way changes nothing either.
    await page.getByRole('link', { name: '使用說明' }).click()
    await expect(page).toHaveURL(WELCOME_URL)
    await page.getByRole('link', { name: '外語學習日記' }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expectHomeWithoutRedirect(page)
  })

  test('opening /entry/new directly on a first visit does not redirect', async ({ page }) => {
    await page.goto('./entry/new')
    await expect(page).toHaveURL(/\/nikki-ai\/entry\/new$/)
    await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
    await expect(page.getByLabel('內容')).toBeVisible()
  })

  test('after the welcome page, the list only has the user entry (no sample)', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    await page.getByLabel('內容').fill('My first real entry')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(HOME_URL)

    await expect(entryItems(page)).toHaveCount(1)
    await expect(entryItems(page).locator('.entry-preview')).toHaveText('My first real entry')
    await expect(page.getByText(/カフェ/)).toHaveCount(0)
    const entries = await readStore(page, 'entries')
    expect(entries.map((e) => e.content)).toEqual(['My first real entry'])
  })

  test('the welcome flow writes nothing to the console', async ({ page }) => {
    const messages = []
    page.on('console', (msg) => {
      const text = msg.text()
      // Ignore dev-server and React development notices; only app output counts.
      if (text.startsWith('[vite]') || text.includes('React DevTools')) return
      messages.push(`${msg.type()}: ${text}`)
    })
    page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`))

    await page.goto('./')
    await expect(page).toHaveURL(WELCOME_URL)
    await expectWelcomeContent(page)
    await startButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await page.getByRole('link', { name: '使用說明' }).click()
    await expect(page).toHaveURL(WELCOME_URL)
    expect(messages).toEqual([])
  })
})
