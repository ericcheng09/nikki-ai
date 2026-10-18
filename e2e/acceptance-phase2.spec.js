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
  backButton,
  settingsIcon,
} from './helpers.js'

// Phase 2 acceptance (spec 8.2): one end-to-end happy path through the UI,
// from setting the API key to a stored, re-reviewed result on desktop and
// mobile widths. Gemini is mocked; only a fake key is used.

const FAKE_KEY = 'test-key-123'
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const FIRST_TEXT = '오늘은 친구와 카페에 갔어요.'
const SECOND_TEXT = '오늘은 친구와 새로운 카페에 갔어요. 커피가 맛있었어요.'

const panel = (page) => page.getByRole('region', { name: 'AI 批改結果' })
const reviewButton = (page) => panel(page).getByRole('button', { name: 'AI 批改', exact: true })
const section = (page, name) => panel(page).getByRole('region', { name })
const form = (page) => page.locator('form.diary-editor')

const firstAnalysis = {
  ...MOCK_ANALYSIS,
  detectedLanguage: '韓文',
  grammarErrors: [],
  correctedText: '오늘은 친구와 카페**에** 갔어요.',
  translation: '今天和朋友去了咖啡店。（第一次）',
}
const secondAnalysis = {
  ...MOCK_ANALYSIS,
  detectedLanguage: '韓文',
  correctedText: '오늘은 친구와 **새** 카페에 갔어요.',
  translation: '今天和朋友去了新的咖啡店。（第二次）',
}

async function layout(page) {
  const f = await form(page).boundingBox()
  const p = await panel(page).boundingBox()
  return { f, p }
}

test('acceptance 8.2: key → model → custom-language diary → AI review → stored, responsive', async ({
  page,
}) => {
  const gemini = await installGeminiMock(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await startApp(page)

  // 8.2-1 / 8.2-12: set the key in settings; a Flash model is auto-selected.
  await settingsIcon(page).click()
  const keySection = page.getByRole('region', { name: 'Gemini API key' })
  await expect(keySection.getByRole('heading', { name: '如何取得 API key' })).toBeVisible()
  await keySection.getByLabel('API key', { exact: true }).fill(FAKE_KEY)
  await keySection.getByRole('button', { name: '儲存' }).click()
  await expect(keySection.locator('form').getByRole('status')).toHaveText('已儲存')
  await expect(keySection.getByText('API key 可以使用', { exact: true })).toBeVisible()
  const modelSelect = page.getByRole('region', { name: 'Gemini 模型' }).getByLabel('模型', { exact: true })
  await expect(modelSelect).toHaveValue('models/gemini-2.5-flash')

  // 8.2-4: write a diary with a custom language (其他 → 韓文).
  await backButton(page).click()
  await expect(page).toHaveURL(HOME_URL)
  await page.getByRole('link', { name: '新增日記' }).click()
  await page.getByLabel('內容').fill(FIRST_TEXT)
  await page.getByLabel('語言', { exact: true }).selectOption({ label: '其他' })
  await page.getByLabel('語言名稱', { exact: true }).fill('韓文')
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page).toHaveURL(ENTRY_URL)
  const id = new URL(page.url()).pathname.split('/').pop()

  // 8.2-3: saving sent nothing to Gemini.
  expect(gemini.generateRequests).toEqual([])

  // AI review (mocked): 8.2-5 sections, 無錯誤, bold.
  gemini.generate = (route) => fulfillJson(route, generateBody(JSON.stringify(firstAnalysis)))
  await reviewButton(page).click()
  await expect(section(page, '中文翻譯')).toContainText('（第一次）')
  for (const name of ['判斷的語言', '文法錯誤', '不通順或易誤會的句子', '更道地的說法', '修改後全文', '中文翻譯']) {
    await expect(section(page, name)).toBeVisible()
  }
  await expect(section(page, '文法錯誤')).toContainText('無錯誤')
  await expect(section(page, '修改後全文').locator('strong')).toHaveText(['에'])
  expect(gemini.generateRequests).toHaveLength(1)
  const prompt = gemini.generateRequests[0].body.contents[0].parts[0].text
  expect(prompt).toContain('這篇日記使用的語言是韓文。')
  expect(prompt).toContain(FIRST_TEXT)
  expect(gemini.generateRequests[0].headers['x-goog-api-key']).toBe(FAKE_KEY)

  // 8.2-6: side by side at 1280px.
  let { f, p } = await layout(page)
  expect(f.x + f.width).toBeLessThanOrEqual(p.x)
  expect(Math.abs(f.y - p.y)).toBeLessThanOrEqual(4)

  // 8.2-7: the review did not change the diary; edit, then re-review replaces.
  let stored = (await readStore(page, 'entries')).find((e) => e.id === id)
  expect(stored.content).toBe(FIRST_TEXT)
  expect(stored.language).toBe('韓文')
  await page.getByLabel('內容').fill(SECOND_TEXT)
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(form(page).getByRole('status')).toHaveText('已儲存')
  // Old result still shown after editing.
  await expect(section(page, '中文翻譯')).toContainText('（第一次）')
  gemini.generate = (route) => fulfillJson(route, generateBody(JSON.stringify(secondAnalysis)))
  await reviewButton(page).click()
  await expect(section(page, '中文翻譯')).toContainText('（第二次）')
  await expect(section(page, '文法錯誤')).not.toContainText('無錯誤')
  expect(gemini.generateRequests).toHaveLength(2)
  expect(gemini.generateRequests[1].body.contents[0].parts[0].text).toContain(SECOND_TEXT)
  stored = (await readStore(page, 'entries')).find((e) => e.id === id)
  expect(stored.content).toBe(SECOND_TEXT)
  expect(stored.analysis.translation).toBe(secondAnalysis.translation)

  // 8.2-8: still shown after reload; 8.2-6: stacked at 375px.
  await page.reload()
  await expect(section(page, '中文翻譯')).toContainText('（第二次）')
  await page.setViewportSize({ width: 375, height: 800 })
  await expect.poll(async () => {
    const box = await layout(page)
    return box.p.y >= box.f.y + box.f.height - 1
  }).toBe(true)
  ;({ f, p } = await layout(page))
  expect(Math.abs(f.x - p.x)).toBeLessThanOrEqual(2)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  // 8.2-4: the custom language is in the settings list and can be deleted.
  await page.goto('./settings')
  const list = page.getByRole('region', { name: '語言清單' })
  await expect(list.locator('li .language-name')).toHaveText(['韓文'])
  await list.getByRole('button', { name: '刪除 韓文', exact: true }).click()
  await expect(list.getByRole('status')).toHaveText('已刪除「韓文」')
  // The entry keeps its language and result.
  await page.goto(`./entry/${id}`)
  await expect(page.getByLabel('語言', { exact: true }).locator('option:checked')).toHaveText('韓文')
  await expect(section(page, '中文翻譯')).toContainText('（第二次）')
  expect(gemini.generateRequests).toHaveLength(2)
})
