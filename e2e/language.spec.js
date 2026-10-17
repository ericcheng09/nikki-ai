import { test, expect, HOME_URL, readStore, startApp, writeStore } from './helpers.js'

// E2E for Phase 2 T4: diary language selection in the editor
// (spec 2.2, 4.1, 8.2-4; decisions.md 日記語言 / 設定頁).

const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const BASE_OPTIONS = ['自動判斷', '日文', '英文']

const dateInput = (page) => page.getByLabel('日期')
const languageSelect = (page) => page.getByLabel('語言', { exact: true })
const otherInput = (page) => page.getByLabel('語言名稱', { exact: true })
const contentInput = (page) => page.getByLabel('內容')
const saveButton = (page) => page.getByRole('button', { name: '儲存' })
const errorAlert = (page) => page.getByRole('alert')
const notice = (page) => page.getByRole('status')

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

async function openEntry(page, id) {
  await page.goto(`./entry/${id}`)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
}

// Waits until the custom list from settings is reflected in the select.
async function expectOptions(page, labels) {
  await expect.poll(() => optionLabels(page)).toEqual(labels)
}

// Creates an entry from the new page; `other` types into 「其他」.
// Returns the new id (stays on the entry page).
async function createWith(page, content, { language, other } = {}) {
  await openNew(page)
  await contentInput(page).fill(content)
  if (other !== undefined) {
    await languageSelect(page).selectOption({ label: '其他' })
    await otherInput(page).fill(other)
  } else if (language) {
    await languageSelect(page).selectOption({ label: language })
  }
  await saveButton(page).click()
  await expect(page).toHaveURL(ENTRY_URL)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
  return new URL(page.url()).pathname.split('/').pop()
}

async function storedEntries(page) {
  return readStore(page, 'entries')
}

