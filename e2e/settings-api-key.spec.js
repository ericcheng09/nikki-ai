import {
  test,
  expect,
  GEMINI_MODELS_URL,
  MOCK_MODELS,
  fulfillJson,
  installGeminiMock,
  readStore,
  startApp,
  backButton,
  settingsIcon,
} from './helpers.js'

// E2E for Phase 2 T2: Gemini API key on the settings page
// (spec 3.6, 5.4, 8.2-1; decisions.md 設定頁).
// Only fake keys are used. Saving a key queries the model list, which is
// always answered by the Gemini mock; any other external request is
// blocked by the guard in helpers.js and fails the test.

const FAKE_KEY = 'test-key-123'
const OTHER_KEY = 'test-key-456'
const AI_STUDIO_URL = 'https://aistudio.google.com/apikey'

const keyInput = (page) => page.getByLabel('API key', { exact: true })
const saveButton = (page) => page.getByRole('button', { name: '儲存' })
// Scoped to the API key section so the language list's 「刪除 <name>」 buttons
// can never match.
const deleteButton = (page) => keySection(page).getByRole('button', { name: '刪除', exact: true })
const showButton = (page) => page.getByRole('button', { name: '顯示' })
const hideButton = (page) => page.getByRole('button', { name: '隱藏' })
// A saved key shows the result of the shared models check; the default
// mock answers with a list, so a saved key is 「API key 可以使用」.
const statusSet = (page) => keySection(page).getByText('API key 可以使用', { exact: true })
const statusUnset = (page) => page.getByText('尚未設定 API key', { exact: true })
// The model section has its own status/alert lines, so scope to this section.
const keySection = (page) => page.getByRole('region', { name: 'Gemini API key' })
// The key section has two live regions: the key check line and the form's
// 已儲存 / 已刪除 notice.
const notice = (page) => keySection(page).locator('form').getByRole('status')
const keyCheck = (page) => keySection(page).locator('.key-check').getByRole('status')
const recheckButton = (page) => keySection(page).getByRole('button', { name: '重新確認' })
const errorAlert = (page) => keySection(page).getByRole('alert')

async function openSettings(page) {
  await page.goto('./settings')
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Gemini API key' })).toBeVisible()
}

async function storedKey(page) {
  return (await readStore(page, 'settings')).geminiApiKey
}

async function saveKey(page, key) {
  await keyInput(page).fill(key)
  await saveButton(page).click()
  await expect(notice(page)).toHaveText('已儲存')
  await expect(statusSet(page)).toBeVisible()
}

// Records and dismisses any dialog (e.g. a confirm on delete); tests
// assert the list is empty.
function collectDialogs(page) {
  const dialogs = []
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message())
    await dialog.dismiss()
  })
  return dialogs
}

let gemini

test.beforeEach(async ({ page }) => {
  gemini = await installGeminiMock(page)
})

