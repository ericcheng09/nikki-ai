import {
  test,
  expect,
  GOOGLE_TOKEN,
  createFakeDrive,
  gisCalls,
  installGeminiMock,
  installGisStub,
  readStore,
  setGisMode,
  settingsIcon,
  guideIcon,
  signedInAuth,
  startApp,
  syncFile,
  topBar,
  writeStore,
} from './helpers.js'

// E2E for Phase 4 T5: the sync engine, its triggers and the status UI
// (spec 3.4, 6, 8.4-1/3/5/6/7/8/9/10; decisions.md Phase 4), on one
// device. Google is replaced by the GIS stub and the in-memory fake Drive
// from helpers.js; the global guard fails the test on any other external
// request.

const TOKEN = GOOGLE_TOKEN
const DAY = 24 * 60 * 60 * 1000
const EXPIRED = 'Google 登入已過期，請重新登入。'
const MESSAGES = {
  offline: '無法連線到 Google Drive，恢復網路後會自動同步。',
  quota: 'Google Drive 暫時無法使用，請稍後再試。',
  paused: 'Google Drive 上的同步資料無法讀取，為避免資料遺失已暫停同步。',
  other: '同步失敗，請稍後再試。',
}
const LAST_SYNC = /^上次同步：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const SETTINGS_URL = /\/nikki-ai\/settings$/

const section = (page) => page.getByRole('region', { name: 'Google Drive 同步' })
const stateLine = (page, text) => section(page).getByText(`同步狀態：${text}`, { exact: true })
const lastSyncLine = (page) => section(page).getByText(/^上次同步：/)
const syncNowButton = (page) => section(page).getByRole('button', { name: '立即同步', exact: true })
const signInButton = (page) => section(page).getByRole('button', { name: '登入 Google', exact: true })
const reLoginButton = (page) => section(page).getByRole('button', { name: '重新登入', exact: true })
const signOutButton = (page) => section(page).getByRole('button', { name: '登出', exact: true })
const errorLine = (page) => section(page).locator('p.error')
const cloud = (page) => topBar(page).locator('[data-sync-state]')
const keySection = (page) => page.getByRole('region', { name: 'Gemini API key' })
const keyInput = (page) => keySection(page).getByLabel('API key', { exact: true })
const modelSelect = (page) => page.getByRole('region', { name: 'Gemini 模型' }).getByLabel('模型', { exact: true })
const listSection = (page) => page.getByRole('region', { name: '語言清單' })
const languageNames = (page) => listSection(page).locator('li .language-name')
const entryItems = (page) => page.locator('ul.entries > li')
const previews = (page) => entryItems(page).locator('.entry-preview')

const iso = (ms) => new Date(ms).toISOString()
const pad = (n) => String(n).padStart(2, '0')
function localDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * DAY)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function entry(id, content, { date = localDate(), at = '2026-10-01T01:00:00.000Z' } = {}) {
  return {
    id,
    date,
    content,
    language: 'auto',
    createdAt: at,
    updatedAt: at,
    deleted: false,
    deletedAt: null,
    analysis: null,
  }
}
function tombstone(id, at) {
  return { id, updatedAt: at, deleted: true, deletedAt: at }
}
function language(name, at, deleted = false) {
  return { name, updatedAt: at, deleted, deletedAt: deleted ? at : null }
}

// Fresh browser with the GIS stub and the fake Drive attached.
async function setup(page, { drive = createFakeDrive(), gisMode = 'ok' } = {}) {
  await installGisStub(page, { mode: gisMode })
  await drive.attach(page.context())
  return drive
}

// Passes the welcome page, seeds local data and a stored Google sign-in,
// then opens `path`: the app-start sync runs there.
async function startSignedIn(page, { entries = [], settings = {}, auth = signedInAuth(), path = './' } = {}) {
  await startApp(page)
  if (entries.length) await writeStore(page, 'entries', entries)
  await writeStore(page, 'settings', { ...settings, googleAuth: auth })
  await page.goto(path)
}

async function openSettings(page) {
  await page.goto('./settings')
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
}

async function expectSynced(page) {
  await expect(stateLine(page, '已同步')).toBeVisible()
  await expect(lastSyncLine(page)).toHaveText(LAST_SYNC)
  await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
}

