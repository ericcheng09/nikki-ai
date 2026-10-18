import {
  test,
  expect,
  HOME_URL,
  readStore,
  startApp,
  writeStore,
  backButton,
  installGeminiMock,
} from './helpers.js'

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
    // 日期 and 語言 share one row (日期 left), both above 內容.
    expect(Math.abs(dateBox.y - selectBox.y)).toBeLessThanOrEqual(2)
    expect(dateBox.x + dateBox.width).toBeLessThanOrEqual(selectBox.x)
    expect(dateBox.y + dateBox.height).toBeLessThan(contentBox.y)
    expect(selectBox.y + selectBox.height).toBeLessThan(contentBox.y)

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
    await backButton(page).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(page.locator('ul.entries > li')).toHaveCount(1)
    await expect(page.locator('ul.entries .entry-preview')).toHaveText('Entry in Korean')
  })
})

// --- Phase 2 F3: 「加入」 button next to 「語言名稱」 -------------------------
// (decisions.md Phase 2 日記語言): adds the typed language to the list right
// away, even if the diary is never saved, and selects it.

const NEW_URL = /\/nikki-ai\/entry\/new$/
const addButton = (page) => page.getByRole('button', { name: '加入', exact: true })
const deleteButton = (page) => page.getByRole('button', { name: '刪除', exact: true })
const reviewPanel = (page) => page.getByRole('region', { name: 'AI 批改結果' })
const languageList = (page) => page.getByRole('region', { name: '語言清單' })

async function chooseOther(page, text) {
  await languageSelect(page).selectOption({ label: '其他' })
  await otherInput(page).fill(text)
}

// Keeps a readwrite transaction on the settings store open (by chaining
// requests) so the app's 加入 transaction waits until releaseSettings().
async function holdSettings(page) {
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('nikki-ai')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          window.__holdSettings = true
          const store = db.transaction('settings', 'readwrite').objectStore('settings')
          const spin = () => {
            if (!window.__holdSettings) {
              db.close()
              return
            }
            store.get('__hold__').onsuccess = spin
          }
          spin()
          resolve()
        }
      }),
  )
}

async function releaseSettings(page) {
  await page.evaluate(() => {
    window.__holdSettings = false
  })
}

