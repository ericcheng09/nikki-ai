import {
  test,
  expect,
  createFakeDrive,
  installGeminiMock,
  installGisStub,
  readStore,
  settingsIcon,
  topBar,
  HOME_URL,
  WELCOME_URL,
} from './helpers.js'

// Phase 4 acceptance (spec 8.4): one end-to-end path through the UI only,
// on two "devices" (separate browser contexts, a desktop and a phone
// width) sharing one Google Drive. Google sign-in is the GIS stub and
// Drive the in-memory fake from helpers.js; Gemini is mocked. Nothing
// reaches a real service (global guard in helpers.js).
//
// Seeded-data cases (90-day purge, expired login, unreadable files,
// duplicates) are in sync.spec.js and sync-two-devices.spec.js.

const TOKEN_A = 'ya29.ACCEPT-A'
const TOKEN_B = 'ya29.ACCEPT-B'
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const SETTINGS_URL = /\/nikki-ai\/settings$/

const section = (page) => page.getByRole('region', { name: 'Google Drive 同步' })
const stateLine = (page, text) => section(page).getByText(`同步狀態：${text}`, { exact: true })
const cloud = (page) => topBar(page).locator('[data-sync-state]')
const keySection = (page) => page.getByRole('region', { name: 'Gemini API key' })
const modelSelect = (page) => page.getByRole('region', { name: 'Gemini 模型' }).getByLabel('模型', { exact: true })
const languageNames = (page) => page.getByRole('region', { name: '語言清單' }).locator('li .language-name')
const previews = (page) => page.locator('ul.entries > li .entry-preview')
const homeHeading = (page) => page.getByRole('heading', { level: 2, name: '我的日記' })

const opened = []
test.afterEach(async () => {
  while (opened.length) {
    const context = opened.pop()
    await context.unrouteAll({ behavior: 'ignoreErrors' })
    await context.close()
  }
})

async function device(newContext, drive, token, viewport) {
  const context = await newContext({ viewport })
  opened.push(context)
  await installGisStub(context, { token })
  await drive.attach(context)
  const page = await context.newPage()
  const gemini = await installGeminiMock(page)
  return { context, page, token, gemini }
}

const requestsOf = (drive, d) => drive.requests.filter((r) => r.token === d.token)

// Waits until the device is synced and quiet. Waits out the ~2 s change
// debounce first, so a change made just before has been uploaded.
async function settled(d, drive) {
  await d.page.waitForTimeout(2300)
  await expect(cloud(d.page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 10_000 })
  let count = -1
  await expect
    .poll(async () => {
      const previous = count
      count = requestsOf(drive, d).length
      await d.page.waitForTimeout(400)
      return previous === count && cloud(d.page).getAttribute('data-sync-state')
    }, { timeout: 15_000 })
    .toBe('synced')
}

// Cloud icon -> settings -> 立即同步, then back home with the title link.
async function syncFromCloud(d, drive) {
  await settled(d, drive)
  await cloud(d.page).click()
  await expect(d.page).toHaveURL(SETTINGS_URL)
  const before = requestsOf(drive, d).length
  await section(d.page).getByRole('button', { name: '立即同步', exact: true }).click()
  await expect.poll(() => requestsOf(drive, d).length).toBeGreaterThan(before)
  await expect(stateLine(d.page, '已同步')).toBeVisible()
  await settled(d, drive)
  await topBar(d.page).getByRole('link', { name: '外語學習日記', exact: true }).click()
  await expect(homeHeading(d.page)).toBeVisible()
}

async function writeEntry(page, content, { other } = {}) {
  await page.getByRole('link', { name: '新增日記' }).click()
  await page.getByLabel('內容').fill(content)
  if (other) {
    await page.getByLabel('語言', { exact: true }).selectOption({ label: '其他' })
    await page.getByLabel('語言名稱', { exact: true }).fill(other)
  }
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page).toHaveURL(ENTRY_URL)
  await topBar(page).getByRole('link', { name: '外語學習日記', exact: true }).click()
  await expect(homeHeading(page)).toBeVisible()
}

test.describe.configure({ timeout: 120_000 })