async function expectSyncError(page, message) {
  await expect(stateLine(page, '同步失敗')).toBeVisible()
  await expect(errorLine(page)).toHaveText(message)
  await expect(cloud(page)).toHaveAttribute('data-sync-state', 'error')
  await expect(cloud(page)).toHaveAccessibleName('同步狀態：同步失敗')
}

// Waits for the next sync round that uploads (exactly one list and one
// update after `before` requests), checking that nothing was sent during
// the first second (debounce), and that nothing more follows.
async function expectOneDebouncedUpload(drive, before, page) {
  await page.waitForTimeout(1000)
  expect(drive.requests.length, 'nothing during the debounce').toBe(before)
  await expect.poll(() => drive.requests.slice(before).map((r) => r.kind), { timeout: 6000 }).toEqual(['list', 'get', 'update'])
  await page.waitForTimeout(2500)
  expect(drive.requests.slice(before).map((r) => r.kind)).toEqual(['list', 'get', 'update'])
}

// After a page load (= app start): waits for its sync to finish and
// returns the number of Drive requests so far.
async function settled(page, drive) {
  await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
  let count = -1
  await expect.poll(async () => {
    const previous = count
    count = drive.requests.length
    await page.waitForTimeout(300)
    return previous === count
  }).toBe(true)
  return drive.requests.length
}

function localEntries(page) {
  return readStore(page, 'entries')
}
const ids = (records) => records.map((r) => r.id).sort()

// --- Signed out --------------------------------------------------------------------

test.describe('sync: signed out', () => {
  test('no Drive or Google request, no cloud icon, even after changes', async ({ page }) => {
    const drive = await setup(page)
    const external = []
    page.on('request', (r) => {
      if (new URL(r.url()).hostname !== 'localhost') external.push(r.url())
    })
    await startApp(page)
    await expect(cloud(page)).toHaveCount(0)
    await page.getByRole('link', { name: '新增日記' }).click()
    await page.getByLabel('內容').fill('Offline only')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(cloud(page)).toHaveCount(0)
    await page.waitForTimeout(3000)
    await page.reload()
    await expect(page.getByLabel('內容')).toHaveValue('Offline only')
    await page.goto('./')
    await expect(entryItems(page)).toHaveCount(1)
    await expect(cloud(page)).toHaveCount(0)
    expect(external).toEqual([])
    // The settings page shows sign-in only: no status, no 立即同步.
    await openSettings(page)
    await expect(signInButton(page)).toBeVisible()
    await expect(syncNowButton(page)).toHaveCount(0)
    await expect(section(page).getByText(/^同步狀態：/)).toHaveCount(0)
    await expect(cloud(page)).toHaveCount(0)
    expect(drive.requests).toEqual([])
    expect((await gisCalls(page)).requests).toEqual([])
  })
})

// --- First sync / remote data ----------------------------------------------------

