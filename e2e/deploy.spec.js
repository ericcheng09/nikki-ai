import {
  test,
  expect,
  HOME_URL,
  WELCOME_URL,
  startApp,
  backButton,
  settingsIcon,
} from './helpers.js'

// E2E for T7: behaviour of the production build as served by GitHub Pages
// (mocked by scripts/pages-server.js): unknown paths return status 404 with
// 404.html (a copy of index.html), so client-side routes still load.
// Only meaningful against the production build: skipped on the local dev
// server, but in CI a dev server is a misconfiguration and must FAIL, so a
// broken setup can never silently skip these checks before deploying.

const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/

test.beforeEach(async ({ request }) => {
  // The Vite dev server injects its client script into index.html.
  const html = await (await request.get('./')).text()
  const isDevServer = html.includes('/@vite/client')
  if (process.env.CI) {
    expect(
      isDevServer,
      'CI must run E2E against the production build (scripts/pages-server.js), ' +
        'but the Vite dev server was detected. Check playwright.config.js.',
    ).toBe(false)
  } else {
    test.skip(isDevServer, 'Production build only (dev server detected)')
  }
})

test.describe('production build on GitHub Pages', () => {
  test('first visit to ./ is served with 200 and redirects to the welcome page', async ({
    page,
  }) => {
    const response = await page.goto('./')
    expect(response.status()).toBe(200)
    await expect(page).toHaveURL(WELCOME_URL)
    await expect(page.getByRole('heading', { level: 2, name: '歡迎使用外語學習日記' })).toBeVisible()
  })

  test('opening ./welcome directly: status 404, app still renders', async ({ page }) => {
    const response = await page.goto('./welcome')
    expect(response.status()).toBe(404)
    await expect(page).toHaveURL(WELCOME_URL)
    await expect(page.getByRole('heading', { level: 2, name: '歡迎使用外語學習日記' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: '外語學習日記' })).toBeVisible()
  })

  test('opening ./entry/new directly: status 404, editor works', async ({ page }) => {
    const response = await page.goto('./entry/new')
    expect(response.status()).toBe(404)
    await expect(page).toHaveURL(/\/nikki-ai\/entry\/new$/)
    await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
    await page.getByLabel('內容').fill('Saved from a direct link')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(page.getByLabel('內容')).toHaveValue('Saved from a direct link')
  })

  test('reloading an entry page: status 404, content still shown', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    await page.getByLabel('內容').fill('Reload me on Pages\nsecond line')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)

    const response = await page.reload()
    expect(response.status()).toBe(404)
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    await expect(page.getByLabel('內容')).toHaveValue('Reload me on Pages\nsecond line')

    // Back to the list through the app, then reload the home page: 200.
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
    const home = await page.reload()
    expect(home.status()).toBe(200)
    await expect(page.locator('ul.entries > li')).toHaveCount(1)
  })

  test('opening and reloading ./settings: status 404, settings page renders', async ({ page }) => {
    // Directly, as a first-time user: no redirect to the welcome page.
    const direct = await page.goto('./settings')
    expect(direct.status()).toBe(404)
    await expect(page).toHaveURL(/\/nikki-ai\/settings$/)
    await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()

    // Reached through the home menu, then reloaded.
    await startApp(page)
    await settingsIcon(page).click()
    await expect(page).toHaveURL(/\/nikki-ai\/settings$/)
    const reloaded = await page.reload()
    expect(reloaded.status()).toBe(404)
    await expect(page).toHaveURL(/\/nikki-ai\/settings$/)
    await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
  })

  test('/nikki-ai redirects to /nikki-ai/', async ({ page, request }) => {
    const raw = await request.get('/nikki-ai', { maxRedirects: 0 })
    expect(raw.status()).toBe(301)
    expect(raw.headers().location).toBe('/nikki-ai/')

    await page.goto('/nikki-ai')
    // Lands on the app (first visit continues on to the welcome page).
    await expect(page).toHaveURL(WELCOME_URL)
    await expect(page.getByRole('heading', { level: 1, name: '外語學習日記' })).toBeVisible()
  })

  test('404.html is identical to index.html and static assets load with 200', async ({
    request,
  }) => {
    const index = await request.get('./')
    expect(index.status()).toBe(200)
    const html = await index.text()

    const notFoundPage = await request.get('./404.html')
    expect(notFoundPage.status()).toBe(200)
    expect(await notFoundPage.text()).toBe(html)

    // Every script and stylesheet referenced by index.html, under /nikki-ai/assets/.
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1])
    expect(assets.some((a) => a.endsWith('.js'))).toBe(true)
    expect(assets.some((a) => a.endsWith('.css'))).toBe(true)
    for (const asset of assets) {
      expect(asset.startsWith('/nikki-ai/assets/')).toBe(true)
      const response = await request.get(asset)
      expect(response.status(), asset).toBe(200)
      expect(response.headers()['content-type']).toMatch(asset.endsWith('.js') ? /javascript/ : /css/)
    }

    // A missing asset is a real 404, not the app shell.
    const missing = await request.get('./assets/does-not-exist.js')
    expect(missing.status()).toBe(404)
  })

  test('the page loads without failed asset requests', async ({ page }) => {
    const failed = []
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.pathname.startsWith('/nikki-ai/assets/') && response.status() !== 200) {
        failed.push(`${response.status()} ${url.pathname}`)
      }
    })
    page.on('requestfailed', (request) => failed.push(`failed ${request.url()}`))
    await page.goto('./entry/new')
    await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
    expect(failed).toEqual([])
  })
})