test('Phase 4 acceptance: two devices sync diary, languages, key and model through Google Drive', async ({ newContext }) => {
  const drive = createFakeDrive({ validTokens: [TOKEN_A, TOKEN_B] })
  const A = await device(newContext, drive, TOKEN_A, { width: 1280, height: 900 })
  const B = await device(newContext, drive, TOKEN_B, { width: 375, height: 800 })

  // 8.4-1: A without signing in: everything works, data stays local.
  await A.page.goto('./')
  await expect(A.page).toHaveURL(WELCOME_URL)
  await A.page.getByRole('button', { name: '開始使用' }).click()
  await expect(homeHeading(A.page)).toBeVisible()
  await writeEntry(A.page, '오늘은 친구와 카페에 갔어요.', { other: '韓文' })
  await writeEntry(A.page, 'Written on A before signing in.')
  await settingsIcon(A.page).click()
  await keySection(A.page).getByLabel('API key', { exact: true }).fill('accept-key-123')
  await keySection(A.page).getByRole('button', { name: '儲存' }).click()
  await expect(modelSelect(A.page)).toHaveValue('models/gemini-2.5-flash')
  await modelSelect(A.page).selectOption('models/gemini-2.5-pro')
  await expect(languageNames(A.page)).toHaveText(['韓文'])
  await A.page.waitForTimeout(2500)
  expect(drive.requests).toEqual([])
  await expect(cloud(A.page)).toHaveCount(0)

  // 8.4-2: sign in on A (drive.appdata via the GIS stub); first sync.
  await section(A.page).getByRole('button', { name: '登入 Google', exact: true }).click()
  await expect(section(A.page).getByText('已登入', { exact: true })).toBeVisible()
  await expect(stateLine(A.page, '已同步')).toBeVisible()
  await expect(section(A.page).getByText(/^上次同步：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeVisible()
  await expect(cloud(A.page)).toHaveAccessibleName('同步狀態：已同步')
  expect(drive.files.size).toBe(1)
  expect(drive.file().parents).toEqual(['appDataFolder'])

  // 8.4-9: B opens settings first and signs in; welcomeSeen is not synced,
  // so B's home page still starts with the welcome page.
  await B.page.goto('./settings')
  await section(B.page).getByRole('button', { name: '登入 Google', exact: true }).click()
  await expect(stateLine(B.page, '已同步')).toBeVisible()
  await topBar(B.page).getByRole('link', { name: '外語學習日記', exact: true }).click()
  await expect(B.page).toHaveURL(WELCOME_URL)
  await B.page.getByRole('button', { name: '開始使用' }).click()
  await expect(B.page).toHaveURL(HOME_URL)

  // 8.4-3, 8.4-4, 8.4-12: B has A's entries, language, key and model.
  await expect(previews(B.page)).toHaveText(['Written on A before signing in.', '오늘은 친구와 카페에 갔어요.'])
  await settingsIcon(B.page).click()
  await expect(keySection(B.page).getByLabel('API key', { exact: true })).toHaveValue('accept-key-123')
  await expect(modelSelect(B.page)).toHaveValue('models/gemini-2.5-pro')
  await expect(languageNames(B.page)).toHaveText(['韓文'])
  await topBar(B.page).getByRole('link', { name: '外語學習日記', exact: true }).click()

  // B writes its own entry and reviews A's Korean entry with A's key/model.
  await writeEntry(B.page, 'Written on B.')
  await B.page.locator('ul.entries > li', { hasText: '오늘은' }).getByRole('link').click()
  await B.page.getByRole('button', { name: 'AI 批改' }).click()
  await expect(B.page.getByText('今天和朋友去了咖啡店。')).toBeVisible()
  expect(B.gemini.generateRequests.at(-1).headers['x-goog-api-key']).toBe('accept-key-123')
  expect(B.gemini.generateRequests.at(-1).url).toContain('models/gemini-2.5-pro:generateContent')
  await topBar(B.page).getByRole('link', { name: '外語學習日記', exact: true }).click()
  await settled(B, drive)

  // A: 立即同步 brings B's entry and the review result.
  await syncFromCloud(A, drive)
  await expect(previews(A.page)).toHaveText(['Written on B.', 'Written on A before signing in.', '오늘은 친구와 카페에 갔어요.'])
  await A.page.locator('ul.entries > li', { hasText: '오늘은' }).getByRole('link').click()
  await expect(A.page.getByText('今天和朋友去了咖啡店。')).toBeVisible()
  await expect(A.page.getByLabel('內容')).toHaveValue('오늘은 친구와 카페에 갔어요.')

  // 8.4-5: A deletes that entry; 8.4-12: A deletes 韓文. B no longer shows them.
  A.page.once('dialog', (dialog) => dialog.accept())
  await A.page.getByRole('button', { name: '刪除' }).click()
  await expect(homeHeading(A.page)).toBeVisible()
  await settingsIcon(A.page).click()
  await A.page.getByRole('region', { name: '語言清單' }).getByRole('button', { name: '刪除 韓文', exact: true }).click()
  await expect(languageNames(A.page)).toHaveCount(0)
  await settled(A, drive)
  await syncFromCloud(B, drive)
  await expect(previews(B.page)).toHaveText(['Written on B.', 'Written on A before signing in.'])
  await B.page.getByRole('link', { name: '新增日記' }).click()
  await expect(B.page.getByLabel('語言', { exact: true }).locator('option', { hasText: '韓文' })).toHaveCount(0)
  await topBar(B.page).getByRole('link', { name: '外語學習日記', exact: true }).click()

  // 8.4-8: B writes offline; uploaded on reconnect; A sees it.
  await B.context.setOffline(true)
  await writeEntry(B.page, 'Written on B while offline.')
  await expect(cloud(B.page)).toHaveAttribute('data-sync-state', 'error', { timeout: 6000 })
  await B.context.setOffline(false)
  await settled(B, drive)
  await syncFromCloud(A, drive)
  await expect(previews(A.page)).toHaveText(['Written on B while offline.', 'Written on B.', 'Written on A before signing in.'])

  // 8.4-2: A signs out: no more sync, local data kept, Drive data kept.
  await settingsIcon(A.page).click()
  await section(A.page).getByRole('button', { name: '登出', exact: true }).click()
  await expect(section(A.page).getByRole('button', { name: '登入 Google', exact: true })).toBeVisible()
  await expect(cloud(A.page)).toHaveCount(0)
  const afterSignOut = requestsOf(drive, A).length
  await topBar(A.page).getByRole('link', { name: '外語學習日記', exact: true }).click()
  await writeEntry(A.page, 'Written on A after signing out.')
  await A.page.waitForTimeout(3000)
  expect(requestsOf(drive, A).length).toBe(afterSignOut)
  await expect(previews(A.page)).toHaveCount(4)
  expect(drive.json().entries.filter((e) => !e.deleted)).toHaveLength(3)
  expect(JSON.stringify(drive.json())).not.toContain('welcomeSeen')
  expect((await readStore(B.page, 'settings')).welcomeSeen).toBe(true)
})