test.describe('sync: merging with Drive', () => {
  test('first sign-in creates the Drive file with local data; local-only data stays out', async ({ page }) => {
    const drive = await setup(page)
    await installGeminiMock(page)
    const recent = iso(Date.now() - 2 * DAY)
    await startApp(page)
    await writeStore(page, 'entries', [
      entry('local-a', 'Local A'),
      entry('local-b', 'Local B', { date: localDate(-1) }),
      tombstone('local-gone', recent),
    ])
    await writeStore(page, 'settings', {
      geminiApiKey: 'local-key-123',
      geminiModel: 'models/gemini-2.5-flash',
      customLanguages: [language('韓文', recent), language('法文', recent, true)],
    })
    await openSettings(page)
    await expect(cloud(page)).toHaveCount(0)
    await signInButton(page).click()

    await expectSynced(page)
    await expect(cloud(page)).toHaveAccessibleName('同步狀態：已同步')
    await expect(syncNowButton(page)).toBeVisible()
    expect(drive.requests.map((r) => r.kind)).toEqual(['list', 'create'])
    expect(drive.requests.every((r) => r.token === TOKEN)).toBe(true)

    const file = drive.file()
    expect(file.name).toBe('nikki-ai-sync.json')
    expect(file.parents).toEqual(['appDataFolder'])
    const data = drive.json()
    expect(data.format).toBe('nikki-ai-sync')
    expect(data.version).toBe(1)
    expect(ids(data.entries)).toEqual(['local-a', 'local-b', 'local-gone'])
    expect(data.entries.find((e) => e.id === 'local-a').content).toBe('Local A')
    expect(data.entries.find((e) => e.id === 'local-gone')).toMatchObject({ deleted: true, deletedAt: recent })
    expect(data.customLanguages.map((l) => [l.name, l.deleted])).toEqual([['韓文', false], ['法文', true]])
    expect(data.settings.geminiApiKey.value).toBe('local-key-123')
    expect(data.settings.geminiModel.value).toBe('models/gemini-2.5-flash')
    expect(Object.keys(data.settings).sort()).toEqual(['geminiApiKey', 'geminiModel'])
    // welcomeSeen, the token and other local-only state are never uploaded.
    for (const secret of ['welcomeSeen', TOKEN, 'googleAuth', 'accessToken', 'syncMeta', 'lastSyncedAt']) {
      expect(file.content).not.toContain(secret)
    }
    expect((await readStore(page, 'settings')).welcomeSeen).toBe(true)

    // The cloud is left of the gear on other pages and leads to settings.
    await page.goto('./')
    const icons = topBar(page).locator('.icon-button')
    await expect(icons).toHaveCount(3)
    // Opening the page is an app start: wait for its sync.
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
    expect(await icons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual([
      '同步狀態：已同步',
      '設定',
      '使用說明',
    ])
    await expect(settingsIcon(page)).toBeVisible()
    await expect(guideIcon(page)).toBeVisible()
    await cloud(page).click()
    await expect(page).toHaveURL(SETTINGS_URL)
    // The welcome page keeps only 開始使用 in the bar.
    await page.goto('./welcome')
    await expect(page.getByRole('heading', { level: 2, name: '歡迎使用外語學習日記' })).toBeVisible()
    await expect(cloud(page)).toHaveCount(0)
  })

  test('remote entries reload the home list and calendar; remote tombstones hide entries', async ({ page }) => {
    const drive = await setup(page)
    const older = iso(Date.now() - 3 * DAY)
    const newer = iso(Date.now() - 1 * DAY)
    drive.seed(
      syncFile({
        entries: [entry('remote-1', 'From the other device', { at: newer }), tombstone('local-del', newer)],
      }),
    )
    const release = drive.hold()
    await startSignedIn(page, {
      entries: [entry('local-del', 'Deleted elsewhere', { at: older, date: localDate(-1) }), entry('local-only', 'Only here', { at: older, date: localDate(-2) })],
    })
    // Before the sync answers: the local list.
    await expect(previews(page)).toHaveText(['Deleted elsewhere', 'Only here'])
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'syncing')
    await expect(cloud(page)).toHaveAccessibleName('同步狀態：同步中')
    release()

    // Without reloading the page.
    await expect(previews(page)).toHaveText(['From the other device', 'Only here'])
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
    const d = new Date()
    await expect(
      page.locator('section.calendar').getByRole('button', { name: `${d.getMonth() + 1}月${d.getDate()}日，有日記` }),
    ).toBeVisible()

    const local = await localEntries(page)
    expect(ids(local)).toEqual(['local-del', 'local-only', 'remote-1'])
    expect(local.find((e) => e.id === 'local-del')).toMatchObject({ deleted: true, updatedAt: newer })
    expect(local.find((e) => e.id === 'local-del').content).toBeUndefined()
    // Drive got the local-only entry; the tombstone stays.
    const data = drive.json()
    expect(ids(data.entries)).toEqual(['local-del', 'local-only', 'remote-1'])
    expect(data.entries.find((e) => e.id === 'local-del').deleted).toBe(true)
    expect(drive.requests.map((r) => r.kind)).toEqual(['list', 'get', 'update'])

    // The deleted entry cannot be opened either.
    await page.goto('./entry/local-del')
    await expect(page.getByText('找不到這篇日記')).toBeVisible()
  })

  test('remote API key, model and languages appear on the open settings page', async ({ page }) => {
    const drive = await setup(page)
    const gemini = await installGeminiMock(page)
    const at = iso(Date.now() - DAY)
    drive.seed(
      syncFile({
        customLanguages: [language('法文', at), language('德文', at, true)],
        settings: {
          geminiApiKey: { value: 'remote-key-456', updatedAt: at },
          geminiModel: { value: 'models/gemini-2.5-pro', updatedAt: at },
        },
      }),
    )
    const release = drive.hold()
    await startSignedIn(page, {
      settings: { customLanguages: [language('德文', iso(Date.now() - 2 * DAY))] },
      path: './settings',
    })
    await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
    await expect(languageNames(page)).toHaveText(['德文'])
    await expect(keyInput(page)).toHaveValue('')
    release()

    await expect(keyInput(page)).toHaveValue('remote-key-456')
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-pro')
    await expect(languageNames(page)).toHaveText(['法文'])
    await expectSynced(page)
    // The key is checked with Gemini right away (and only sent there).
    await expect.poll(() => gemini.modelRequests.length).toBeGreaterThan(0)
    expect(gemini.modelRequests.at(-1).headers['x-goog-api-key'] ?? gemini.modelRequests.at(-1).url).toContain('remote-key-456')

    const settings = await readStore(page, 'settings')
    expect(settings.geminiApiKey).toBe('remote-key-456')
    expect(settings.geminiModel).toBe('models/gemini-2.5-pro')
    // Nothing new locally, so Drive was not rewritten.
    expect(drive.requests.map((r) => r.kind)).toEqual(['list', 'get'])

    // Usable on the editor too: the language list includes 法文.
    await page.goto('./entry/new')
    await expect(page.getByLabel('語言', { exact: true }).locator('option', { hasText: '法文' })).toHaveCount(1)
    await expect(page.getByLabel('語言', { exact: true }).locator('option', { hasText: '德文' })).toHaveCount(0)
  })

  test('tombstones older than 90 days are purged locally and on Drive; newer ones kept', async ({ page }) => {
    const drive = await setup(page)
    const old = iso(Date.now() - 100 * DAY)
    const recent = iso(Date.now() - 89 * DAY)
    drive.seed(
      syncFile({
        entries: [tombstone('old-remote', old), tombstone('recent-remote', recent), entry('live', 'Live entry', { at: old })],
        customLanguages: [language('舊語言', old, true), language('新刪除', recent, true), language('法文', old)],
      }),
    )
    await startSignedIn(page, {
      entries: [tombstone('old-local', old), tombstone('recent-local', recent)],
      settings: { customLanguages: [language('本機舊刪除', old, true)] },
    })
    await expect(previews(page)).toHaveText(['Live entry'])
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')

    expect(ids(await localEntries(page))).toEqual(['live', 'recent-local', 'recent-remote'])
    expect(ids(drive.json().entries)).toEqual(['live', 'recent-local', 'recent-remote'])
    const localLanguages = (await readStore(page, 'settings')).customLanguages.map((l) => l.name).sort()
    expect(localLanguages).toEqual(['新刪除', '法文'].sort())
    expect(drive.json().customLanguages.map((l) => l.name).sort()).toEqual(['新刪除', '法文'].sort())
  })

  test('duplicate Drive files are merged into the oldest and the others deleted', async ({ page }) => {
    const drive = await setup(page)
    const at = iso(Date.now() - DAY)
    const oldest = drive.seed(syncFile({ entries: [entry('dup-a', 'From file A', { at, date: localDate(-1) })] }), {
      id: 'fileAAA',
      createdTime: '2026-01-01T00:00:00.000Z',
    })
    drive.seed(syncFile({ entries: [entry('dup-b', 'From file B', { at, date: localDate(-2) })] }), {
      id: 'fileBBB',
      createdTime: '2026-01-02T00:00:00.000Z',
    })
    await startSignedIn(page, { entries: [entry('dup-c', 'Local C', { at })] })
    await expect(previews(page)).toHaveText(['Local C', 'From file A', 'From file B'])
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')

    expect([...drive.files.keys()]).toEqual([oldest])
    expect(ids(drive.json(oldest).entries)).toEqual(['dup-a', 'dup-b', 'dup-c'])
    const writes = drive.requests.filter((r) => ['create', 'update', 'delete'].includes(r.kind))
    expect(writes.map((r) => [r.kind, r.fileId])).toEqual([
      ['update', 'fileAAA'],
      ['delete', 'fileBBB'],
    ])
    expect(ids(await localEntries(page))).toEqual(['dup-a', 'dup-b', 'dup-c'])
  })
})

