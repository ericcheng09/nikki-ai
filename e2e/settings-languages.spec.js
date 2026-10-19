import {
  test,
  expect,
  installGeminiMock,
  readStore,
  startApp,
  writeStore,
} from './helpers.js'

// E2E for Phase 2 T5: the 語言清單 section of the settings page, and the
// full acceptance flow of spec 8.2-4 (choose built-ins / 其他, the list
// grows, languages can be deleted in settings).
// External requests are blocked by the global guard in helpers.js; tests
// that save an API key also install the Gemini models mock.

const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const EMPTY_TEXT =
  '尚未加入任何語言。在日記的語言選單選「其他」並輸入語言名稱，就會加入這裡。'
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const BASE_OPTIONS = ['自動判斷', '日文', '英文']

const listSection = (page) => page.getByRole('region', { name: '語言清單' })
const listNames = (page) => listSection(page).locator('li .language-name')
const deleteLanguageButton = (page, name) =>
  listSection(page).getByRole('button', { name: `刪除 ${name}`, exact: true })
const keySection = (page) => page.getByRole('region', { name: 'Gemini API key' })

// Editor locators.
const languageSelect = (page) => page.getByLabel('語言', { exact: true })
const otherInput = (page) => page.getByLabel('語言名稱', { exact: true })

const record = (name, at, deleted = false) => ({
  name,
  updatedAt: at,
  deleted,
  deletedAt: deleted ? at : null,
})

async function openSettings(page) {
  await page.goto('./settings')
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
  await expect(listSection(page)).toBeVisible()
  await expect(listSection(page).getByText('載入中…')).toHaveCount(0)
}

async function sectionHeadings(page) {
  return page.locator('section.settings h3').allTextContents()
}

async function storedLanguages(page) {
  return (await readStore(page, 'settings')).customLanguages ?? []
}

async function optionLabels(page) {
  return languageSelect(page).locator('option').allTextContents()
}

async function selectedLabel(page) {
  return languageSelect(page).locator('option:checked').textContent()
}

async function openNew(page) {
  await page.goto('./entry/new')
  await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
}

// Creates an entry; `language` picks an option, `other` types into 其他.
async function createWith(page, content, { language, other } = {}) {
  await openNew(page)
  await page.getByLabel('內容').fill(content)
  if (other !== undefined) {
    await languageSelect(page).selectOption({ label: '其他' })
    await otherInput(page).fill(other)
  } else if (language) {
    await languageSelect(page).selectOption({ label: language })
  }
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page).toHaveURL(ENTRY_URL)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
  return new URL(page.url()).pathname.split('/').pop()
}

function collectDialogs(page) {
  const dialogs = []
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message())
    await dialog.dismiss()
  })
  return dialogs
}