test.describe('settings: Gemini API key', () => {
  test('initial state: not set, hidden input, no 刪除, help with three steps', async ({ page }) => {
    await openSettings(page)
    await expect(statusUnset(page)).toBeVisible()
    await expect(statusSet(page)).toHaveCount(0)
    await expect(page.getByText('目前已設定 API key')).toHaveCount(0)
    await expect(keySection(page).locator('.key-check')).toHaveCount(0)
    await expect(keyInput(page)).toHaveAttribute('type', 'password')
    await expect(keyInput(page)).toHaveValue('')
    await expect(showButton(page)).toBeVisible()
    await expect(saveButton(page)).toBeVisible()
    await expect(deleteButton(page)).toHaveCount(0)

    await expect(page.getByRole('heading', { name: '如何取得 API key' })).toBeVisible()
    await expect(page.locator('ol.settings-steps > li')).toHaveCount(3)
    const link = page.locator(`a[href="${AI_STUDIO_URL}"]`)
    await expect(link).toHaveCount(1)
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    const rel = (await link.getAttribute('rel')).split(/\s+/)
    expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
  })

  test('saving trims whitespace and persists across reload', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, `  ${FAKE_KEY}\t `)
    await expect(deleteButton(page)).toBeVisible()
    await expect(errorAlert(page)).toHaveCount(0)
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    expect(await storedKey(page)).toBe(FAKE_KEY)

    await page.reload()
    await expect(statusSet(page)).toBeVisible()
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    await expect(keyInput(page)).toHaveAttribute('type', 'password')
    await expect(deleteButton(page)).toBeVisible()
    // The 已儲存 notice is not shown again after a reload.
    await expect(notice(page)).toHaveText('')
  })

  test('the key is saved after going through the top bar and survives a new browser', async ({
    newContext,
  }) => {
    const first = await newContext()
    const page = await first.newPage()
    await installGeminiMock(page)
    await startApp(page)
    await settingsIcon(page).click()
    await expect(page.getByRole('heading', { level: 3, name: 'Gemini API key' })).toBeVisible()
    await saveKey(page, FAKE_KEY)
    const state = await first.storageState({ indexedDB: true })
    await first.close()

    const second = await newContext({ storageState: state })
    const page2 = await second.newPage()
    await installGeminiMock(page2)
    await openSettings(page2)
    await expect(statusSet(page2)).toBeVisible()
    await expect(keyInput(page2)).toHaveValue(FAKE_KEY)
    // Saving the key did not disturb the other settings.
    expect(await readStore(page2, 'settings')).toMatchObject({
      welcomeSeen: true,
      geminiApiKey: FAKE_KEY,
    })
    await second.close()
  })

  test('顯示 / 隱藏 toggles the visibility of the key', async ({ page }) => {
    await openSettings(page)
    await keyInput(page).fill(FAKE_KEY)
    await expect(keyInput(page)).toHaveAttribute('type', 'password')

    await showButton(page).click()
    await expect(keyInput(page)).toHaveAttribute('type', 'text')
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    await expect(showButton(page)).toHaveCount(0)

    await hideButton(page).click()
    await expect(keyInput(page)).toHaveAttribute('type', 'password')
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    await expect(hideButton(page)).toHaveCount(0)

    // Toggling does not save anything.
    await expect(statusUnset(page)).toBeVisible()

    // After a reload the field is hidden again.
    await saveKey(page, FAKE_KEY)
    await showButton(page).click()
    await page.reload()
    await expect(keyInput(page)).toHaveAttribute('type', 'password')
    await expect(showButton(page)).toBeVisible()
  })

  test('blank or whitespace-only input is not saved', async ({ page }) => {
    await openSettings(page)
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入 API key')
    await expect(statusUnset(page)).toBeVisible()
    await expect(deleteButton(page)).toHaveCount(0)

    await keyInput(page).fill('   \t  ')
    await expect(errorAlert(page)).toHaveCount(0)
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入 API key')
    await expect(notice(page)).toHaveText('')
    await expect(statusUnset(page)).toBeVisible()
    expect(await storedKey(page) ?? '').toBe('')

    await page.reload()
    await expect(statusUnset(page)).toBeVisible()
    await expect(keyInput(page)).toHaveValue('')
  })

  test('blank input keeps an existing key', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, FAKE_KEY)

    await keyInput(page).fill('    ')
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入 API key')
    await expect(notice(page)).toHaveText('')
    await expect(statusSet(page)).toBeVisible()
    await expect(deleteButton(page)).toBeVisible()
    expect(await storedKey(page)).toBe(FAKE_KEY)

    await page.reload()
    await expect(statusSet(page)).toBeVisible()
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
  })

  test('modifying the key replaces it', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, FAKE_KEY)
    await saveKey(page, ` ${OTHER_KEY} `)
    await expect(keyInput(page)).toHaveValue(OTHER_KEY)
    expect(await storedKey(page)).toBe(OTHER_KEY)

    await page.reload()
    await expect(keyInput(page)).toHaveValue(OTHER_KEY)
    await expect(statusSet(page)).toBeVisible()
  })

  test('刪除 clears the key without a confirm dialog', async ({ page }) => {
    const dialogs = collectDialogs(page)
    await openSettings(page)
    await saveKey(page, FAKE_KEY)

    await deleteButton(page).click()
    await expect(notice(page)).toHaveText('已刪除')
    await expect(statusUnset(page)).toBeVisible()
    await expect(deleteButton(page)).toHaveCount(0)
    await expect(keyInput(page)).toHaveValue('')
    expect(await storedKey(page) ?? '').toBe('')
    expect(dialogs).toEqual([])

    await page.reload()
    await expect(statusUnset(page)).toBeVisible()
    await expect(keyInput(page)).toHaveValue('')
    await expect(deleteButton(page)).toHaveCount(0)

    // A new key can be saved again afterwards.
    await saveKey(page, OTHER_KEY)
    expect(await storedKey(page)).toBe(OTHER_KEY)
  })

  test('the key only goes to Gemini, in the x-goog-api-key header', async ({ page }) => {
    const consoleText = []
    page.on('console', (msg) => consoleText.push(msg.text()))
    page.on('pageerror', (error) => consoleText.push(error.message))
    const leaked = []
    const geminiKeyHeaders = []
    page.on('request', async (request) => {
      const url = new URL(request.url())
      const headers = await request.allHeaders().catch(() => request.headers())
      const toGemini = url.hostname === 'generativelanguage.googleapis.com'
      if (toGemini && request.method() === 'GET') geminiKeyHeaders.push(headers['x-goog-api-key'])
      // Allowed: the x-goog-api-key header of Gemini requests. Nothing else.
      const otherHeaders = Object.entries(headers)
        .filter(([name]) => !(toGemini && name === 'x-goog-api-key'))
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n')
      const parts = [request.url(), request.postData() ?? '', otherHeaders]
      if (parts.some((part) => part.includes(FAKE_KEY))) leaked.push(`${request.method()} ${request.url()}`)
    })

    await openSettings(page)
    await saveKey(page, `  ${FAKE_KEY}  `)
    await showButton(page).click()
    await page.reload()
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    // An invalid attempt and a delete, too.
    await keyInput(page).fill(' ')
    await saveButton(page).click()
    await expect(errorAlert(page)).toHaveText('請輸入 API key')
    await keyInput(page).fill(FAKE_KEY)
    await deleteButton(page).click()
    await expect(notice(page)).toHaveText('已刪除')
    await backButton(page).click()
    await page.waitForLoadState('networkidle')

    // Model list queried after the save and after the reload, with the key
    // only in the header (never in the URL).
    expect(gemini.modelRequests.length).toBeGreaterThanOrEqual(2)
    for (const { url, headers } of gemini.modelRequests) {
      expect(url.startsWith(`${GEMINI_MODELS_URL}?`)).toBe(true)
      expect(url).not.toContain(FAKE_KEY)
      expect(headers['x-goog-api-key']).toBe(FAKE_KEY)
    }
    expect(geminiKeyHeaders.every((value) => value === FAKE_KEY)).toBe(true)
    expect(leaked).toEqual([])
    expect(consoleText.filter((text) => text.includes(FAKE_KEY))).toEqual([])
    // The page text never shows the key outside the input either.
    expect(await page.locator('body').innerText()).not.toContain(FAKE_KEY)
  })
})