// --- Triggers ---------------------------------------------------------------------

test.describe('sync: triggers', () => {
  test.describe.configure({ timeout: 60_000 })

  test('app start syncs when signed in; 立即同步 syncs; 同步中 while it runs', async ({ page }) => {
    const drive = await setup(page)
    await startSignedIn(page, { entries: [entry('s1', 'Start entry')], path: './settings' })
    await expectSynced(page)
    expect(drive.requests.map((r) => r.kind)).toEqual(['list', 'create'])

    // Reload = app start: one sync round, nothing to upload.
    await page.reload()
    await expectSynced(page)
    await expect.poll(() => drive.requests.length).toBe(4)
    expect(drive.requests.slice(2).map((r) => r.kind)).toEqual(['list', 'get'])

    // 立即同步, held so 同步中 can be seen.
    const release = drive.hold()
    await syncNowButton(page).click()
    await expect(stateLine(page, '同步中')).toBeVisible()
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'syncing')
    release()
    await expectSynced(page)
    expect(drive.requests.slice(4).map((r) => r.kind)).toEqual(['list', 'get'])
    // A silent token was enough: no Google popup.
    expect((await gisCalls(page)).requests).toEqual([])
  })

  test('saving, editing and deleting an entry each upload once, about 2 s later', async ({ page }) => {
    const drive = await setup(page)
    await startSignedIn(page)
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
    await expect.poll(() => drive.files.size).toBe(1)

    // New entry.
    let before = await settled(page, drive)
    await page.getByRole('link', { name: '新增日記' }).click()
    await page.getByLabel('內容').fill('Created and synced')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)
    const id = new URL(page.url()).pathname.split('/').pop()
    await expectOneDebouncedUpload(drive, before, page)
    expect(drive.json().entries.find((e) => e.id === id).content).toBe('Created and synced')

    // Several quick edits: one upload with the last one.
    before = drive.requests.length
    for (const text of ['Edit 1', 'Edit 2', 'Edit 3']) {
      await page.getByLabel('內容').fill(text)
      await page.getByRole('button', { name: '儲存' }).click()
      await expect(page.getByRole('status')).toHaveText('已儲存')
    }
    await expectOneDebouncedUpload(drive, before, page)
    expect(drive.json().entries.find((e) => e.id === id).content).toBe('Edit 3')

    // Delete.
    before = drive.requests.length
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '刪除' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
    await expectOneDebouncedUpload(drive, before, page)
    const synced = drive.json().entries.find((e) => e.id === id)
    expect(synced.deleted).toBe(true)
    expect(synced.content).toBeUndefined()
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
  })

  test('saving an AI review result uploads it', async ({ page }) => {
    const drive = await setup(page)
    await installGeminiMock(page)
    await startSignedIn(page, {
      entries: [entry('review-me', '今日は友達とカフェを行きました。')],
      settings: { geminiApiKey: 'test-key-123', geminiModel: 'models/gemini-2.5-flash' },
      path: './entry/review-me',
    })
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
    await expect.poll(() => drive.files.size).toBe(1)
    const before = await settled(page, drive)
    await page.getByRole('button', { name: 'AI 批改' }).click()
    await expect(page.getByText('今天和朋友去了咖啡店。')).toBeVisible()
    await expectOneDebouncedUpload(drive, before, page)
    expect(drive.json().entries[0].analysis.translation).toBe('今天和朋友去了咖啡店。')
  })

  test('adding and deleting a language, changing the API key and the model each upload once', async ({ page }) => {
    const drive = await setup(page)
    await installGeminiMock(page)
    await startSignedIn(page, { settings: { geminiApiKey: 'test-key-123', geminiModel: 'models/gemini-2.5-flash' } })
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
    await expect.poll(() => drive.files.size).toBe(1)

    // 其他 + 加入 in the editor adds the language at once.
    await page.goto('./entry/new')
    let before = await settled(page, drive)
    await page.getByLabel('語言', { exact: true }).selectOption({ label: '其他' })
    await page.getByLabel('語言名稱', { exact: true }).fill('韓文')
    await page.getByRole('button', { name: '加入', exact: true }).click()
    await expect(page.getByLabel('語言', { exact: true })).toHaveValue('韓文')
    await expectOneDebouncedUpload(drive, before, page)
    expect(drive.json().customLanguages.map((l) => [l.name, l.deleted])).toEqual([['韓文', false]])

    // Delete it in settings.
    await openSettings(page)
    before = await settled(page, drive)
    await listSection(page).getByRole('button', { name: '刪除 韓文', exact: true }).click()
    await expect(languageNames(page)).toHaveCount(0)
    await expectOneDebouncedUpload(drive, before, page)
    expect(drive.json().customLanguages.map((l) => [l.name, l.deleted])).toEqual([['韓文', true]])

    // API key.
    before = drive.requests.length
    await keyInput(page).fill('test-key-789')
    await keySection(page).getByRole('button', { name: '儲存' }).click()
    await expect(keySection(page).locator('form').getByRole('status')).toHaveText('已儲存')
    await expectOneDebouncedUpload(drive, before, page)
    expect(drive.json().settings.geminiApiKey.value).toBe('test-key-789')
    expect(Date.parse(drive.json().settings.geminiApiKey.updatedAt)).toBeGreaterThan(Date.now() - 60_000)

    // Model.
    before = drive.requests.length
    await modelSelect(page).selectOption('models/gemini-2.5-pro')
    await expectOneDebouncedUpload(drive, before, page)
    expect(drive.json().settings.geminiModel.value).toBe('models/gemini-2.5-pro')
    await expectSynced(page)
  })

  test('offline: no request, offline message; back online the offline edit is uploaded', async ({ page, context }) => {
    const drive = await setup(page)
    await startSignedIn(page, { entries: [entry('off-1', 'Before offline')], path: './entry/off-1' })
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
    await expect.poll(() => drive.files.size).toBe(1)
    const before = await settled(page, drive)

    await context.setOffline(true)
    await page.getByLabel('內容').fill('Written offline')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('status')).toHaveText('已儲存')
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'error', { timeout: 6000 })
    await expect(cloud(page)).toHaveAccessibleName('同步狀態：同步失敗')
    // In-app navigation to settings (no network needed): the offline message.
    await cloud(page).click()
    await expect(page).toHaveURL(SETTINGS_URL)
    await expectSyncError(page, MESSAGES.offline)
    // 立即同步 while offline does not reach Drive either.
    await syncNowButton(page).click()
    await expectSyncError(page, MESSAGES.offline)
    await page.waitForTimeout(500)
    expect(drive.requests.length).toBe(before)

    await context.setOffline(false)
    await expectSynced(page)
    await expect.poll(() => drive.requests.slice(before).map((r) => r.kind)).toEqual(['list', 'get', 'update'])
    expect(drive.json().entries[0].content).toBe('Written offline')
    await expect(errorLine(page)).toHaveCount(0)
  })
})