async function storedLanguages(page) {
  return (await readStore(page, 'settings')).customLanguages ?? []
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function activeRecord(name) {
  return { name, updatedAt: expect.stringMatching(ISO), deleted: false, deletedAt: null }
}

test.describe('diary language', () => {
  test('the 語言 select sits between 日期 and 內容 and defaults to 自動判斷', async ({ page }) => {
    await startApp(page)
    await page.getByRole('link', { name: '新增日記' }).click()
    await expect(languageSelect(page)).toBeVisible()

    // DOM order of the form controls: date, language, content.
    const order = await page
      .locator('form')
      .locator('input, select, textarea')
      .evaluateAll((els) => els.map((el) => el.tagName.toLowerCase() + ':' + (el.type ?? '')))
    expect(order.slice(0, 3)).toEqual(['input:date', 'select:select-one', 'textarea:textarea'])
    const dateBox = await dateInput(page).boundingBox()
    const selectBox = await languageSelect(page).boundingBox()
    const contentBox = await contentInput(page).boundingBox()
    expect(dateBox.y).toBeLessThan(selectBox.y)
    expect(selectBox.y).toBeLessThan(contentBox.y)

    expect(await selectedLabel(page)).toBe('自動判斷')
    await expectOptions(page, [...BASE_OPTIONS, '其他'])
    await expect(otherInput(page)).toHaveCount(0)

    // A default save stores 'auto'.
    await contentInput(page).fill('Default language entry')
    await saveButton(page).click()
    await expect(page).toHaveURL(ENTRY_URL)
    // The edit page has the select too, with the entry's language.
    expect(await selectedLabel(page)).toBe('自動判斷')
    const [entry] = await storedEntries(page)
    expect(entry.language).toBe('auto')
    expect(await storedLanguages(page)).toEqual([])
  })

  test('其他 shows the 語言名稱 field; choosing another option hides it', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    await languageSelect(page).selectOption({ label: '其他' })
    await expect(otherInput(page)).toBeVisible()
    await expect(otherInput(page)).toHaveAttribute('placeholder', '例如：韓文')
    await languageSelect(page).selectOption({ label: '日文' })
    await expect(otherInput(page)).toHaveCount(0)
  })

  test('blank 其他 is not saved and keeps what was typed', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    await contentInput(page).fill('Keep this text')
    await languageSelect(page).selectOption({ label: '其他' })
    await otherInput(page).fill('  \t ')
    await saveButton(page).click()

    await expect(errorAlert(page)).toHaveText('請輸入日記語言')
    await expect(page).toHaveURL(/\/nikki-ai\/entry\/new$/)
    await expect(contentInput(page)).toHaveValue('Keep this text')
    await expect(otherInput(page)).toHaveValue('  \t ')
    expect(await selectedLabel(page)).toBe('其他')
    expect(await storedEntries(page)).toEqual([])
    expect(await storedLanguages(page)).toEqual([])

    // Empty 其他 too.
    await otherInput(page).fill('')
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入日記語言')
    expect(await storedEntries(page)).toEqual([])
  })

  test('validation order: date, then blank content, then language', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    await dateInput(page).fill('')
    await languageSelect(page).selectOption({ label: '其他' })
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請選擇日期')

    const today = await dateInput(page).evaluate(() => {
      const d = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    })
    await dateInput(page).fill(today)
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('內容不能空白')

    await contentInput(page).fill('Some content')
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入日記語言')
    expect(await storedEntries(page)).toEqual([])
  })

  test('a typed language is trimmed, stored and offered next time without duplicates', async ({
    page,
  }) => {
    await startApp(page)
    const firstId = await createWith(page, '오늘은 좋은 날이에요.', { other: '  韓文 ' })

    // On the entry page: shown as a normal selected option, name field closed.
    expect(await selectedLabel(page)).toBe('韓文')
    await expect(otherInput(page)).toHaveCount(0)
    let entries = await storedEntries(page)
    expect(entries.find((e) => e.id === firstId).language).toBe('韓文')
    const list = await storedLanguages(page)
    expect(list).toEqual([activeRecord('韓文')])
    const firstUpdatedAt = list[0].updatedAt

    // The next new entry lists it; picking it saves without touching the list.
    await openNew(page)
    await expectOptions(page, [...BASE_OPTIONS, '韓文', '其他'])
    expect(await selectedLabel(page)).toBe('自動判斷')
    const secondId = await createWith(page, '두 번째 일기', { language: '韓文' })
    // Typing the same name into 其他 again does not add a second record.
    const thirdId = await createWith(page, '세 번째 일기', { other: '韓文' })
    expect(await selectedLabel(page)).toBe('韓文')

    entries = await storedEntries(page)
    for (const id of [firstId, secondId, thirdId]) {
      expect(entries.find((e) => e.id === id).language).toBe('韓文')
    }
    expect(await storedLanguages(page)).toEqual([
      { name: '韓文', updatedAt: firstUpdatedAt, deleted: false, deletedAt: null },
    ])

    // A second language is appended after the first; order is kept on reload.
    await createWith(page, 'Bonjour', { other: '法文' })
    await openNew(page)
    await expectOptions(page, [...BASE_OPTIONS, '韓文', '法文', '其他'])
    await page.reload()
    await expectOptions(page, [...BASE_OPTIONS, '韓文', '法文', '其他'])
    await openEntry(page, firstId)
    expect(await selectedLabel(page)).toBe('韓文')
    await expect(page.locator('select option', { hasText: '韓文' })).toHaveCount(1)
  })

  test('typing 日文, 英文, auto or 自動判斷 into 其他 adds nothing to the list', async ({ page }) => {
    await startApp(page)
    const cases = [
      ['日文', '日文', '日文'],
      [' 英文 ', '英文', '英文'],
      ['auto', 'auto', '自動判斷'],
      [' 自動判斷', 'auto', '自動判斷'],
    ]
    for (const [typed, stored, label] of cases) {
      const id = await createWith(page, `Typed ${typed}`, { other: typed })
      expect(await selectedLabel(page)).toBe(label)
      await expect(otherInput(page)).toHaveCount(0)
      const entry = (await storedEntries(page)).find((e) => e.id === id)
      expect(entry.language).toBe(stored)
    }
    expect(await storedLanguages(page)).toEqual([])
    await openNew(page)
    await expectOptions(page, [...BASE_OPTIONS, '其他'])
  })

  test('language names are case-sensitive', async ({ page }) => {
    await startApp(page)
    await createWith(page, 'Bonjour', { other: 'French' })
    await createWith(page, 'bonjour', { other: 'french' })
    expect(await storedLanguages(page)).toEqual([activeRecord('French'), activeRecord('french')])
    await openNew(page)
    await expectOptions(page, [...BASE_OPTIONS, 'French', 'french', '其他'])
  })

  test('edit: the entry language is preselected; changing only it saves', async ({ page }) => {
    await startApp(page)
    const analysis = { detectedLanguage: '日文', correctedText: '…', analyzedAt: '2026-01-01T00:00:00.000Z' }
    const seeded = {
      id: 'seeded-entry',
      date: '2026-10-01',
      content: '今日は晴れです。',
      language: '日文',
      createdAt: '2026-10-01T01:00:00.000Z',
      updatedAt: '2026-10-01T01:00:00.000Z',
      deleted: false,
      deletedAt: null,
      analysis,
    }
    await writeStore(page, 'entries', [seeded])

    await openEntry(page, seeded.id)
    expect(await selectedLabel(page)).toBe('日文')
    await languageSelect(page).selectOption({ label: '英文' })
    await saveButton(page).click()
    await expect(notice(page)).toHaveText('已儲存')

    const [stored] = await storedEntries(page)
    expect(stored.language).toBe('英文')
    expect(stored.updatedAt).not.toBe(seeded.updatedAt)
    expect(stored.updatedAt).toMatch(ISO)
    expect(stored).toEqual({ ...seeded, language: '英文', updatedAt: stored.updatedAt })

    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    expect(await selectedLabel(page)).toBe('英文')
    await expect(contentInput(page)).toHaveValue(seeded.content)
  })

  test('edit: saving a new custom language selects it and closes the name field', async ({
    page,
  }) => {
    await startApp(page)
    const id = await createWith(page, 'สวัสดี')
    await languageSelect(page).selectOption({ label: '其他' })
    await otherInput(page).fill(' 泰文 ')
    await saveButton(page).click()
    await expect(notice(page)).toHaveText('已儲存')
    expect(await selectedLabel(page)).toBe('泰文')
    await expect(otherInput(page)).toHaveCount(0)
    await expectOptions(page, [...BASE_OPTIONS, '泰文', '其他'])

    expect((await storedEntries(page)).find((e) => e.id === id).language).toBe('泰文')
    expect(await storedLanguages(page)).toEqual([activeRecord('泰文')])

    // Saving again without changes keeps one record.
    await saveButton(page).click()
    await expect(notice(page)).toHaveText('已儲存')
    expect(await storedLanguages(page)).toHaveLength(1)

    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    expect(await selectedLabel(page)).toBe('泰文')
  })

  test('an entry keeps a language deleted from the list; others do not see it', async ({
    page,
  }) => {
    await startApp(page)
    const base = {
      date: '2026-10-01',
      createdAt: '2026-10-01T01:00:00.000Z',
      updatedAt: '2026-10-01T01:00:00.000Z',
      deleted: false,
      deletedAt: null,
      analysis: null,
    }
    const tombstone = {
      name: '韓文',
      updatedAt: '2026-10-05T00:00:00.000Z',
      deleted: true,
      deletedAt: '2026-10-05T00:00:00.000Z',
    }
    const french = {
      name: '法文',
      updatedAt: '2026-10-02T00:00:00.000Z',
      deleted: false,
      deletedAt: null,
    }
    await writeStore(page, 'entries', [
      { ...base, id: 'korean-entry', content: '안녕하세요', language: '韓文' },
      { ...base, id: 'other-entry', content: 'Hello', language: 'auto' },
    ])
    await writeStore(page, 'settings', { customLanguages: [tombstone, french] })

    await openEntry(page, 'korean-entry')
    await expectOptions(page, [...BASE_OPTIONS, '法文', '韓文', '其他'])
    expect(await selectedLabel(page)).toBe('韓文')

    // Saving it unchanged keeps the language and does not revive the list item.
    await saveButton(page).click()
    await expect(notice(page)).toHaveText('已儲存')
    const korean = (await storedEntries(page)).find((e) => e.id === 'korean-entry')
    expect(korean.language).toBe('韓文')
    expect(await storedLanguages(page)).toEqual([tombstone, french])

    // Other entries and new entries do not list 韓文.
    await openEntry(page, 'other-entry')
    await expectOptions(page, [...BASE_OPTIONS, '法文', '其他'])
    await openNew(page)
    await expectOptions(page, [...BASE_OPTIONS, '法文', '其他'])

    // After a reload the entry still shows 韓文.
    await openEntry(page, 'korean-entry')
    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    await expectOptions(page, [...BASE_OPTIONS, '法文', '韓文', '其他'])
    expect(await selectedLabel(page)).toBe('韓文')
  })

  test('the list page still works with languages set', async ({ page }) => {
    await startApp(page)
    await createWith(page, 'Entry in Korean', { other: '韓文' })
    await page.getByRole('link', { name: '返回列表' }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(page.locator('ul.entries > li')).toHaveCount(1)
    await expect(page.locator('ul.entries .entry-preview')).toHaveText('Entry in Korean')
  })
})