// --- Phase 2 F6: key status from the shared models request -----------------
// (decisions.md Phase 2 設定頁). One models.list request per page open, per
// save and per 重新確認 tells whether the key works and lists the models.

const CHECKING = '正在確認 API key…'
const USABLE = 'API key 可以使用'
const INVALID = 'API key 無效，請確認後重新儲存。'
const NETWORK = '無法確認 API key，請檢查網路後再試一次。'
const OTHER = '無法確認 API key，請稍後再試。'
const modelSection = (page) => page.getByRole('region', { name: 'Gemini 模型' })
const modelSelect = (page) => modelSection(page).getByLabel('模型', { exact: true })
const invalidKeyResponse = (route) =>
  fulfillJson(
    route,
    { error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } },
    400,
  )
const listResponse = (route) => fulfillJson(route, { models: MOCK_MODELS })

// Holds model responses until release() is called.
function holdResponses(mock, respond = listResponse) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  mock.respond = async (route) => {
    await gate
    return respond(route)
  }
  return () => release()
}

async function saveRaw(page, key) {
  await keyInput(page).fill(key)
  await saveButton(page).click()
  await expect(notice(page)).toHaveText('已儲存')
}

test.describe('settings: API key check', () => {
  test('正在確認 API key… while the request runs, then API key 可以使用 and the model list', async ({
    page,
  }) => {
    await openSettings(page)
    const release = holdResponses(gemini)
    await saveRaw(page, FAKE_KEY)
    await expect(keyCheck(page)).toHaveText(CHECKING)
    await expect(recheckButton(page)).toHaveCount(0)
    // The model section waits for the same request.
    await expect(modelSection(page).getByText('正在取得模型清單…')).toBeVisible()
    await expect(modelSelect(page)).toHaveCount(0)
    release()
    await expect(keyCheck(page)).toHaveText(USABLE)
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(1)
  })

  test('an invalid key is saved and persisted, with no 重新確認 and no model section', async ({
    page,
  }) => {
    gemini.respond = invalidKeyResponse
    await openSettings(page)
    await saveRaw(page, `  ${FAKE_KEY} `)
    await expect(keyCheck(page)).toHaveText(INVALID)
    await expect(recheckButton(page)).toHaveCount(0)
    await expect(modelSection(page)).toHaveCount(0)
    await expect(deleteButton(page)).toBeVisible()
    expect(await storedKey(page)).toBe(FAKE_KEY)
    expect((await readStore(page, 'settings')).geminiModel ?? '').toBe('')

    await page.reload()
    await expect(keyInput(page)).toHaveValue(FAKE_KEY)
    await expect(keyCheck(page)).toHaveText(INVALID)
    await expect(modelSection(page)).toHaveCount(0)
    expect(await storedKey(page)).toBe(FAKE_KEY)
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(2)
  })

  for (const [title, respond, message] of [
    ['network failure', (route) => route.abort('internetdisconnected'), NETWORK],
    ['429', (route) => fulfillJson(route, { error: { status: 'RESOURCE_EXHAUSTED' } }, 429), OTHER],
    ['500', (route) => fulfillJson(route, { error: {} }, 500), OTHER],
  ]) {
    test(`${title}: 重新確認 sends exactly one request; a later success shows the list`, async ({
      page,
    }) => {
      gemini.respond = respond
      await openSettings(page)
      await saveRaw(page, FAKE_KEY)
      await expect(keyCheck(page)).toHaveText(message)
      await expect(modelSection(page)).toHaveCount(0)
      await page.waitForLoadState('networkidle')
      expect(gemini.modelRequests).toHaveLength(1)

      // A check not started by 重新確認 never moves focus to the line.
      await expect(keyCheck(page)).not.toBeFocused()

      // Failing again: 正在確認 → same message, one more request. Meanwhile
      // the button stays (aria-disabled) and keeps focus; repeats are ignored.
      let release = holdResponses(gemini, respond)
      await recheckButton(page).click()
      await expect(keyCheck(page)).toHaveText(CHECKING)
      await expect(recheckButton(page)).toHaveAttribute('aria-disabled', 'true')
      await expect(recheckButton(page)).toBeFocused()
      await recheckButton(page).dispatchEvent('click')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Space')
      release()
      await expect(keyCheck(page)).toHaveText(message)
      // Active again, still focused.
      await expect(recheckButton(page)).not.toHaveAttribute('aria-disabled', 'true')
      await expect(recheckButton(page)).toBeFocused()
      await page.waitForLoadState('networkidle')
      expect(gemini.modelRequests).toHaveLength(2)

      // Succeeding (by keyboard): exactly one more request, list shown, no
      // retry left; focus moves to the status line.
      release = holdResponses(gemini, listResponse)
      await page.keyboard.press('Enter')
      await expect(keyCheck(page)).toHaveText(CHECKING)
      await expect(recheckButton(page)).toBeFocused()
      release()
      await expect(keyCheck(page)).toHaveText(USABLE)
      await expect(recheckButton(page)).toHaveCount(0)
      await expect(keyCheck(page)).toBeFocused()
      await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')
      await page.waitForLoadState('networkidle')
      expect(gemini.modelRequests).toHaveLength(3)
      for (const { headers } of gemini.modelRequests) expect(headers['x-goog-api-key']).toBe(FAKE_KEY)
    })
  }

  test('重新確認 ending in an invalid key moves focus to the status line', async ({ page }) => {
    gemini.respond = (route) => route.abort('internetdisconnected')
    await openSettings(page)
    await saveRaw(page, FAKE_KEY)
    await expect(keyCheck(page)).toHaveText(NETWORK)
    gemini.respond = invalidKeyResponse
    await recheckButton(page).click()
    await expect(keyCheck(page)).toHaveText(INVALID)
    await expect(recheckButton(page)).toHaveCount(0)
    await expect(keyCheck(page)).toBeFocused()
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(2)
  })

  test('checks on page open and after a save never move focus', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, FAKE_KEY)
    await expect(keyCheck(page)).not.toBeFocused()
    // Page open: focus is not pulled to the status line.
    const release = holdResponses(gemini)
    await page.reload()
    await expect(keyCheck(page)).toHaveText(CHECKING)
    await keyInput(page).focus()
    release()
    await expect(keyCheck(page)).toHaveText(USABLE)
    await expect(keyInput(page)).toBeFocused()
  })

  test('exactly one models request per page open, per save (same key too), none without a key', async ({
    page,
  }) => {
    await openSettings(page)
    await expect(statusUnset(page)).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(0)

    await saveKey(page, FAKE_KEY)
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(1)

    await saveKey(page, FAKE_KEY)
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(2)

    await page.reload()
    await expect(statusSet(page)).toBeVisible()
    await expect(modelSelect(page)).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(3)

    // Changing the model does not query again.
    await modelSelect(page).selectOption({ label: 'Gemini 2.5 Pro' })
    await expect(modelSection(page).getByRole('status')).toHaveText('已儲存')
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(3)

    // Deleting the key does not query; the check line goes away.
    await deleteButton(page).click()
    await expect(notice(page)).toHaveText('已刪除')
    await expect(statusUnset(page)).toBeVisible()
    await expect(keySection(page).locator('.key-check')).toHaveCount(0)
    await page.reload()
    await expect(statusUnset(page)).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(3)
  })

  test('deleting the key while it is being checked drops the result', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, FAKE_KEY)
    const release = holdResponses(gemini, invalidKeyResponse)
    await page.reload()
    await expect(keyCheck(page)).toHaveText(CHECKING)
    await deleteButton(page).click()
    await expect(notice(page)).toHaveText('已刪除')
    release()
    await page.waitForLoadState('networkidle')
    await expect(statusUnset(page)).toBeVisible()
    await expect(page.getByText(INVALID)).toHaveCount(0)
    await expect(modelSection(page)).toHaveCount(0)
  })

  test('the key never appears in messages, page text or the console', async ({ page }) => {
    const consoleText = []
    page.on('console', (msg) => consoleText.push(msg.text()))
    page.on('pageerror', (error) => consoleText.push(error.message))
    const bodyWithoutInput = async () =>
      page.evaluate(() => {
        const clone = document.body.cloneNode(true)
        for (const input of clone.querySelectorAll('input')) input.remove()
        return clone.innerText
      })
    const states = [
      [invalidKeyResponse, INVALID],
      [(route) => route.abort('internetdisconnected'), NETWORK],
      // An error body echoing the key must not reach the page.
      [(route) => fulfillJson(route, { error: { message: `bad key ${FAKE_KEY}` } }, 500), OTHER],
      [listResponse, USABLE],
    ]
    await openSettings(page)
    await keyInput(page).fill(FAKE_KEY)
    await showButton(page).click()
    for (const [respond, message] of states) {
      gemini.respond = respond
      await saveButton(page).click()
      await expect(keyCheck(page)).toHaveText(message)
      expect(await bodyWithoutInput()).not.toContain(FAKE_KEY)
    }
    expect(consoleText.filter((text) => text.includes(FAKE_KEY))).toEqual([])
  })
})