// --- Errors --------------------------------------------------------------------------

test.describe('sync: errors', () => {
  test('Drive rejecting the token twice: needs-login view; 重新登入 syncs again', async ({ page }) => {
    const drive = await setup(page)
    drive.seed(syncFile())
    drive.fail('list', 'auth', 2)
    await startSignedIn(page, { path: './settings' })
    // One silent renewal was tried between the two rejections.
    await expect(section(page).getByText(EXPIRED, { exact: true })).toBeVisible()
    await expect(stateLine(page, '同步失敗')).toBeVisible()
    await expect(reLoginButton(page)).toBeVisible()
    await expect(signOutButton(page)).toBeVisible()
    await expect(syncNowButton(page)).toHaveCount(0)
    await expect(section(page).getByText('已登入', { exact: true })).toHaveCount(0)
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'error')
    expect(drive.requests.map((r) => r.kind)).toEqual(['list', 'list'])
    expect((await gisCalls(page)).requests).toEqual([{ prompt: 'none' }])
    expect((await readStore(page, 'settings')).googleAuth).toMatchObject({ enabled: true, accessToken: '', needsLogin: true })
    await reLoginButton(page).click()
    await expectSynced(page)
    await expect(section(page).getByText('已登入', { exact: true })).toBeVisible()
    await expect(section(page).getByText(EXPIRED)).toHaveCount(0)
  })

  test('a revoked token is renewed silently once and the sync succeeds', async ({ page }) => {
    const drive = await setup(page)
    await startSignedIn(page, { auth: signedInAuth('ya29.REVOKED-TOKEN'), path: './settings' })
    await expectSynced(page)
    expect(drive.requests.map((r) => [r.kind, r.token])).toEqual([
      ['list', 'ya29.REVOKED-TOKEN'],
      ['list', TOKEN],
      ['create', TOKEN],
    ])
    expect((await gisCalls(page)).requests).toEqual([{ prompt: 'none' }])
  })

  test('expired token and failing silent renewal: needs-login, no Drive request; 重新登入 syncs', async ({ page }) => {
    const drive = await setup(page, { gisMode: 'closed' })
    await startSignedIn(page, {
      auth: { enabled: true, accessToken: 'ya29.OLD', expiresAt: Date.now() - 1000, needsLogin: false },
    })
    await expect(cloud(page)).toHaveAttribute('data-sync-state', 'error')
    await cloud(page).click()
    await expect(section(page).getByText(EXPIRED, { exact: true })).toBeVisible()
    await expect(stateLine(page, '同步失敗')).toBeVisible()
    await expect(reLoginButton(page)).toBeVisible()
    await expect(signOutButton(page)).toBeVisible()
    expect(drive.requests).toEqual([])
    expect((await gisCalls(page)).requests).toEqual([{ prompt: 'none' }])

    await setGisMode(page, 'ok')
    await reLoginButton(page).click()
    await expectSynced(page)
    expect((await gisCalls(page)).requests).toEqual([{ prompt: 'none' }, { prompt: '' }])
    expect(drive.requests.every((r) => r.token === TOKEN)).toBe(true)
  })

  for (const [failure, message, label] of [
    ['quota', MESSAGES.quota, '403 rate limit'],
    ['quota429', MESSAGES.quota, '429'],
    ['server', MESSAGES.other, '500'],
    ['abort', MESSAGES.offline, 'network error'],
  ]) {
    test(`${label}: message, cloud 同步失敗; 立即同步 recovers`, async ({ page }) => {
      const drive = await setup(page)
      drive.fail('list', failure)
      await startSignedIn(page, { entries: [entry('err-1', 'Error entry')], path: './settings' })
      await expectSyncError(page, message)
      await expect(syncNowButton(page)).toBeVisible()
      await expect(section(page).getByText('已登入', { exact: true })).toBeVisible()
      expect(drive.files.size).toBe(0)
      await syncNowButton(page).click()
      await expectSynced(page)
      await expect(errorLine(page)).toHaveCount(0)
      expect(ids(drive.json().entries)).toEqual(['err-1'])
    })
  }

  for (const [label, content] of [
    ['not JSON', '{ this is not json'],
    ['another format', JSON.stringify({ format: 'other-app', version: 1, entries: [], customLanguages: [], settings: {} })],
    ['a newer version', JSON.stringify({ format: 'nikki-ai-sync', version: 2, entries: [], customLanguages: [], settings: {} })],
    ['missing lists', JSON.stringify({ format: 'nikki-ai-sync', version: 1 })],
  ]) {
    test(`unreadable Drive file (${label}): sync paused, nothing written`, async ({ page }) => {
      const drive = await setup(page)
      const id = drive.seed(content)
      await startSignedIn(page, { entries: [entry('keep-1', 'Kept locally')], path: './settings' })
      await expectSyncError(page, MESSAGES.paused)
      await syncNowButton(page).click()
      await expect(stateLine(page, '同步失敗')).toBeVisible()
      await expect(errorLine(page)).toHaveText(MESSAGES.paused)
      // A local change does not overwrite it either.
      await page.goto('./entry/keep-1')
      await page.getByLabel('內容').fill('Changed locally')
      await page.getByRole('button', { name: '儲存' }).click()
      await expect(page.getByRole('status')).toHaveText('已儲存')
      await page.waitForTimeout(3000)
      await expect(cloud(page)).toHaveAttribute('data-sync-state', 'error')
      expect(drive.requests.filter((r) => !['list', 'get'].includes(r.kind))).toEqual([])
      expect([...drive.files.keys()]).toEqual([id])
      expect(drive.file(id).content).toBe(content)
      expect(ids(await localEntries(page))).toEqual(['keep-1'])
    })
  }
})

