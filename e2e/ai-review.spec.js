import {
  test,
  expect,
  HOME_URL,
  MOCK_ANALYSIS,
  fulfillJson,
  generateBody,
  installGeminiMock,
  readStore,
  startApp,
  writeStore,
} from './helpers.js'

// E2E for Phase 2 T8: AI review on the entry page (spec 3.2, 4.2, 5.2-5.4,
// 8.2-2/3/5/7/8/9/10/11; decisions.md AI 批改). Gemini is always mocked
// (installGeminiMock); any other external request fails the test. Only
// fake keys are used.

const FAKE_KEY = 'test-key-123'
const MODEL = 'models/gemini-2.5-flash'
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent`
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const DIARY = '今日は友達とカフェを行きました。秘密の日記です。'
const AUTO_INSTRUCTION = '請先判斷日記使用的語言。'
const PROMPT_START = '你是一位外語寫作老師。'

const MESSAGES = {
  unsaved: '請先儲存日記再批改',
  noKey: '請先到設定頁設定 Gemini API key。',
  noModel: '請先到設定頁選擇 Gemini 模型。',
  invalidKey: 'API key 無效，請到設定頁確認。',
  quota: '已達 Gemini 使用額度上限，請稍後再試。',
  modelUnavailable: '所選的模型已無法使用，請到設定頁重新選擇。',
  network: '無法連線到 Gemini，請檢查網路後再試一次。',
  format: 'AI 回傳的格式不正確，請再試一次。',
  other: '批改失敗，請稍後再試一次。',
  deleted: '這篇日記已被刪除，無法儲存。',
}

const SECTIONS = ['判斷的語言', '文法錯誤', '不通順或易誤會的句子', '更道地的說法', '修改後全文', '中文翻譯']

const panel = (page) => page.getByRole('region', { name: 'AI 批改結果' })
const reviewButton = (page) => panel(page).getByRole('button', { name: 'AI 批改', exact: true })
const busyButton = (page) => panel(page).getByRole('button', { name: '批改中…' })
const panelAlert = (page) => panel(page).getByRole('alert')
const settingsLink = (page) => panel(page).getByRole('link', { name: '前往設定頁' })
const section = (page, name) => panel(page).getByRole('region', { name })
const analyzedAtLine = (page) => panel(page).getByText(/^批改時間：/)
const contentInput = (page) => page.getByLabel('內容')
const languageSelect = (page) => page.getByLabel('語言', { exact: true })
const saveButton = (page) => page.getByRole('button', { name: '儲存' })

let gemini

test.beforeEach(async ({ page }) => {
  gemini = await installGeminiMock(page)
})

// Fresh app with the given settings stored (key and model by default).
async function setup(page, settings = { geminiApiKey: FAKE_KEY, geminiModel: MODEL }) {
  await startApp(page)
  await writeStore(page, 'settings', settings)
}

// Creates an entry through the UI; stays on its page. Returns the id.
async function createEntry(page, content = DIARY, language) {
  await page.goto('./entry/new')
  await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
  await contentInput(page).fill(content)
  if (language) await languageSelect(page).selectOption({ label: language })
  await saveButton(page).click()
  await expect(page).toHaveURL(ENTRY_URL)
  await expect(reviewButton(page)).toBeVisible()
  return new URL(page.url()).pathname.split('/').pop()
}

async function storedEntry(page, id) {
  return (await readStore(page, 'entries')).find((entry) => entry.id === id)
}

// Holds the next generate responses until release() is called.
function holdGenerate(mock, respond = (route) => fulfillJson(route, generateBody(JSON.stringify(MOCK_ANALYSIS)))) {
  let release
  const held = new Promise((resolve) => {
    release = resolve
  })
  mock.generate = async (route, n) => {
    await held
    return respond(route, n)
  }
  return () => release()
}

const analysisOf = (overrides) => (route) =>
  fulfillJson(route, generateBody(JSON.stringify({ ...MOCK_ANALYSIS, ...overrides })))

async function expectResultShown(page, analysis = MOCK_ANALYSIS) {
  for (const name of SECTIONS) await expect(section(page, name)).toBeVisible()
  await expect(section(page, '判斷的語言')).toContainText(analysis.detectedLanguage)
  await expect(section(page, '中文翻譯')).toContainText(analysis.translation)
}

test.describe('AI review', () => {
  test('only saved entries have the button; saving never sends a request', async ({ page }) => {
    await setup(page)
    await page.goto('./entry/new')
    await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'AI 批改', exact: true })).toHaveCount(0)
    await expect(panel(page)).toHaveCount(0)

    await createEntry(page)
    await contentInput(page).fill(`${DIARY} 追記`)
    await saveButton(page).click()
    await expect(page.getByRole('status').first()).toHaveText('已儲存')
    await expect(reviewButton(page)).toBeEnabled()
    // No result yet.
    await expect(section(page, '判斷的語言')).toHaveCount(0)
    expect(gemini.generateRequests).toEqual([])
  })

  test('unsaved changes block the review without a request', async ({ page }) => {
    await setup(page)
    await createEntry(page)

    // Content change.
    await contentInput(page).fill('changed')
    await reviewButton(page).click()
    await expect(panelAlert(page)).toHaveText(MESSAGES.unsaved)
    await contentInput(page).fill(DIARY)

    // Date change.
    await page.getByLabel('日期').fill('2020-01-01')
    await reviewButton(page).click()
    await expect(panelAlert(page)).toHaveText(MESSAGES.unsaved)
    await page.reload()
    await expect(reviewButton(page)).toBeVisible()

    // Language change.
    await languageSelect(page).selectOption({ label: '英文' })
    await reviewButton(page).click()
    await expect(panelAlert(page)).toHaveText(MESSAGES.unsaved)

    expect(gemini.generateRequests).toEqual([])
    expect((await storedEntry(page, new URL(page.url()).pathname.split('/').pop())).analysis).toBeNull()
  })

  test('no API key: message with a link to the settings page, no request', async ({ page }) => {
    await setup(page, {})
    await createEntry(page)
    await reviewButton(page).click()
    await expect(panelAlert(page)).toContainText(MESSAGES.noKey)
    await expect(settingsLink(page)).toBeVisible()
    expect(gemini.generateRequests).toEqual([])
    await settingsLink(page).click()
    await expect(page).toHaveURL(/\/nikki-ai\/settings$/)
  })

  test('key but no model: message with a link to the settings page, no request', async ({
    page,
  }) => {
    await setup(page, { geminiApiKey: FAKE_KEY })
    await createEntry(page)
    await reviewButton(page).click()
    await expect(panelAlert(page)).toContainText(MESSAGES.noModel)
    await expect(settingsLink(page)).toHaveAttribute('href', '/nikki-ai/settings')
    expect(gemini.generateRequests).toEqual([])
  })

  test('sends one request with the key in the header and the diary in the prompt', async ({
    page,
  }) => {
    const consoleText = []
    page.on('console', (msg) => consoleText.push(msg.text()))
    page.on('pageerror', (error) => consoleText.push(error.message))

    await setup(page)
    const id = await createEntry(page)
    const release = holdGenerate(gemini)
    await reviewButton(page).click()

    // Busy while the response is held.
    await expect(busyButton(page)).toBeDisabled()
    await expect(reviewButton(page)).toHaveCount(0)
    await expect.poll(() => gemini.generateRequests.length).toBe(1)
    release()
    await expect(reviewButton(page)).toBeEnabled()

    const [request] = gemini.generateRequests
    expect(request.url).toBe(GENERATE_URL)
    expect(request.url).not.toContain(FAKE_KEY)
    expect(request.headers['x-goog-api-key']).toBe(FAKE_KEY)
    expect(JSON.stringify(request.body)).not.toContain(FAKE_KEY)
    const prompt = request.body.contents[0].parts[0].text
    expect(prompt.startsWith(PROMPT_START)).toBe(true)
    expect(prompt).toContain(AUTO_INSTRUCTION)
    expect(prompt).toContain(`"""\n${DIARY}\n"""`)
    expect(request.body.generationConfig.responseMimeType).toBe('application/json')
    expect(request.body.generationConfig.responseSchema).toBeTruthy()

    await expectResultShown(page)
    expect(gemini.generateRequests).toHaveLength(1)
    await expect(panelAlert(page)).toHaveCount(0)

    // Nothing sensitive in the console.
    const secrets = [FAKE_KEY, DIARY, PROMPT_START, MOCK_ANALYSIS.translation, MOCK_ANALYSIS.correctedText]
    for (const text of consoleText) {
      for (const secret of secrets) expect(text).not.toContain(secret)
    }
    expect(await storedEntry(page, id)).toBeTruthy()
  })

  test('the prompt names the entry language (built-in and custom)', async ({ page }) => {
    await setup(page)
    await createEntry(page, 'Hello world', '英文')
    await reviewButton(page).click()
    await expectResultShown(page)

    await page.goto('./entry/new')
    await contentInput(page).fill('안녕하세요')
    await languageSelect(page).selectOption({ label: '其他' })
    await page.getByLabel('語言名稱', { exact: true }).fill('韓文')
    await saveButton(page).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await reviewButton(page).click()
    await expectResultShown(page)

    const prompts = gemini.generateRequests.map((r) => r.body.contents[0].parts[0].text)
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('這篇日記使用的語言是英文。')
    expect(prompts[0]).not.toContain(AUTO_INSTRUCTION)
    expect(prompts[0]).toContain('"""\nHello world\n"""')
    expect(prompts[1]).toContain('這篇日記使用的語言是韓文。')
    expect(prompts[1]).toContain('"""\n안녕하세요\n"""')
  })

  test('shows every section, 無錯誤, bold changes, the review time; stored and kept on reload', async ({
    page,
  }) => {
    await setup(page)
    const id = await createEntry(page)
    const before = await storedEntry(page, id)
    gemini.generate = analysisOf({
      grammarErrors: [],
      unclearSentences: [],
      correctedText: '今日は**に**行きました。**少し疲れましたが**、元気です。',
    })
    await reviewButton(page).click()
    await expectResultShown(page)

    await expect(section(page, '文法錯誤')).toContainText('無錯誤')
    await expect(section(page, '不通順或易誤會的句子')).toContainText('無')
    const natural = section(page, '更道地的說法')
    await expect(natural).toContainText('ケーキを二つ食べました')
    await expect(natural).toContainText('ケーキを二つも食べちゃった／ケーキを二つ平らげた')
    const corrected = section(page, '修改後全文')
    await expect(corrected.locator('strong')).toHaveText(['に', '少し疲れましたが'])
    expect(await corrected.innerText()).not.toContain('**')

    // Stored: analysis with analyzedAt; diary fields unchanged.
    const after = await storedEntry(page, id)
    expect(after.analysis).toMatchObject({ grammarErrors: [], detectedLanguage: '日文' })
    expect(after.analysis.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(after.content).toBe(before.content)
    expect(after.date).toBe(before.date)
    expect(after.language).toBe(before.language)
    expect(after.createdAt).toBe(before.createdAt)

    // Review time in local YYYY-MM-DD HH:mm.
    const expectedTime = await page.evaluate((iso) => {
      const d = new Date(iso)
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }, after.analysis.analyzedAt)
    await expect(analyzedAtLine(page)).toHaveText(`批改時間：${expectedTime}`)

    await page.reload()
    await expectResultShown(page)
    await expect(analyzedAtLine(page)).toHaveText(`批改時間：${expectedTime}`)
    await expect(contentInput(page)).toHaveValue(DIARY)
    expect(gemini.generateRequests).toHaveLength(1)
  })

  test('HTML in AI text is shown as plain text', async ({ page }) => {
    await setup(page)
    await createEntry(page)
    const injected = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>b</b>'
    gemini.generate = analysisOf({
      detectedLanguage: '<i>日文</i>',
      correctedText: `**${injected}** tail`,
      translation: injected,
      grammarErrors: [{ original: '<u>x</u>', corrected: '<a href="https://evil.example">y</a>', explanation: injected }],
    })
    await reviewButton(page).click()
    await expect(section(page, '中文翻譯')).toBeVisible()

    await expect(section(page, '中文翻譯')).toHaveText(new RegExp(`中文翻譯\\s*${injected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    await expect(section(page, '判斷的語言')).toContainText('<i>日文</i>')
    await expect(section(page, '修改後全文').locator('strong')).toHaveText(injected)
    await expect(panel(page).locator('img, script, b, i, u, a, iframe')).toHaveCount(0)
    expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  })

  test('re-review replaces the result; later edits keep the old result', async ({ page }) => {
    await setup(page)
    const id = await createEntry(page)
    await reviewButton(page).click()
    await expectResultShown(page)

    const second = { detectedLanguage: '日文（第二次）', translation: '第二次的翻譯。' }
    gemini.generate = analysisOf(second)
    await reviewButton(page).click()
    await expect(section(page, '中文翻譯')).toContainText('第二次的翻譯。')
    await expect(section(page, '判斷的語言')).toContainText('日文（第二次）')
    let stored = await storedEntry(page, id)
    expect(stored.analysis.translation).toBe('第二次的翻譯。')
    expect(gemini.generateRequests).toHaveLength(2)

    // Edit the diary afterwards: the old result stays, untouched.
    const analysisBefore = stored.analysis
    await contentInput(page).fill('全く新しい内容')
    await saveButton(page).click()
    await expect(page.getByRole('status').first()).toHaveText('已儲存')
    await expect(section(page, '中文翻譯')).toContainText('第二次的翻譯。')
    stored = await storedEntry(page, id)
    expect(stored.content).toBe('全く新しい内容')
    expect(stored.analysis).toEqual(analysisBefore)

    await page.reload()
    await expect(section(page, '中文翻譯')).toContainText('第二次的翻譯。')
    await expect(contentInput(page)).toHaveValue('全く新しい内容')
    expect(gemini.generateRequests).toHaveLength(2)
  })

  test('a review never changes typed but unsaved text', async ({ page }) => {
    await setup(page)
    const id = await createEntry(page)
    const release = holdGenerate(gemini)
    await reviewButton(page).click()
    await expect(busyButton(page)).toBeDisabled()
    // Type while the review is running.
    await contentInput(page).fill('typed during review')
    release()
    await expectResultShown(page)
    await expect(contentInput(page)).toHaveValue('typed during review')
    const stored = await storedEntry(page, id)
    expect(stored.content).toBe(DIARY)
    expect(stored.analysis).not.toBeNull()

    // Saving now keeps both the new text and the analysis.
    await saveButton(page).click()
    await expect(page.getByRole('status').first()).toHaveText('已儲存')
    const saved = await storedEntry(page, id)
    expect(saved.content).toBe('typed during review')
    expect(saved.analysis).toEqual(stored.analysis)
  })

  const failures = [
    {
      title: '400 API_KEY_INVALID',
      message: MESSAGES.invalidKey,
      link: true,
      respond: (route) =>
        fulfillJson(route, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }, 400),
    },
    { title: '401', message: MESSAGES.invalidKey, link: true, respond: (route) => fulfillJson(route, { error: { code: 401 } }, 401) },
    { title: '403', message: MESSAGES.invalidKey, link: true, respond: (route) => fulfillJson(route, { error: { code: 403, status: 'PERMISSION_DENIED' } }, 403) },
    { title: '429', message: MESSAGES.quota, link: false, respond: (route) => fulfillJson(route, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429) },
    { title: '404', message: MESSAGES.modelUnavailable, link: true, respond: (route) => fulfillJson(route, { error: { code: 404, status: 'NOT_FOUND' } }, 404) },
    { title: 'aborted request', message: MESSAGES.network, link: false, respond: (route) => route.abort('internetdisconnected') },
    { title: 'invalid JSON text', message: MESSAGES.format, link: false, respond: (route) => fulfillJson(route, generateBody('{"detectedLanguage": "日文", ')) },
    { title: 'invalid analysis', message: MESSAGES.format, link: false, respond: (route) => fulfillJson(route, generateBody(JSON.stringify({ ...MOCK_ANALYSIS, grammarErrors: 'none' }))) },
    { title: 'no candidates', message: MESSAGES.format, link: false, respond: (route) => fulfillJson(route, { promptFeedback: { blockReason: 'SAFETY' } }) },
    { title: '500', message: MESSAGES.other, link: false, respond: (route) => fulfillJson(route, { error: { code: 500, status: 'INTERNAL' } }, 500) },
  ]

  for (const failure of failures) {
    test(`failure (${failure.title}): message, diary and previous result unchanged, one request`, async ({
      page,
    }) => {
      await setup(page)
      const id = await createEntry(page)
      await reviewButton(page).click()
      await expectResultShown(page)
      const before = await storedEntry(page, id)

      gemini.generate = failure.respond
      await reviewButton(page).click()
      await expect(panelAlert(page)).toContainText(failure.message)
      await expect(settingsLink(page)).toHaveCount(failure.link ? 1 : 0)
      await expect(reviewButton(page)).toBeEnabled()

      // Previous result still visible; storage unchanged.
      await expectResultShown(page)
      await expect(contentInput(page)).toHaveValue(DIARY)
      expect(await storedEntry(page, id)).toEqual(before)

      // Exactly one request per press, no automatic retry.
      await page.waitForTimeout(500)
      expect(gemini.generateRequests).toHaveLength(2)
    })
  }

  test('leaving the page while waiting still stores the result', async ({ page }) => {
    await setup(page)
    const id = await createEntry(page)
    const release = holdGenerate(gemini)
    await reviewButton(page).click()
    await expect(busyButton(page)).toBeDisabled()
    await expect.poll(() => gemini.generateRequests.length).toBe(1)

    await page.getByRole('link', { name: '返回列表' }).click()
    await expect(page).toHaveURL(HOME_URL)
    release()
    await expect.poll(async () => (await storedEntry(page, id)).analysis).not.toBeNull()

    await page.locator('ul.entries > li a').first().click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expectResultShown(page)
    await expect(contentInput(page)).toHaveValue(DIARY)
    expect(gemini.generateRequests).toHaveLength(1)
  })

  test('an entry deleted in another tab while waiting: the result is discarded', async ({
    page,
    context,
  }) => {
    await setup(page)
    const id = await createEntry(page)
    const release = holdGenerate(gemini)
    await reviewButton(page).click()
    await expect.poll(() => gemini.generateRequests.length).toBe(1)

    // Delete it in a second tab of the same profile.
    const other = await context.newPage()
    other.on('dialog', (dialog) => dialog.accept())
    await other.goto(`./entry/${id}`)
    await other.getByRole('button', { name: '刪除' }).click()
    await expect(other).toHaveURL(HOME_URL)
    const tombstone = await storedEntry(other, id)
    expect(tombstone.deleted).toBe(true)

    release()
    await expect(reviewButton(page)).toBeEnabled()
    // Give the write-back a moment, then check nothing was written.
    await page.waitForTimeout(300)
    expect(await storedEntry(page, id)).toEqual(tombstone)
    await expect(section(page, '判斷的語言')).toHaveCount(0)
    await other.close()
  })

  test('saving an entry deleted in another tab is refused', async ({ page, context }) => {
    await setup(page)
    const id = await createEntry(page)

    const other = await context.newPage()
    other.on('dialog', (dialog) => dialog.accept())
    await other.goto(`./entry/${id}`)
    await other.getByRole('button', { name: '刪除' }).click()
    await expect(other).toHaveURL(HOME_URL)
    const tombstone = await storedEntry(other, id)
    await other.close()

    await contentInput(page).fill('edited after deletion')
    await saveButton(page).click()
    await expect(page.getByRole('alert')).toHaveText(MESSAGES.deleted)
    await expect(contentInput(page)).toHaveValue('edited after deletion')
    expect(await storedEntry(page, id)).toEqual(tombstone)
    expect(gemini.generateRequests).toEqual([])
  })
})
