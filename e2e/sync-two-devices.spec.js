import {
  test,
  expect,
  createFakeDrive,
  gisCalls,
  installGeminiMock,
  installGisStub,
  readStore,
  setGisMode,
  signedInAuth,
  startApp,
  syncFile,
  topBar,
  writeStore,
  WELCOME_URL,
  HOME_URL,
} from './helpers.js'

// E2E for Phase 4 T6: sync between two devices (spec 6, 8.4). Each device
// is its own browser context (own IndexedDB, own GIS stub and token); both
// are attached to ONE in-memory fake Drive (helpers.js). Nothing reaches
// Google; the global guard fails the test on any unmocked request.

const DAY = 24 * 60 * 60 * 1000
const TOKENS = { A: 'ya29.DEVICE-A-TOKEN', B: 'ya29.DEVICE-B-TOKEN', C: 'ya29.DEVICE-C-TOKEN' }
const EXPIRED = 'Google 登入已過期，請重新登入。'

const section = (page) => page.getByRole('region', { name: 'Google Drive 同步' })
const stateLine = (page, text) => section(page).getByText(`同步狀態：${text}`, { exact: true })
const syncNowButton = (page) => section(page).getByRole('button', { name: '立即同步', exact: true })
const cloud = (page) => topBar(page).locator('[data-sync-state]')
const keySection = (page) => page.getByRole('region', { name: 'Gemini API key' })
const keyInput = (page) => keySection(page).getByLabel('API key', { exact: true })
const modelSelect = (page) => page.getByRole('region', { name: 'Gemini 模型' }).getByLabel('模型', { exact: true })
const listSection = (page) => page.getByRole('region', { name: '語言清單' })
const languageNames = (page) => listSection(page).locator('li .language-name')
const entryItems = (page) => page.locator('ul.entries > li')
const previews = (page) => entryItems(page).locator('.entry-preview')
const homeHeading = (page) => page.getByRole('heading', { level: 2, name: '我的日記' })

const iso = (ms) => new Date(ms).toISOString()
const pad = (n) => String(n).padStart(2, '0')
function localDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * DAY)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function entry(id, content, { date = localDate(), at = iso(Date.now() - 5 * DAY) } = {}) {
  return { id, date, content, language: 'auto', createdAt: at, updatedAt: at, deleted: false, deletedAt: null, analysis: null }
}
function tombstone(id, at) {
  return { id, updatedAt: at, deleted: true, deletedAt: at }
}
function language(name, at, deleted = false) {
  return { name, updatedAt: at, deleted, deletedAt: deleted ? at : null }
}
const ids = (records) => records.map((r) => r.id).sort()

// Contexts opened by the current test, closed after it.
const opened = []
test.afterEach(async () => {
  while (opened.length) {
    const context = opened.pop()
    await context.unrouteAll({ behavior: 'ignoreErrors' })
    await context.close()
  }
})

// A device: its own context with the GIS stub (own token) on the shared Drive.
async function newDevice(newContext, drive, name, { gisMode = 'ok' } = {}) {
  const context = await newContext()
  opened.push(context)
  await installGisStub(context, { token: TOKENS[name], mode: gisMode })
  await drive.attach(context)
  const page = await context.newPage()
  return { name, context, page, token: TOKENS[name] }
}

function makeDrive() {
  return createFakeDrive({ validTokens: Object.values(TOKENS) })
}

const requestsOf = (drive, device) => drive.requests.filter((r) => r.token === device.token)

// Waits until the device shows 已同步 and has sent no Drive request for a
// moment; returns its request count.
async function settled(device, drive) {
  await expect(cloud(device.page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 10_000 })
  let count = -1
  await expect
    .poll(async () => {
      const previous = count
      count = requestsOf(drive, device).length
      await device.page.waitForTimeout(400)
      return previous === count && cloud(device.page).getAttribute('data-sync-state')
    }, { timeout: 15_000 })
    .toBe('synced')
  return requestsOf(drive, device).length
}

// Passes the welcome page, seeds local data and a stored sign-in, opens
// `path` (the app-start sync runs there) and waits for it.
async function signIn(device, drive, { entries = [], settings = {}, path = './' } = {}) {
  const { page } = device
  await startApp(page)
  if (entries.length) await writeStore(page, 'entries', entries)
  await writeStore(page, 'settings', { ...settings, googleAuth: signedInAuth(device.token) })
  await page.goto(path)
  await settled(device, drive)
}

