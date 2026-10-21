import { readFileSync } from 'node:fs'
import {
  test,
  expect,
  startApp,
  settingsIcon,
  installGeminiMock,
  installGisStub,
  createFakeDrive,
  writeStore,
  signedInAuth,
  GOOGLE_TOKEN,
} from './helpers.js'

// E2E for V3: the app version at the bottom of the settings page
// (decisions.md 版號): 「版本 x.y.z」 in small grey text, where x.y.z is
// package.json `version` (the single source). Runs against the dev
// server and the production build; deploy.spec.js also checks that the
// built bundle has no leftover __APP_VERSION__ placeholder.

const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const VERSION_TEXT = `版本 ${VERSION}`

const versionLine = (page) => page.getByText(VERSION_TEXT, { exact: true })

async function openSettings(page) {
  await settingsIcon(page).click()
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Google Drive 同步' })).toBeVisible()
}

// The version line is the last element of the settings page, after
// every section, and nothing in the page shows another version.
async function expectVersionAtBottom(page) {
  await expect(versionLine(page)).toBeVisible()
  await expect(page.getByText(/版本\s/)).toHaveCount(1)
  const position = await versionLine(page).evaluate((el) => {
    const page = el.closest('section.settings')
    const sections = [...page.querySelectorAll('section')]
    const bottom = el.getBoundingClientRect().top
    return {
      last: page.lastElementChild === el,
      belowAll: sections.every((s) => s.getBoundingClientRect().bottom <= bottom),
    }
  })
  expect(position).toEqual({ last: true, belowAll: true })
}

test.describe('settings: app version', () => {
  test('version from package.json at the bottom, in small grey text', async ({ page }) => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    await startApp(page)
    await openSettings(page)
    await expectVersionAtBottom(page)

    const style = await versionLine(page).evaluate((el) => {
      const own = getComputedStyle(el)
      const body = getComputedStyle(el.closest('section.settings'))
      return {
        color: own.color,
        smaller: parseFloat(own.fontSize) < parseFloat(body.fontSize),
      }
    })
    expect(style).toEqual({ color: 'rgb(102, 102, 102)', smaller: true })
    // No placeholder or empty version anywhere in the page.
    await expect(page.locator('body')).not.toContainText('__APP_VERSION__')
  })

  test('still last with an API key, the model section and Google signed in', async ({ page }) => {
    await installGeminiMock(page)
    await installGisStub(page)
    const drive = createFakeDrive({ validTokens: [GOOGLE_TOKEN] })
    await drive.attach(page.context())
    await startApp(page)
    await writeStore(page, 'settings', {
      geminiApiKey: 'test-key-123',
      geminiModel: 'models/gemini-2.5-flash',
      googleAuth: signedInAuth(),
    })
    await page.reload()
    await openSettings(page)
    await expect(page.getByRole('heading', { level: 3, name: 'Gemini 模型' })).toBeVisible()
    await expect(page.getByText('已登入', { exact: true })).toBeVisible()
    await expectVersionAtBottom(page)
  })

  test('opening ./settings directly shows the version', async ({ page }) => {
    await page.goto('./settings')
    await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
    await expectVersionAtBottom(page)
  })

  test('375px wide: visible after scrolling to the bottom, no horizontal scrolling', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await startApp(page)
    await openSettings(page)
    await versionLine(page).scrollIntoViewIfNeeded()
    await expect(versionLine(page)).toBeInViewport()
    await expectVersionAtBottom(page)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
})