// --- Sign out --------------------------------------------------------------------

test.describe('sync: sign out', () => {
  test('stops syncing: cloud gone, no more Drive requests, local and Drive data kept', async ({ page }) => {
    const drive = await setup(page)
    await startSignedIn(page, { entries: [entry('so-1', 'Stays here')], path: './settings' })
    await expectSynced(page)
    const fileContent = drive.file().content
    const before = await settled(page, drive)

    await signOutButton(page).click()
    await expect(signInButton(page)).toBeVisible()
    await expect(cloud(page)).toHaveCount(0)
    await expect(syncNowButton(page)).toHaveCount(0)

    await page.goto('./entry/so-1')
    await page.getByLabel('內容').fill('Edited after sign-out')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('status')).toHaveText('已儲存')
    await page.waitForTimeout(3000)
    await page.reload()
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await page.waitForTimeout(500)
    await expect(cloud(page)).toHaveCount(0)
    expect(drive.requests.length).toBe(before)
    expect(drive.file().content).toBe(fileContent)
    expect(ids(await localEntries(page))).toEqual(['so-1'])
    await expect(page.getByLabel('內容')).toHaveValue('Edited after sign-out')
  })
  test('sign out while a sync is held: nothing is written locally or to Drive afterwards', async ({ page }) => {
    const drive = await setup(page)
    const at = iso(Date.now() - DAY)
    const fileId = drive.seed(syncFile({ entries: [entry('remote-x', 'Remote only', { at })] }))
    const fileContent = drive.file().content
    const release = drive.hold()
    await startSignedIn(page, { entries: [entry('local-x', 'Local only', { at })], path: './settings' })
    await expect(stateLine(page, '同步中')).toBeVisible()
    await expect.poll(() => drive.count('list')).toBe(1)

    await signOutButton(page).click()
    await expect(signInButton(page)).toBeVisible()
    await expect(cloud(page)).toHaveCount(0)
    release()
    await page.waitForTimeout(4000)

    expect(drive.requests.filter((r) => ['create', 'update', 'delete'].includes(r.kind))).toEqual([])
    expect([...drive.files.keys()]).toEqual([fileId])
    expect(drive.file().content).toBe(fileContent)
    expect(ids(await localEntries(page))).toEqual(['local-x'])
    await expect(cloud(page)).toHaveCount(0)
    await expect(signInButton(page)).toBeVisible()
    await expect(section(page).getByText(/^同步狀態：/)).toHaveCount(0)
    expect((await readStore(page, 'settings')).googleAuth).toMatchObject({ enabled: false, accessToken: '' })
    await page.goto('./')
    await expect(previews(page)).toHaveText(['Local only'])
  })
})