// 立即同步 on the settings page; waits for that sync round to finish.
async function syncNow(device, drive) {
  const { page } = device
  if (!/\/settings$/.test(page.url())) {
    await page.goto('./settings')
  }
  const before = await settled(device, drive)
  await syncNowButton(page).click()
  await expect.poll(() => requestsOf(drive, device).length).toBeGreaterThan(before)
  await expect(stateLine(page, '已同步')).toBeVisible()
  await settled(device, drive)
}

async function openHome(page) {
  await page.goto('./')
  await expect(homeHeading(page)).toBeVisible()
}

async function openEntry(page, id) {
  await page.goto(`./entry/${id}`)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
}

// Edits the entry open on the page.
async function editEntry(page, text) {
  await page.getByLabel('內容').fill(text)
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page.getByRole('status')).toHaveText('已儲存')
}

async function addLanguageInEditor(page, name) {
  await page.goto('./entry/new')
  await page.getByLabel('語言', { exact: true }).selectOption({ label: '其他' })
  await page.getByLabel('語言名稱', { exact: true }).fill(name)
  await page.getByRole('button', { name: '加入', exact: true }).click()
  await expect(page.getByLabel('語言', { exact: true })).toHaveValue(name)
}

async function deleteLanguageInSettings(page, name) {
  if (!/\/settings$/.test(page.url())) await page.goto('./settings')
  await listSection(page).getByRole('button', { name: `刪除 ${name}`, exact: true }).click()
  await expect(languageNames(page).filter({ hasText: name })).toHaveCount(0)
}

async function activeLanguages(page) {
  return (await readStore(page, 'settings')).customLanguages.filter((l) => !l.deleted).map((l) => l.name).sort()
}

test.describe.configure({ timeout: 90_000 })