// --- Focus around 儲存 / 刪除 in the API key section -----------------------
// While saving, 儲存 and 刪除 are aria-disabled (not disabled), so focus
// stays on the clicked button; after 刪除 focus moves to the input.

// Keeps a readwrite transaction on the settings store open (by chaining
// requests) so the app's save waits until releaseSettings().
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

const keySaveButton = (page) => keySection(page).getByRole('button', { name: '儲存', exact: true })

test.describe('settings: API key focus while saving', () => {
  test('clicking 儲存 keeps focus on it; aria-disabled while saving; repeats save once', async ({
    page,
  }) => {
    await openSettings(page)
    await keyInput(page).fill(FAKE_KEY)
    await holdSettings(page)
    await keySaveButton(page).click()
    await expect(keySaveButton(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(keySaveButton(page)).toBeFocused()
    // Repeats while saving are ignored.
    await keySaveButton(page).dispatchEvent('click')
    await page.keyboard.press('Enter')
    await keyInput(page).press('Enter')
    await keySaveButton(page).focus()
    await releaseSettings(page)

    await expect(notice(page)).toHaveText('已儲存')
    await expect(keySaveButton(page)).not.toHaveAttribute('aria-disabled', 'true')
    await expect(keySaveButton(page)).toBeFocused()
    await expect(statusSet(page)).toBeVisible()
    expect(await storedKey(page)).toBe(FAKE_KEY)
    // One save = one key check.
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(1)
  })

  test('a quick double click on 儲存 saves once and keeps focus', async ({ page }) => {
    await openSettings(page)
    await keyInput(page).fill(FAKE_KEY)
    await keySaveButton(page).dblclick()
    await expect(notice(page)).toHaveText('已儲存')
    await expect(statusSet(page)).toBeVisible()
    await expect(keySaveButton(page)).toBeFocused()
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(1)
  })

  test('Enter in the input saves once; 儲存 / 刪除 are aria-disabled meanwhile', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, FAKE_KEY)
    await keyInput(page).fill(OTHER_KEY)
    await holdSettings(page)
    await keyInput(page).press('Enter')
    await expect(keySaveButton(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(deleteButton(page)).toHaveAttribute('aria-disabled', 'true')
    await keyInput(page).press('Enter')
    await deleteButton(page).dispatchEvent('click')
    await releaseSettings(page)
    await expect(notice(page)).toHaveText('已儲存')
    await expect(deleteButton(page)).not.toHaveAttribute('aria-disabled', 'true')
    expect(await storedKey(page)).toBe(OTHER_KEY)
    await page.waitForLoadState('networkidle')
    expect(gemini.modelRequests).toHaveLength(2)
  })

  test('after 刪除, focus moves to the API key input', async ({ page }) => {
    await openSettings(page)
    await saveKey(page, FAKE_KEY)
    await holdSettings(page)
    await deleteButton(page).click()
    await expect(deleteButton(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(deleteButton(page)).toBeFocused()
    await releaseSettings(page)
    await expect(notice(page)).toHaveText('已刪除')
    await expect(deleteButton(page)).toHaveCount(0)
    await expect(keyInput(page)).toBeFocused()
    await expect(keyInput(page)).toHaveValue('')
    expect(await storedKey(page) ?? '').toBe('')
  })
})