// --- Top bar width -----------------------------------------------------------------

test.describe('sync: top bar with the cloud icon', () => {
  for (const width of [320, 375]) {
    test(`${width}px entry page (← + cloud + gear + ?): no overflow, nothing overlaps`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await setup(page)
      await startSignedIn(page, { entries: [entry('w-1', 'Width entry')], path: './entry/w-1' })
      await expect(cloud(page)).toHaveAttribute('data-sync-state', 'synced')
      const bar = topBar(page)
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bar: (() => {
          const el = document.querySelector('header')
          return el.scrollWidth - el.clientWidth
        })(),
      }))
      expect(overflow.doc, 'page overflow').toBeLessThanOrEqual(0)
      expect(overflow.bar, 'top bar overflow').toBeLessThanOrEqual(0)
      const boxes = []
      for (const locator of [
        bar.getByRole('button', { name: '返回', exact: true }),
        bar.getByRole('link', { name: '外語學習日記', exact: true }),
        cloud(page),
        settingsIcon(page),
        guideIcon(page),
      ]) {
        await expect(locator).toBeVisible()
        boxes.push(await locator.boundingBox())
      }
      for (let i = 0; i < boxes.length; i += 1) {
        expect(boxes[i].x, `item ${i} inside the viewport`).toBeGreaterThanOrEqual(0)
        expect(boxes[i].x + boxes[i].width, `item ${i} inside the viewport`).toBeLessThanOrEqual(width + 0.5)
        if (i > 0) expect(boxes[i].x, `item ${i} after item ${i - 1}`).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 0.5)
      }
      // The title stays on one line.
      const title = bar.getByRole('heading', { level: 1 })
      const lines = await title.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '0')))
      expect(Number.isFinite(lines) ? lines : 1).toBeLessThanOrEqual(1)
    })
  }
})