test.describe('diary language: 加入', () => {
  test('the 加入 button sits next to 語言名稱 only while 其他 is chosen', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    await expect(addButton(page)).toHaveCount(0)
    await languageSelect(page).selectOption({ label: '其他' })
    await expect(addButton(page)).toBeVisible()
    await expect(addButton(page)).toBeEnabled()
    const inputBox = await otherInput(page).boundingBox()
    const buttonBox = await addButton(page).boundingBox()
    // Same row, to the right of the input.
    expect(buttonBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width - 1)
    expect(Math.abs(buttonBox.y + buttonBox.height / 2 - (inputBox.y + inputBox.height / 2))).toBeLessThanOrEqual(4)
    await languageSelect(page).selectOption({ label: '日文' })
    await expect(addButton(page)).toHaveCount(0)
  })

  test('加入 on a new entry adds, selects and focuses without saving the diary', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    await contentInput(page).fill('오늘은 좋은 날이에요.')
    await chooseOther(page, '  韓文 ')
    await addButton(page).click()

    await expect.poll(() => selectedLabel(page)).toBe('韓文')
    await expect(otherInput(page)).toHaveCount(0)
    await expect(languageSelect(page)).toBeFocused()
    await expect(errorAlert(page)).toHaveCount(0)
    await expectOptions(page, [...BASE_OPTIONS, '韓文', '其他'])
    await expect(page).toHaveURL(NEW_URL)
    await expect(contentInput(page)).toHaveValue('오늘은 좋은 날이에요.')
    await expect.poll(() => storedLanguages(page)).toEqual([activeRecord('韓文')])
    expect(await storedEntries(page)).toEqual([])

    // Leave without saving: the settings page lists it, still no entry.
    await page.goto('./settings')
    await expect(languageList(page).locator('li .language-name')).toHaveText(['韓文'])
    expect(await storedEntries(page)).toEqual([])
    // A later new entry offers it.
    await openNew(page)
    await expectOptions(page, [...BASE_OPTIONS, '韓文', '其他'])
  })

  test('Enter in 語言名稱 acts as 加入 and does not submit the diary', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    await contentInput(page).fill('Bonjour')
    await chooseOther(page, '法文')
    await otherInput(page).press('Enter')

    await expect.poll(() => selectedLabel(page)).toBe('法文')
    await expect(otherInput(page)).toHaveCount(0)
    await expect(languageSelect(page)).toBeFocused()
    await expect.poll(() => storedLanguages(page)).toEqual([activeRecord('法文')])
    await expect(page).toHaveURL(NEW_URL)
    await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
    await expect(notice(page)).not.toHaveText('已儲存')
    expect(await storedEntries(page)).toEqual([])

    // Saving afterwards uses it as a normal option, the list is unchanged.
    const listBefore = await storedLanguages(page)
    await saveButton(page).click()
    await expect(page).toHaveURL(ENTRY_URL)
    const [entry] = await storedEntries(page)
    expect(entry.language).toBe('法文')
    expect(await storedLanguages(page)).toEqual(listBefore)
  })

  test('an IME-confirming Enter (isComposing or keyCode 229) adds and submits nothing', async ({
    page,
  }) => {
    await startApp(page)
    await openNew(page)
    await contentInput(page).fill('안녕')
    await chooseOther(page, '韓文')
    // Synthetic keydowns as browsers fire them when Enter confirms an IME
    // candidate: isComposing (most browsers) or only keyCode 229 (Safari).
    const dispatchEnter = (init) =>
      otherInput(page).evaluate((el, { isComposing, keyCode }) => {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
          isComposing,
        })
        Object.defineProperty(event, 'keyCode', { get: () => keyCode })
        Object.defineProperty(event, 'which', { get: () => keyCode })
        return el.dispatchEvent(event)
      }, init)
    await dispatchEnter({ isComposing: true, keyCode: 229 })
    await dispatchEnter({ isComposing: false, keyCode: 229 })
    // Give a wrongly started 加入 or submit time to show up.
    await page.waitForTimeout(300)
    await expect(otherInput(page)).toHaveValue('韓文')
    expect(await selectedLabel(page)).toBe('其他')
    await expect(errorAlert(page)).toHaveCount(0)
    await expect(page).toHaveURL(NEW_URL)
    expect(await storedLanguages(page)).toEqual([])
    expect(await storedEntries(page)).toEqual([])

    // Control: the same synthetic event with keyCode 13 is a real Enter (加入).
    await dispatchEnter({ isComposing: false, keyCode: 13 })
    await expect.poll(() => selectedLabel(page)).toBe('韓文')
    await expect.poll(() => storedLanguages(page)).toEqual([activeRecord('韓文')])
    await expect(page).toHaveURL(NEW_URL)
    expect(await storedEntries(page)).toEqual([])
  })

  test('a failed 加入 click returns focus to 語言名稱', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    await chooseOther(page, '  ')
    await addButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入日記語言')
    await expect(otherInput(page)).toBeFocused()
  })

  test('blank name: 請輸入日記語言, the input stays open, nothing stored', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    for (const text of ['', '   ']) {
      await chooseOther(page, text)
      await addButton(page).click()
      await expect(errorAlert(page)).toHaveText('請輸入日記語言')
      await expect(otherInput(page)).toBeVisible()
      await expect(otherInput(page)).toHaveValue(text)
      await expect.poll(() => selectedLabel(page)).toBe('其他')
      // Enter behaves the same.
      await otherInput(page).press('Enter')
      await expect(errorAlert(page)).toHaveText('請輸入日記語言')
      await expect(page).toHaveURL(NEW_URL)
    }
    expect(await storedLanguages(page)).toEqual([])
    expect(await storedEntries(page)).toEqual([])
  })

  test('日文 / 英文 / auto / 自動判斷 select that option and add nothing', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    const cases = [
      ['日文', '日文'],
      [' 英文 ', '英文'],
      ['auto', '自動判斷'],
      [' 自動判斷', '自動判斷'],
    ]
    for (const [typed, label] of cases) {
      await chooseOther(page, typed)
      await addButton(page).click()
      await expect.poll(() => selectedLabel(page), typed).toBe(label)
      await expect(otherInput(page)).toHaveCount(0)
      await expect(errorAlert(page)).toHaveCount(0)
    }
    expect(await storedLanguages(page)).toEqual([])
    expect(await storedEntries(page)).toEqual([])
    await expectOptions(page, [...BASE_OPTIONS, '其他'])
  })

  test('re-adding an active name adds nothing; a deleted name is revived in place', async ({
    page,
  }) => {
    await startApp(page)
    const korean = {
      name: '韓文',
      updatedAt: '2026-10-02T00:00:00.000Z',
      deleted: false,
      deletedAt: null,
    }
    const french = {
      name: '法文',
      updatedAt: '2026-10-03T00:00:00.000Z',
      deleted: true,
      deletedAt: '2026-10-03T00:00:00.000Z',
    }
    await writeStore(page, 'settings', { customLanguages: [korean, french] })
    await openNew(page)
    await expectOptions(page, [...BASE_OPTIONS, '韓文', '其他'])

    // Active: selected, record untouched.
    await chooseOther(page, '韓文')
    await addButton(page).click()
    await expect.poll(() => selectedLabel(page)).toBe('韓文')
    await expect(otherInput(page)).toHaveCount(0)
    await expectOptions(page, [...BASE_OPTIONS, '韓文', '其他'])
    expect(await storedLanguages(page)).toEqual([korean, french])

    // Deleted: the same record comes back (same position, new updatedAt).
    await chooseOther(page, '法文')
    await addButton(page).click()
    await expect.poll(() => selectedLabel(page)).toBe('法文')
    await expectOptions(page, [...BASE_OPTIONS, '韓文', '法文', '其他'])
    await expect.poll(async () => (await storedLanguages(page))[1].deleted).toBe(false)
    const list = await storedLanguages(page)
    expect(list).toEqual([korean, activeRecord('法文')])
    expect(list[1].updatedAt > french.updatedAt).toBe(true)
    expect(await storedEntries(page)).toEqual([])
  })

  test('saving with 其他 still open (no 加入) adds the language on save', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    await contentInput(page).fill('สวัสดี')
    await chooseOther(page, ' 泰文 ')
    await saveButton(page).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect.poll(() => selectedLabel(page)).toBe('泰文')
    await expect(otherInput(page)).toHaveCount(0)
    const [entry] = await storedEntries(page)
    expect(entry.language).toBe('泰文')
    expect(await storedLanguages(page)).toEqual([activeRecord('泰文')])
  })

  test('edit mode: 加入 is an unsaved change until the diary is saved', async ({ page }) => {
    const gemini = await installGeminiMock(page)
    await startApp(page)
    await writeStore(page, 'settings', {
      geminiApiKey: 'test-key-123',
      geminiModel: 'models/gemini-2.5-flash',
    })
    const id = await createWith(page, '안녕하세요', { language: '日文' })
    const before = (await storedEntries(page)).find((e) => e.id === id)

    await chooseOther(page, '韓文')
    await addButton(page).click()
    await expect.poll(() => selectedLabel(page)).toBe('韓文')
    await expect.poll(() => storedLanguages(page)).toEqual([activeRecord('韓文')])
    // The entry itself is not saved by 加入.
    expect((await storedEntries(page)).find((e) => e.id === id)).toEqual(before)

    const review = reviewPanel(page).getByRole('button', { name: 'AI 批改', exact: true })
    await review.click()
    await expect(reviewPanel(page).getByRole('alert')).toHaveText('請先儲存日記再批改')
    expect(gemini.generateRequests).toEqual([])

    // After saving, the review runs (mocked).
    await saveButton(page).click()
    await expect(notice(page)).toHaveText('已儲存')
    expect((await storedEntries(page)).find((e) => e.id === id).language).toBe('韓文')
    await review.click()
    await expect(reviewPanel(page).getByRole('region', { name: '中文翻譯' })).toBeVisible()
    expect(gemini.generateRequests).toHaveLength(1)
  })

  test('while 加入 runs, 儲存 / 刪除 / 加入 are disabled and repeats add once', async ({ page }) => {
    await startApp(page)
    const id = await createWith(page, 'Hola')
    await chooseOther(page, '西班牙文')

    await holdSettings(page)
    await addButton(page).click()
    await expect(addButton(page)).toBeDisabled()
    await expect(saveButton(page)).toBeDisabled()
    await expect(deleteButton(page)).toBeDisabled()
    // Further attempts while busy are ignored.
    await addButton(page).dispatchEvent('click')
    await otherInput(page).press('Enter')
    await releaseSettings(page)

    await expect.poll(() => selectedLabel(page)).toBe('西班牙文')
    await expect(otherInput(page)).toHaveCount(0)
    await expect(saveButton(page)).toBeEnabled()
    await expect(deleteButton(page)).toBeEnabled()
    await expect(errorAlert(page)).toHaveCount(0)
    expect(await storedLanguages(page)).toEqual([activeRecord('西班牙文')])
    expect((await storedEntries(page)).find((e) => e.id === id).deleted).toBe(false)
  })

  test('a double click on 加入 adds the language once', async ({ page }) => {
    await startApp(page)
    await openNew(page)
    await chooseOther(page, '德文')
    await addButton(page).dblclick()
    await expect.poll(() => selectedLabel(page)).toBe('德文')
    await expect(errorAlert(page)).toHaveCount(0)
    await expect.poll(() => storedLanguages(page)).toEqual([activeRecord('德文')])
    await expectOptions(page, [...BASE_OPTIONS, '德文', '其他'])
  })
})