test.describe('two devices', () => {
  test('8.4-3: different entries are merged; the same entry edited on both: newer wins on both', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    const shared = entry('shared', 'Shared original', { date: localDate(-3) })
    await signIn(A, drive, { entries: [entry('a-1', 'Only on A', { date: localDate(-1) }), shared] })
    await signIn(B, drive, { entries: [entry('b-1', 'Only on B', { date: localDate(-2) }), shared] })
    // B's start sync already got A's entry; A gets B's on its next sync.
    await expect(previews(B.page)).toHaveText(['Only on A', 'Only on B', 'Shared original'])
    await syncNow(A, drive)
    await openHome(A.page)
    await expect(previews(A.page)).toHaveText(['Only on A', 'Only on B', 'Shared original'])

    // Both edit "shared" while offline: A first (older), B later (newer).
    // B uploads first, then A (whose older edit must not win).
    await openEntry(A.page, 'shared')
    await openEntry(B.page, 'shared')
    await settled(A, drive)
    await settled(B, drive)
    await A.context.setOffline(true)
    await B.context.setOffline(true)
    await editEntry(A.page, 'Edited on A (older)')
    await A.page.waitForTimeout(50)
    await editEntry(B.page, 'Edited on B (newer)')
    await B.context.setOffline(false)
    await expect.poll(() => drive.json().entries.find((e) => e.id === 'shared').content, { timeout: 10_000 }).toBe('Edited on B (newer)')
    await settled(B, drive)
    await A.context.setOffline(false)
    await settled(A, drive)
    // A took B's newer edit; Drive still has it.
    expect((await readStore(A.page, 'entries')).find((e) => e.id === 'shared').content).toBe('Edited on B (newer)')
    expect(drive.json().entries.find((e) => e.id === 'shared').content).toBe('Edited on B (newer)')
    await syncNow(B, drive)
    for (const device of [A, B]) {
      await openHome(device.page)
      await expect(previews(device.page), device.name).toHaveText(['Only on A', 'Only on B', 'Edited on B (newer)'])
    }
    expect(drive.files.size).toBe(1)
  })

  test('8.4-4: API key and model follow to B and work there; deleting the key on B removes it on A', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    await installGeminiMock(A.page)
    const geminiB = await installGeminiMock(B.page)
    await signIn(A, drive, { path: './settings' })
    await keyInput(A.page).fill('key-from-A-123')
    await keySection(A.page).getByRole('button', { name: '儲存' }).click()
    await expect(keySection(A.page).locator('form').getByRole('status')).toHaveText('已儲存')
    await expect(modelSelect(A.page)).toHaveValue('models/gemini-2.5-flash')
    await modelSelect(A.page).selectOption('models/gemini-2.5-pro')
    await expect.poll(() => drive.files.size === 1 && drive.json().settings.geminiModel?.value, { timeout: 10_000 }).toBe('models/gemini-2.5-pro')
    expect(drive.json().settings.geminiApiKey.value).toBe('key-from-A-123')

    // B signs in and can use them directly: AI review with A's key and model.
    await signIn(B, drive, { entries: [entry('rev', '今日は友達とカフェを行きました。')], path: './settings' })
    await expect(keyInput(B.page)).toHaveValue('key-from-A-123')
    await expect(modelSelect(B.page)).toHaveValue('models/gemini-2.5-pro')
    await expect.poll(() => geminiB.modelRequests.length).toBeGreaterThan(0)
    expect(geminiB.modelRequests.at(-1).headers['x-goog-api-key']).toBe('key-from-A-123')
    await B.page.goto('./entry/rev')
    await B.page.getByRole('button', { name: 'AI 批改' }).click()
    await expect(B.page.getByText('今天和朋友去了咖啡店。')).toBeVisible()
    expect(geminiB.generateRequests).toHaveLength(1)
    expect(geminiB.generateRequests[0].headers['x-goog-api-key']).toBe('key-from-A-123')
    expect(geminiB.generateRequests[0].url).toContain('models/gemini-2.5-pro:generateContent')

    // B deletes the key: A loses it after its sync.
    await B.page.goto('./settings')
    await settled(B, drive)
    await keySection(B.page).getByRole('button', { name: '刪除' }).click()
    await expect(keyInput(B.page)).toHaveValue('')
    await expect.poll(() => drive.json().settings.geminiApiKey.value, { timeout: 10_000 }).toBe('')
    await syncNow(A, drive)
    await expect(keyInput(A.page)).toHaveValue('')
    expect((await readStore(A.page, 'settings')).geminiApiKey).toBe('')
  })

  test('8.4-4: a model auto-selected on B never overrides the model chosen on A', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    await installGeminiMock(A.page)
    const geminiB = await installGeminiMock(B.page)
    await signIn(A, drive, { path: './settings' })
    // A: key + the user's own choice (pro).
    await keyInput(A.page).fill('shared-key-1')
    await keySection(A.page).getByRole('button', { name: '儲存' }).click()
    await modelSelect(A.page).selectOption('models/gemini-2.5-pro')
    await expect.poll(() => drive.files.size === 1 && drive.json().settings.geminiModel?.value, { timeout: 10_000 }).toBe('models/gemini-2.5-pro')
    const chosenAt = drive.json().settings.geminiModel.updatedAt

    // B has the key but no model, and its first sync is held: the settings
    // page auto-selects Flash before A's choice arrives.
    await startApp(B.page)
    await writeStore(B.page, 'settings', { geminiApiKey: 'shared-key-1', googleAuth: signedInAuth(B.token) })
    const release = drive.hold()
    await B.page.goto('./settings')
    await expect(modelSelect(B.page)).toHaveValue('models/gemini-2.5-flash')
    await expect.poll(async () => (await readStore(B.page, 'settings')).geminiModel).toBe('models/gemini-2.5-flash')
    expect(geminiB.modelRequests.length).toBeGreaterThan(0)
    release()
    await expect(modelSelect(B.page)).toHaveValue('models/gemini-2.5-pro', { timeout: 10_000 })
    await settled(B, drive)
    // Also after B's debounced sync of its own (automatic) change.
    await B.page.waitForTimeout(3000)
    await settled(B, drive)
    expect(drive.json().settings.geminiModel).toEqual({ value: 'models/gemini-2.5-pro', updatedAt: chosenAt })
    expect((await readStore(B.page, 'settings')).geminiModel).toBe('models/gemini-2.5-pro')
    await syncNow(A, drive)
    await expect(modelSelect(A.page)).toHaveValue('models/gemini-2.5-pro')
  })

  test('8.4-5: an entry deleted on A disappears on B and is not resurrected by B', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    await signIn(A, drive, { entries: [entry('del-me', 'Delete me'), entry('keep', 'Keep me', { date: localDate(-1) })] })
    await signIn(B, drive)
    await expect(previews(B.page)).toHaveText(['Delete me', 'Keep me'])

    // B goes offline holding its live (older) copy; A deletes meanwhile.
    await B.context.setOffline(true)
    await A.page.goto('./entry/del-me')
    A.page.once('dialog', (d) => d.accept())
    await A.page.getByRole('button', { name: '刪除' }).click()
    await expect(homeHeading(A.page)).toBeVisible()
    await expect.poll(() => drive.json().entries.find((e) => e.id === 'del-me').deleted, { timeout: 10_000 }).toBe(true)

    // B back online: its home list drops the entry without a reload.
    await expect(previews(B.page)).toHaveText(['Delete me', 'Keep me'])
    await B.context.setOffline(false)
    await expect(previews(B.page)).toHaveText(['Keep me'], { timeout: 10_000 })
    await settled(B, drive)
    expect((await readStore(B.page, 'entries')).find((e) => e.id === 'del-me')).toMatchObject({ deleted: true })
    // More syncs on both: still deleted everywhere.
    await syncNow(B, drive)
    await syncNow(A, drive)
    expect(drive.json().entries.find((e) => e.id === 'del-me')).toMatchObject({ deleted: true })
    expect(drive.json().entries.find((e) => e.id === 'del-me').content).toBeUndefined()
    for (const device of [A, B]) {
      await openHome(device.page)
      await expect(previews(device.page), device.name).toHaveText(['Keep me'])
      await device.page.goto('./entry/del-me')
      await expect(device.page.getByText('找不到這篇日記')).toBeVisible()
    }
  })

  test('8.4-6: tombstones older than 90 days are purged on both devices and Drive', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    const old = iso(Date.now() - 95 * DAY)
    const recent = iso(Date.now() - 30 * DAY)
    const oldTombstones = [tombstone('old-1', old), tombstone('recent-1', recent)]
    const languages = [language('舊語言', old, true), language('近刪除', recent, true)]
    drive.seed(syncFile({ entries: oldTombstones, customLanguages: languages }))
    await signIn(B, drive, { entries: oldTombstones, settings: { customLanguages: languages } })
    await signIn(A, drive, { entries: [tombstone('old-2', old)] })
    await syncNow(B, drive)
    for (const device of [A, B]) {
      expect(ids(await readStore(device.page, 'entries')), device.name).toEqual(['recent-1'])
      expect((await readStore(device.page, 'settings')).customLanguages.map((l) => l.name), device.name).toEqual(['近刪除'])
    }
    expect(ids(drive.json().entries)).toEqual(['recent-1'])
    expect(drive.json().customLanguages.map((l) => l.name)).toEqual(['近刪除'])
  })

  test('8.4-8: entries saved on B while offline are uploaded on reconnect and reach A', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    await signIn(A, drive, { entries: [entry('e1', 'Before offline')] })
    await signIn(B, drive)
    await B.page.goto('./entry/new')
    await settled(B, drive)
    const before = requestsOf(drive, B).length

    await B.context.setOffline(true)
    await B.page.getByLabel('內容').fill('New entry written offline')
    await B.page.getByLabel('日期').fill(localDate(-1))
    await B.page.getByRole('button', { name: '儲存' }).click()
    await expect(B.page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    await B.page.getByLabel('內容').fill('New entry written offline, edited')
    await B.page.getByRole('button', { name: '儲存' }).click()
    await expect(B.page.getByRole('status')).toHaveText('已儲存')
    await expect(cloud(B.page)).toHaveAttribute('data-sync-state', 'error', { timeout: 6000 })
    expect(requestsOf(drive, B).length).toBe(before)

    await B.context.setOffline(false)
    await expect(cloud(B.page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 10_000 })
    await expect.poll(() => drive.json().entries.map((e) => e.content).sort()).toEqual(['Before offline', 'New entry written offline, edited'])
    await syncNow(A, drive)
    await openHome(A.page)
    await expect(previews(A.page)).toHaveText(['Before offline', 'New entry written offline, edited'])
  })

  test('8.4-9: welcomeSeen stays on each device (B signs in from settings, still sees the welcome page)', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    await signIn(A, drive, { entries: [entry('w1', 'From A')] })
    expect(JSON.stringify(drive.json())).not.toContain('welcomeSeen')

    // B: straight to settings (no welcome), sign in with the button.
    await B.page.goto('./settings')
    await section(B.page).getByRole('button', { name: '登入 Google', exact: true }).click()
    await expect(stateLine(B.page, '已同步')).toBeVisible()
    expect(ids(await readStore(B.page, 'entries'))).toEqual(['w1'])
    expect((await readStore(B.page, 'settings')).welcomeSeen ?? false).toBe(false)
    await B.page.goto('./')
    await expect(B.page).toHaveURL(WELCOME_URL)
    await B.page.getByRole('button', { name: '開始使用' }).click()
    await expect(B.page).toHaveURL(HOME_URL)
    await expect(previews(B.page)).toHaveText(['From A'])
    await settled(B, drive)
    expect(JSON.stringify(drive.json())).not.toContain('welcomeSeen')
    // A is not affected.
    await openHome(A.page)
    await expect(A.page).toHaveURL(HOME_URL)
  })

  test('8.4-10: expired login on B is shown there; after 重新登入 B gets A’s changes', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B', { gisMode: 'closed' })
    await signIn(A, drive, { entries: [entry('x1', 'A entry')] })
    await startApp(B.page)
    await writeStore(B.page, 'settings', {
      googleAuth: { enabled: true, accessToken: 'ya29.B-OLD', expiresAt: Date.now() - 1000, needsLogin: false },
    })
    await B.page.goto('./settings')
    await expect(section(B.page).getByText(EXPIRED, { exact: true })).toBeVisible()
    await expect(cloud(B.page)).toHaveAttribute('data-sync-state', 'error')
    expect(requestsOf(drive, B)).toEqual([])
    expect(drive.requests.some((r) => r.token === 'ya29.B-OLD')).toBe(false)

    await setGisMode(B.page, 'ok')
    await section(B.page).getByRole('button', { name: '重新登入', exact: true }).click()
    await expect(stateLine(B.page, '已同步')).toBeVisible()
    expect((await gisCalls(B.page)).requests).toEqual([{ prompt: 'none' }, { prompt: '' }])
    await openHome(B.page)
    await expect(previews(B.page)).toHaveText(['A entry'])
  })

  test('8.4-12: language deleted on A is hidden on B; re-added later on B, it is back on A', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    const at = iso(Date.now() - 5 * DAY)
    await signIn(A, drive, { settings: { customLanguages: [language('韓文', at)] }, path: './settings' })
    await signIn(B, drive, { path: './settings' })
    await expect(languageNames(B.page)).toHaveText(['韓文'])

    await deleteLanguageInSettings(A.page, '韓文')
    await expect.poll(() => drive.json().customLanguages.find((l) => l.name === '韓文').deleted, { timeout: 10_000 }).toBe(true)
    await syncNow(B, drive)
    await expect(languageNames(B.page)).toHaveCount(0)
    await B.page.goto('./entry/new')
    await expect(B.page.getByLabel('語言', { exact: true }).locator('option', { hasText: '韓文' })).toHaveCount(0)

    // Re-added later on B: the last action wins.
    await addLanguageInEditor(B.page, '韓文')
    await expect.poll(() => drive.json().customLanguages.find((l) => l.name === '韓文').deleted, { timeout: 10_000 }).toBe(false)
    await syncNow(A, drive)
    await expect(languageNames(A.page)).toHaveText(['韓文'])
    expect(await activeLanguages(A.page)).toEqual(['韓文'])
  })

  test('8.4-12: the last action wins even when the older one is uploaded last (both orders)', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    const at = iso(Date.now() - 5 * DAY)
    await signIn(A, drive, {
      settings: { customLanguages: [language('德文', at), language('法文', at, true)] },
      path: './settings',
    })
    await signIn(B, drive, { path: './settings' })
    await expect(languageNames(B.page)).toHaveText(['德文'])
    await B.page.goto('./entry/new')
    await settled(B, drive)

    // B (offline): deletes 德文 and re-adds 法文 first (older).
    await B.context.setOffline(true)
    await B.page.getByLabel('語言', { exact: true }).selectOption({ label: '其他' })
    await B.page.getByLabel('語言名稱', { exact: true }).fill('法文')
    await B.page.getByRole('button', { name: '加入', exact: true }).click()
    await expect(B.page.getByLabel('語言', { exact: true })).toHaveValue('法文')
    await B.page.getByRole('link', { name: '設定' }).click()
    await deleteLanguageInSettings(B.page, '德文')
    await B.page.waitForTimeout(50)

    // A (online), later: 法文 added then deleted (deleted last), 德文
    // deleted then re-added (active last).
    await addLanguageInEditor(A.page, '法文')
    await deleteLanguageInSettings(A.page, '法文')
    await deleteLanguageInSettings(A.page, '德文')
    await addLanguageInEditor(A.page, '德文')
    await A.page.goto('./settings')
    await expect.poll(() => drive.json().customLanguages.map((l) => [l.name, l.deleted]).sort(), { timeout: 10_000 }).toEqual([
      ['德文', false],
      ['法文', true],
    ])
    await settled(A, drive)

    // B comes online last with its older actions: A's newer ones win.
    await B.context.setOffline(false)
    await settled(B, drive)
    await syncNow(A, drive)
    for (const device of [A, B]) {
      expect(await activeLanguages(device.page), device.name).toEqual(['德文'])
    }
    await expect(languageNames(B.page)).toHaveText(['德文'])
    await expect(languageNames(A.page)).toHaveText(['德文'])
    expect(drive.json().customLanguages.map((l) => [l.name, l.deleted]).sort()).toEqual([
      ['德文', false],
      ['法文', true],
    ])
  })

  test('concurrent first syncs (duplicate files) converge with nothing lost', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const B = await newDevice(newContext, drive, 'B')
    for (const [device, id] of [[A, 'ca'], [B, 'cb']]) {
      await startApp(device.page)
      await writeStore(device.page, 'entries', [entry(id, `Entry ${id}`, { date: id === 'ca' ? localDate(-1) : localDate(-2) })])
      await writeStore(device.page, 'settings', {
        googleAuth: signedInAuth(device.token),
        customLanguages: [language(id === 'ca' ? '韓文' : '法文', iso(Date.now() - DAY))],
      })
    }
    const release = drive.hold()
    await Promise.all([A.page.goto('./'), B.page.goto('./')])
    await expect.poll(() => [requestsOf(drive, A).length, requestsOf(drive, B).length]).toEqual([1, 1])
    release()
    await settled(A, drive)
    await settled(B, drive)
    // Both saw no file and created one each.
    expect(drive.files.size).toBe(2)

    await syncNow(A, drive)
    await syncNow(B, drive)
    expect(drive.files.size).toBe(1)
    expect(ids(drive.json().entries)).toEqual(['ca', 'cb'])
    expect(drive.json().customLanguages.map((l) => l.name).sort()).toEqual(['法文', '韓文'].sort())
    for (const device of [A, B]) {
      expect(ids(await readStore(device.page, 'entries')), device.name).toEqual(['ca', 'cb'])
      expect(await activeLanguages(device.page), device.name).toEqual(['法文', '韓文'].sort())
      await openHome(device.page)
      await expect(previews(device.page), device.name).toHaveText(['Entry ca', 'Entry cb'])
    }
  })

  test('8.4-1: a signed-out device keeps working locally and never sees or touches Drive data', async ({ newContext }) => {
    const drive = makeDrive()
    const A = await newDevice(newContext, drive, 'A')
    const C = await newDevice(newContext, drive, 'C')
    const external = []
    C.page.on('request', (r) => {
      if (new URL(r.url()).hostname !== 'localhost') external.push(r.url())
    })
    await signIn(A, drive, { entries: [entry('cloud-1', 'On Drive via A')] })
    const fileBefore = drive.file().content

    await startApp(C.page)
    await expect(entryItems(C.page)).toHaveCount(0)
    await C.page.getByRole('link', { name: '新增日記' }).click()
    await C.page.getByLabel('內容').fill('Local only on C')
    await C.page.getByRole('button', { name: '儲存' }).click()
    await expect(C.page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    await C.page.waitForTimeout(3000)
    await openHome(C.page)
    await expect(previews(C.page)).toHaveText(['Local only on C'])
    await expect(cloud(C.page)).toHaveCount(0)
    expect(external).toEqual([])
    expect(requestsOf(drive, C)).toEqual([])
    expect(drive.file().content).toBe(fileBefore)

    await syncNow(A, drive)
    await openHome(A.page)
    await expect(previews(A.page)).toHaveText(['On Drive via A'])
  })
})