test.describe('settings: 語言清單', () => {
  test('without an API key: shown after the API key section, with the empty text', async ({
    page,
  }) => {
    await openSettings(page)
    expect(await sectionHeadings(page)).toEqual(['Gemini API key', '語言清單', 'Google Drive 同步'])
    await expect(listSection(page).getByText(EMPTY_TEXT, { exact: true })).toBeVisible()
    await expect(listSection(page).locator('li')).toHaveCount(0)
  })

  test('with an API key: shown after the model section, and stays after deleting the key', async ({
    page,
  }) => {
    await installGeminiMock(page)
    await openSettings(page)
    await keySection(page).getByLabel('API key', { exact: true }).fill('test-key-123')
    await keySection(page).getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('region', { name: 'Gemini 模型' })).toBeVisible()
    expect(await sectionHeadings(page)).toEqual(['Gemini API key', 'Gemini 模型', '語言清單', 'Google Drive 同步'])
    await expect(listSection(page).getByText(EMPTY_TEXT, { exact: true })).toBeVisible()

    await keySection(page).getByRole('button', { name: '刪除', exact: true }).click()
    await expect(keySection(page).locator('form').getByRole('status')).toHaveText('已刪除')
    expect(await sectionHeadings(page)).toEqual(['Gemini API key', '語言清單', 'Google Drive 同步'])
    await expect(listSection(page)).toBeVisible()
  })

  test('lists active languages in list order; tombstones are not listed', async ({ page }) => {
    await startApp(page)
    await writeStore(page, 'settings', {
      customLanguages: [
        record('韓文', '2026-10-01T00:00:00.000Z'),
        record('法文', '2026-10-02T00:00:00.000Z', true),
        record('Deutsch', '2026-10-03T00:00:00.000Z'),
        record('泰文', '2026-10-04T00:00:00.000Z'),
      ],
    })
    await openSettings(page)
    await expect(listNames(page)).toHaveText(['韓文', 'Deutsch', '泰文'])
    for (const name of ['韓文', 'Deutsch', '泰文']) {
      await expect(deleteLanguageButton(page, name)).toBeVisible()
      await expect(deleteLanguageButton(page, name)).toHaveText('刪除')
    }
    await expect(deleteLanguageButton(page, '法文')).toHaveCount(0)
    await expect(listSection(page).getByText(EMPTY_TEXT)).toHaveCount(0)
  })

  test('only tombstones: the empty text is shown', async ({ page }) => {
    await startApp(page)
    await writeStore(page, 'settings', {
      customLanguages: [record('法文', '2026-10-02T00:00:00.000Z', true)],
    })
    await openSettings(page)
    await expect(listSection(page).getByText(EMPTY_TEXT, { exact: true })).toBeVisible()
  })

  test('刪除 soft-deletes without a dialog and persists after reload', async ({ page }) => {
    const dialogs = collectDialogs(page)
    await startApp(page)
    const korean = record('韓文', '2026-10-01T00:00:00.000Z')
    const french = record('法文', '2026-10-02T00:00:00.000Z')
    await writeStore(page, 'settings', { customLanguages: [korean, french] })
    await openSettings(page)

    await deleteLanguageButton(page, '韓文').click()
    await expect(listSection(page).getByRole('status')).toHaveText('已刪除「韓文」')
    await expect(listNames(page)).toHaveText(['法文'])
    expect(dialogs).toEqual([])

    const stored = await storedLanguages(page)
    expect(stored).toHaveLength(2)
    expect(stored[1]).toEqual(french)
    expect(stored[0]).toEqual({
      name: '韓文',
      updatedAt: expect.stringMatching(ISO),
      deleted: true,
      deletedAt: expect.stringMatching(ISO),
    })
    expect(stored[0].deletedAt).toBe(stored[0].updatedAt)
    expect(stored[0].updatedAt > korean.updatedAt).toBe(true)

    await page.reload()
    await expect(listNames(page)).toHaveText(['法文'])
    await expect(listSection(page).getByRole('status')).toHaveText('')

    // Deleting the last one shows the empty text.
    await deleteLanguageButton(page, '法文').click()
    await expect(listSection(page).getByRole('status')).toHaveText('已刪除「法文」')
    await expect(listSection(page).getByText(EMPTY_TEXT, { exact: true })).toBeVisible()
    expect((await storedLanguages(page)).map((r) => r.deleted)).toEqual([true, true])
    expect(dialogs).toEqual([])
  })

  test('acceptance 8.2-4: choose languages, the list grows, delete in settings, revive', async ({
    page,
  }) => {
    await startApp(page)

    // Built-ins do not grow the list; 其他 does.
    await createWith(page, '今日は晴れ。', { language: '日文' })
    await createWith(page, 'It was sunny.', { language: '英文' })
    const koreanId = await createWith(page, '오늘은 맑아요.', { other: '韓文' })
    await createWith(page, 'Il fait beau.', { other: ' 法文 ' })
    await createWith(page, 'Encore du soleil.', { language: '法文' })

    await openSettings(page)
    await expect(listNames(page)).toHaveText(['韓文', '法文'])
    const before = await storedLanguages(page)
    expect(before.map((r) => [r.name, r.deleted])).toEqual([
      ['韓文', false],
      ['法文', false],
    ])

    // Delete 韓文 in settings.
    await deleteLanguageButton(page, '韓文').click()
    await expect(listSection(page).getByRole('status')).toHaveText('已刪除「韓文」')
    await expect(listNames(page)).toHaveText(['法文'])

    // New entries no longer offer it.
    await openNew(page)
    await expect.poll(() => optionLabels(page)).toEqual([...BASE_OPTIONS, '法文', '其他'])

    // The entry that used it keeps it, shown selected.
    await page.goto(`./entry/${koreanId}`)
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    await expect.poll(() => optionLabels(page)).toEqual([...BASE_OPTIONS, '法文', '韓文', '其他'])
    expect(await selectedLabel(page)).toBe('韓文')
    const entries = await readStore(page, 'entries')
    expect(entries.find((e) => e.id === koreanId).language).toBe('韓文')

    // Typing 韓文 under 其他 again revives the same record.
    const deletedRecord = (await storedLanguages(page))[0]
    expect(deletedRecord.deleted).toBe(true)
    await createWith(page, '다시 한국어', { other: '韓文' })
    const after = await storedLanguages(page)
    expect(after).toHaveLength(2)
    expect(after[0]).toEqual({
      name: '韓文',
      updatedAt: expect.stringMatching(ISO),
      deleted: false,
      deletedAt: null,
    })
    expect(after[0].updatedAt > deletedRecord.updatedAt).toBe(true)
    expect(after[1]).toEqual(before[1])

    // It is back in the settings list (revived in place, so first again).
    await openSettings(page)
    await expect(listNames(page)).toHaveText(['韓文', '法文'])
    await openNew(page)
    await expect.poll(() => optionLabels(page)).toEqual([...BASE_OPTIONS, '韓文', '法文', '其他'])
  })
})
