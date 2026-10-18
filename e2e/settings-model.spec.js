import {
  test,
  expect,
  GEMINI_MODELS_URL,
  MOCK_MODELS,
  fulfillJson,
  installGeminiMock,
  readStore,
  writeStore,
} from './helpers.js'

// E2E for Phase 2 T2b: Gemini model selection on the settings page
// (spec 3.6, 5.1, 8.2-12; decisions.md 「Gemini 模型」).
// The models endpoint is always mocked; other external requests are blocked
// by the guard in helpers.js and fail the test.

const FAKE_KEY = 'test-key-123'
const OTHER_KEY = 'test-key-456'

// Shown in the API key section when the shared models request fails.
const ERRORS = {
  invalidKey: 'API key 無效，請確認後重新儲存。',
  network: '無法確認 API key，請檢查網路後再試一次。',
  other: '無法確認 API key，請稍後再試。',
}
const MISSING_MODEL = '目前選擇的模型已無法使用，請重新選擇。'

const keySection = (page) => page.getByRole('region', { name: 'Gemini API key' })
const modelSection = (page) => page.getByRole('region', { name: 'Gemini 模型' })
const modelSelect = (page) => modelSection(page).getByLabel('模型', { exact: true })
const modelNotice = (page) => modelSection(page).getByRole('status')
const modelAlert = (page) => modelSection(page).getByRole('alert')
const keyCheck = (page) => keySection(page).locator('.key-check').getByRole('status')
const keyNotice = (page) => keySection(page).locator('form').getByRole('status')
const recheckButton = (page) => keySection(page).getByRole('button', { name: '重新確認' })

const model = (name, displayName, methods = ['generateContent']) => ({
  name,
  ...(displayName === undefined ? {} : { displayName }),
  supportedGenerationMethods: methods,
})
const listOf = (models) => (route) => fulfillJson(route, { models })

async function openSettings(page) {
  await page.goto('./settings')
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Gemini API key' })).toBeVisible()
}

async function saveKey(page, key = FAKE_KEY) {
  await keySection(page).getByLabel('API key', { exact: true }).fill(key)
  await keySection(page).getByRole('button', { name: '儲存' }).click()
  await expect(keyNotice(page)).toHaveText('已儲存')
}

async function storedModel(page) {
  return (await readStore(page, 'settings')).geminiModel
}

// Option labels of the select, excluding the disabled placeholder.
async function optionLabels(page) {
  return modelSelect(page).locator('option:not([disabled])').allTextContents()
}

let gemini

test.beforeEach(async ({ page }) => {
  gemini = await installGeminiMock(page)
})

test.describe('settings: Gemini model', () => {
  test('no model section and no request without a saved key', async ({ page }) => {
    await openSettings(page)
    await expect(keySection(page).getByText('尚未設定 API key', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(modelSection(page)).toHaveCount(0)
    expect(gemini.modelRequests).toEqual([])
  })

  test('saving a key queries the models and auto-selects the first Flash model', async ({
    page,
  }) => {
    // Hold the first response so the loading state can be observed.
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    gemini.respond = async (route) => {
      await held
      return fulfillJson(route, { models: MOCK_MODELS })
    }

    await openSettings(page)
    await saveKey(page, `  ${FAKE_KEY} `)
    await expect(modelSection(page)).toBeVisible()
    await expect(modelSection(page).getByText('正在取得模型清單…')).toBeVisible()
    release()
    await expect(modelSection(page).getByText('正在取得模型清單…')).toHaveCount(0)

    // Only Gemini models supporting generateContent, by displayName, in API order.
    await expect.poll(() => optionLabels(page)).toEqual([
      'Gemini 2.5 Pro',
      'Gemini 2.5 Flash',
      'Gemini 2.0 Flash-Lite',
    ])
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')
    await expect.poll(() => storedModel(page)).toBe('models/gemini-2.5-flash')
    await expect(modelAlert(page)).toHaveCount(0)

    // One request: pageSize=1000, key (trimmed) only in the header.
    expect(gemini.modelRequests).toHaveLength(1)
    const [{ url, headers }] = gemini.modelRequests
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe(GEMINI_MODELS_URL)
    expect(parsed.searchParams.get('pageSize')).toBe('1000')
    expect(url).not.toContain(FAKE_KEY)
    expect(headers['x-goog-api-key']).toBe(FAKE_KEY)
  })

  test('Flash match is case-insensitive; a missing displayName falls back to the name', async ({
    page,
  }) => {
    gemini.respond = listOf([
      model('models/gemini-pro-x', 'Gemini Pro X'),
      model('models/gemini-X-FLASH-preview'),
      model('models/gemini-flash-later', 'Later Flash'),
    ])
    await openSettings(page)
    await saveKey(page)
    await expect(modelSelect(page)).toHaveValue('models/gemini-X-FLASH-preview')
    await expect.poll(() => optionLabels(page)).toEqual([
      'Gemini Pro X',
      'models/gemini-X-FLASH-preview',
      'Later Flash',
    ])
    await expect.poll(() => storedModel(page)).toBe('models/gemini-X-FLASH-preview')
  })

  test('without a Flash model nothing is selected and 請選擇模型 is shown', async ({ page }) => {
    gemini.respond = listOf([
      model('models/gemini-2.5-pro', 'Gemini 2.5 Pro'),
      // A pinned stable revision (still a main text model, not Flash).
      model('models/gemini-1.5-pro-002', 'Gemini 1.5 Pro 002'),
      // Not a gemini model / not generateContent: filtered out, never picked.
      model('models/gemma-flash', 'Gemma Flash'),
      model('models/gemini-flash-embed', 'Embed Flash', ['embedContent']),
    ])
    await openSettings(page)
    await saveKey(page)
    await expect.poll(() => optionLabels(page)).toEqual(['Gemini 2.5 Pro', 'Gemini 1.5 Pro 002'])
    await expect(modelSelect(page)).toHaveValue('')
    await expect(modelSelect(page).locator('option:checked')).toHaveText('請選擇模型')
    // 請選擇模型 appears only as the placeholder option, not as a separate line.
    await expect(modelSection(page).locator('p', { hasText: '請選擇模型' })).toHaveCount(0)
    expect((await storedModel(page)) ?? '').toBe('')

    // Picking one saves it.
    await modelSelect(page).selectOption('models/gemini-1.5-pro-002')
    await expect(modelNotice(page)).toHaveText('已儲存')
    await expect.poll(() => storedModel(page)).toBe('models/gemini-1.5-pro-002')
  })

  test('changing the model saves immediately and persists after reload', async ({ page }) => {
    await openSettings(page)
    await saveKey(page)
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')
    await expect(modelNotice(page)).toHaveText('')

    await modelSelect(page).selectOption({ label: 'Gemini 2.5 Pro' })
    await expect(modelNotice(page)).toHaveText('已儲存')
    await expect.poll(() => storedModel(page)).toBe('models/gemini-2.5-pro')

    // Opening the page with a saved key queries again; the choice is kept
    // (not replaced by the Flash auto-pick).
    await page.reload()
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-pro')
    expect(gemini.modelRequests).toHaveLength(2)
    await expect(modelNotice(page)).toHaveText('')
    expect(await storedModel(page)).toBe('models/gemini-2.5-pro')
  })

  test('a saved model missing from the list asks the user to choose again', async ({ page }) => {
    await openSettings(page)
    await saveKey(page)
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')

    // The previously chosen model is gone from the next list.
    gemini.respond = listOf([
      model('models/gemini-3-pro', 'Gemini 3 Pro'),
      model('models/gemini-3-flash', 'Gemini 3 Flash'),
    ])
    await page.reload()
    await expect(modelAlert(page)).toHaveText(MISSING_MODEL)
    await expect(modelSelect(page)).toHaveValue('')
    // Not auto-replaced: the stored value stays until the user picks.
    expect(await storedModel(page)).toBe('models/gemini-2.5-flash')

    await modelSelect(page).selectOption('models/gemini-3-pro')
    await expect(modelNotice(page)).toHaveText('已儲存')
    await expect(modelAlert(page)).toHaveCount(0)
    await expect.poll(() => storedModel(page)).toBe('models/gemini-3-pro')
  })

  test('follows nextPageToken across pages', async ({ page }) => {
    gemini.respond = (route) => {
      const token = new URL(route.request().url()).searchParams.get('pageToken')
      if (!token) {
        return fulfillJson(route, {
          models: [model('models/gemini-2.5-pro', 'Gemini 2.5 Pro'), model('models/embedding-1', 'E')],
          nextPageToken: 'page-2',
        })
      }
      if (token === 'page-2') {
        return fulfillJson(route, {
          models: [model('models/gemini-2.5-flash', 'Gemini 2.5 Flash')],
          nextPageToken: 'page-3',
        })
      }
      return fulfillJson(route, { models: [model('models/gemini-3-pro', 'Gemini 3 Pro')] })
    }
    await openSettings(page)
    await saveKey(page)
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')
    await expect.poll(() => optionLabels(page)).toEqual(['Gemini 2.5 Pro', 'Gemini 2.5 Flash', 'Gemini 3 Pro'])

    const tokens = gemini.modelRequests.map(({ url }) => new URL(url).searchParams.get('pageToken'))
    expect(tokens).toEqual([null, 'page-2', 'page-3'])
    for (const { url, headers } of gemini.modelRequests) {
      expect(new URL(url).searchParams.get('pageSize')).toBe('1000')
      expect(headers['x-goog-api-key']).toBe(FAKE_KEY)
    }
  })

  test('an empty filtered list shows 找不到可用的模型。', async ({ page }) => {
    gemini.respond = listOf([
      model('models/embedding-001', 'Embedding', ['embedContent']),
      model('models/gemma-3', 'Gemma 3'),
    ])
    await openSettings(page)
    await saveKey(page)
    await expect(modelSection(page).getByText('找不到可用的模型。')).toBeVisible()
    await expect.poll(() => optionLabels(page)).toEqual([])
    expect((await storedModel(page)) ?? '').toBe('')
  })

  // retry: whether 「重新確認」 is offered (not for an invalid key).
  const failures = [
    {
      title: '400 API_KEY_INVALID',
      message: ERRORS.invalidKey,
      retry: false,
      respond: (route) =>
        fulfillJson(
          route,
          {
            error: {
              code: 400,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'INVALID_ARGUMENT',
              details: [{ reason: 'API_KEY_INVALID' }],
            },
          },
          400,
        ),
    },
    { title: '401', message: ERRORS.invalidKey, retry: false, respond: (route) => fulfillJson(route, { error: {} }, 401) },
    { title: '403', message: ERRORS.invalidKey, retry: false, respond: (route) => fulfillJson(route, { error: {} }, 403) },
    { title: 'network failure', message: ERRORS.network, retry: true, respond: (route) => route.abort('internetdisconnected') },
    { title: '500', message: ERRORS.other, retry: true, respond: (route) => fulfillJson(route, { error: {} }, 500) },
    { title: '503', message: ERRORS.other, retry: true, respond: (route) => fulfillJson(route, { error: {} }, 503) },
    { title: '429', message: ERRORS.other, retry: true, respond: (route) => fulfillJson(route, { error: {} }, 429) },
    {
      title: '400 without API_KEY_INVALID',
      message: ERRORS.other,
      retry: true,
      respond: (route) => fulfillJson(route, { error: { code: 400, status: 'INVALID_ARGUMENT' } }, 400),
    },
    {
      title: 'malformed 200 body',
      message: ERRORS.other,
      retry: true,
      respond: (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          headers: { 'access-control-allow-origin': '*' },
          body: '<html>not json</html>',
        }),
    },
  ]

  for (const failure of failures) {
    test(`query failure (${failure.title}): key section error, model section hidden, model kept`, async ({
      page,
    }) => {
      await openSettings(page)
      await saveKey(page)
      await modelSelect(page).selectOption('models/gemini-2.5-pro')
      await expect(modelNotice(page)).toHaveText('已儲存')

      gemini.respond = failure.respond
      await page.reload()
      await expect(keyCheck(page)).toHaveText(failure.message)
      await expect(recheckButton(page)).toHaveCount(failure.retry ? 1 : 0)
      // The model section is gone entirely: no error text, no 重新查詢.
      await expect(modelSection(page)).toHaveCount(0)
      await expect(page.getByRole('button', { name: '重新查詢' })).toHaveCount(0)
      await expect(page.getByText('正在取得模型清單…')).toHaveCount(0)
      await expect(page.getByText(failure.message)).toHaveCount(1)
      await expect(page.getByText('目前已設定 API key')).toHaveCount(0)
      // Neither the model nor the key is changed by a failure.
      await page.waitForLoadState('networkidle')
      expect(await storedModel(page)).toBe('models/gemini-2.5-pro')
      expect((await readStore(page, 'settings')).geminiApiKey).toBe(FAKE_KEY)
      expect(gemini.modelRequests).toHaveLength(2)

      gemini.respond = listOf(MOCK_MODELS)
      if (failure.retry) {
        // 重新確認: exactly one more request; success shows the list.
        await recheckButton(page).click()
        await expect(keyCheck(page)).toHaveText('API key 可以使用')
        await expect(recheckButton(page)).toHaveCount(0)
      } else {
        // No retry for an invalid key: saving a key again checks it.
        await saveKey(page)
        await expect(keyCheck(page)).toHaveText('API key 可以使用')
      }
      await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-pro')
      await page.waitForLoadState('networkidle')
      expect(gemini.modelRequests).toHaveLength(3)
      expect(await storedModel(page)).toBe('models/gemini-2.5-pro')
    })
  }

  test('saving the key again re-queries the model list', async ({ page }) => {
    await openSettings(page)
    await saveKey(page)
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')
    expect(gemini.modelRequests).toHaveLength(1)

    gemini.respond = listOf([model('models/gemini-3-flash', 'Gemini 3 Flash')])
    await saveKey(page, OTHER_KEY)
    // The saved model is not in the new list: user is asked to choose.
    await expect(modelAlert(page)).toHaveText(MISSING_MODEL)
    expect(gemini.modelRequests).toHaveLength(2)
    expect(gemini.modelRequests[1].headers['x-goog-api-key']).toBe(OTHER_KEY)

    // Saving the same key once more still queries.
    await saveKey(page, OTHER_KEY)
    await expect(modelAlert(page)).toHaveText(MISSING_MODEL)
    expect(gemini.modelRequests).toHaveLength(3)
  })

  test('deleting the key hides the section but keeps geminiModel stored', async ({ page }) => {
    await openSettings(page)
    await saveKey(page)
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')

    await keySection(page).getByRole('button', { name: '刪除' }).click()
    await expect(keyNotice(page)).toHaveText('已刪除')
    await expect(modelSection(page)).toHaveCount(0)
    expect(await storedModel(page)).toBe('models/gemini-2.5-flash')

    await page.reload()
    await expect(keySection(page).getByText('尚未設定 API key', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(modelSection(page)).toHaveCount(0)
    expect(gemini.modelRequests).toHaveLength(1)
    expect(await storedModel(page)).toBe('models/gemini-2.5-flash')

    // A new key brings the section back with the stored model selected.
    await saveKey(page, OTHER_KEY)
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')
  })
})

// --- Phase 2 F5: stricter model list (decisions.md 「Gemini 模型」) ---------
// Only stable main text models are listed: gemini-<version>-pro / -flash /
// -flash-lite, optionally with a 3-digit revision. If none match, the full
// generateContent list is shown. A saved model hidden by the filter but
// still available stays as an extra last option without a warning.

// A realistic list in API order: stable models mixed with previews,
// experimental, -latest, image, TTS, live, embedding and Gemma entries.
const REALISTIC_MODELS = [
  model('models/gemini-2.5-flash-preview-05-20', 'Gemini 2.5 Flash Preview 05-20'),
  model('models/gemini-2.5-pro', 'Gemini 2.5 Pro'),
  model('models/gemini-2.0-flash-exp', 'Gemini 2.0 Flash Experimental'),
  model('models/gemini-flash-latest', 'Gemini Flash Latest'),
  model('models/gemini-2.5-flash-image', 'Nano Banana'),
  model('models/gemini-2.5-flash-preview-tts', 'Gemini 2.5 Flash Preview TTS'),
  model('models/gemini-2.0-flash-live-001', 'Gemini 2.0 Flash Live'),
  model('models/gemini-2.0-flash-001', 'Gemini 2.0 Flash 001'),
  model('models/gemini-2.5-flash', 'Gemini 2.5 Flash'),
  model('models/gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'),
  model('models/gemini-3-pro-preview', 'Gemini 3 Pro Preview'),
  model('models/gemini-2.0-flash-lite-001', 'Gemini 2.0 Flash-Lite 001'),
  model('models/gemini-exp-1206', 'Gemini Experimental 1206'),
  model('models/gemini-pro-latest', 'Gemini Pro Latest'),
  model('models/gemini-2.0-flash-thinking-exp', 'Gemini 2.0 Flash Thinking'),
  model('models/gemini-embedding-001', 'Gemini Embedding 001', ['embedContent']),
  model('models/gemma-3-27b-it', 'Gemma 3 27B'),
  model('models/gemini-1.5-flash-8b', 'Gemini 1.5 Flash-8B'),
]
const STABLE_LABELS = [
  'Gemini 2.5 Pro',
  'Gemini 2.0 Flash 001',
  'Gemini 2.5 Flash',
  'Gemini 2.5 Flash-Lite',
  'Gemini 2.0 Flash-Lite 001',
]

async function seedSettings(page, settings) {
  // The app creates its database on first load.
  await openSettings(page)
  await writeStore(page, 'settings', settings)
  await page.reload()
  await expect(page.getByRole('heading', { level: 3, name: 'Gemini API key' })).toBeVisible()
}

test.describe('settings: Gemini model filter', () => {
  test('lists only stable main text models in API order; auto-picks the newest stable Flash', async ({
    page,
  }) => {
    gemini.respond = listOf(REALISTIC_MODELS)
    await openSettings(page)
    await saveKey(page)
    // The newest stable Flash (gemini-2.5-flash), not the earlier
    // gemini-2.0-flash-001 nor any preview, -exp or -latest Flash entry.
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash')
    await expect.poll(() => optionLabels(page)).toEqual(STABLE_LABELS)
    await expect.poll(() => storedModel(page)).toBe('models/gemini-2.5-flash')
    await expect(modelAlert(page)).toHaveCount(0)
    await expect(modelSection(page).getByText('找不到可用的模型。')).toHaveCount(0)
  })

  test('when no stable model matches, the full generateContent list is shown', async ({
    page,
  }) => {
    const fallback = [
      model('models/gemini-3-pro-preview', 'Gemini 3 Pro Preview'),
      model('models/gemini-embedding-001', 'Gemini Embedding 001', ['embedContent']),
      model('models/gemini-2.5-flash-preview-05-20', 'Gemini 2.5 Flash Preview'),
      model('models/gemma-3-27b-it', 'Gemma 3 27B'),
      model('models/gemini-flash-latest', 'Gemini Flash Latest'),
    ]
    gemini.respond = listOf(fallback)
    await openSettings(page)
    await saveKey(page)
    // Embedding (no generateContent) and Gemma stay out; order kept.
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-flash-preview-05-20')
    await expect.poll(() => optionLabels(page)).toEqual([
      'Gemini 3 Pro Preview',
      'Gemini 2.5 Flash Preview',
      'Gemini Flash Latest',
    ])
    await expect.poll(() => storedModel(page)).toBe('models/gemini-2.5-flash-preview-05-20')
    await expect(modelAlert(page)).toHaveCount(0)
  })

  test('a saved preview still available stays as an extra last option, no warning', async ({
    page,
  }) => {
    gemini.respond = listOf(REALISTIC_MODELS)
    await seedSettings(page, {
      geminiApiKey: FAKE_KEY,
      geminiModel: 'models/gemini-3-pro-preview',
    })
    await expect(modelSelect(page)).toHaveValue('models/gemini-3-pro-preview')
    await expect.poll(() => optionLabels(page)).toEqual([...STABLE_LABELS, 'Gemini 3 Pro Preview'])
    await expect(modelAlert(page)).toHaveCount(0)
    await expect(modelSection(page).getByText(MISSING_MODEL)).toHaveCount(0)
    // Not replaced by the Flash auto-pick; the stored value is unchanged.
    await page.waitForLoadState('networkidle')
    expect(await storedModel(page)).toBe('models/gemini-3-pro-preview')

    // Choosing a stable model drops the extra option on the next visit.
    await modelSelect(page).selectOption({ label: 'Gemini 2.5 Pro' })
    await expect(modelNotice(page)).toHaveText('已儲存')
    await expect.poll(() => storedModel(page)).toBe('models/gemini-2.5-pro')
    await page.reload()
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-pro')
    await expect.poll(() => optionLabels(page)).toEqual(STABLE_LABELS)
  })

  test('a saved model missing from the full list shows the warning', async ({ page }) => {
    gemini.respond = listOf(REALISTIC_MODELS)
    await seedSettings(page, {
      geminiApiKey: FAKE_KEY,
      geminiModel: 'models/gemini-1.0-pro-vision',
    })
    await expect(modelAlert(page)).toHaveText(MISSING_MODEL)
    await expect(modelSelect(page)).toHaveValue('')
    await expect.poll(() => optionLabels(page)).toEqual(STABLE_LABELS)
    await page.waitForLoadState('networkidle')
    expect(await storedModel(page)).toBe('models/gemini-1.0-pro-vision')
  })

  test('a saved model without generateContent counts as missing', async ({ page }) => {
    gemini.respond = listOf(REALISTIC_MODELS)
    await seedSettings(page, {
      geminiApiKey: FAKE_KEY,
      geminiModel: 'models/gemini-embedding-001',
    })
    await expect(modelAlert(page)).toHaveText(MISSING_MODEL)
    await expect(modelSelect(page)).toHaveValue('')
    await expect.poll(() => optionLabels(page)).toEqual(STABLE_LABELS)
  })
})

// --- Phase 2 F8: auto-select the newest stable Flash -----------------------
// Only when no model is saved. Among shown stable Flash / Flash-Lite
// models: newest version first; same version Flash before Flash-Lite;
// unpinned before -NNN; higher -NNN; then API order. Otherwise the first
// name containing "flash"; otherwise nothing (請選擇模型).

test.describe('settings: default model choice', () => {
  const cases = [
    {
      title: 'newest version wins over API order',
      list: [
        model('models/gemini-2.0-flash-001', 'Gemini 2.0 Flash 001'),
        model('models/gemini-2.5-flash', 'Gemini 2.5 Flash'),
        model('models/gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'),
      ],
      pick: 'models/gemini-2.5-flash',
    },
    {
      title: 'a newer Flash-Lite beats an older Flash',
      list: [
        model('models/gemini-2.0-flash', 'Gemini 2.0 Flash'),
        model('models/gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'),
      ],
      pick: 'models/gemini-2.5-flash-lite',
    },
    {
      title: 'same version: Flash before Flash-Lite, unpinned before -NNN, then higher -NNN',
      list: [
        model('models/gemini-2.5-pro', 'Gemini 2.5 Pro'),
        model('models/gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'),
        model('models/gemini-2.5-flash-001', 'Gemini 2.5 Flash 001'),
        model('models/gemini-2.5-flash-002', 'Gemini 2.5 Flash 002'),
        model('models/gemini-2.5-flash', 'Gemini 2.5 Flash'),
      ],
      pick: 'models/gemini-2.5-flash',
    },
    {
      title: 'pinned revisions only: the higher -NNN',
      list: [
        model('models/gemini-2.5-flash-001', 'Gemini 2.5 Flash 001'),
        model('models/gemini-2.5-flash-002', 'Gemini 2.5 Flash 002'),
        model('models/gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'),
      ],
      pick: 'models/gemini-2.5-flash-002',
    },
    {
      title: 'major-only versions compare numerically (3 > 2.5, 10 > 9)',
      list: [
        model('models/gemini-2.5-flash', 'Gemini 2.5 Flash'),
        model('models/gemini-9-flash', 'Gemini 9 Flash'),
        model('models/gemini-10-flash', 'Gemini 10 Flash'),
        model('models/gemini-3-flash', 'Gemini 3 Flash'),
      ],
      pick: 'models/gemini-10-flash',
    },
    {
      title: 'previews only (fallback list): the first name containing flash',
      list: [
        model('models/gemini-3-pro-preview', 'Gemini 3 Pro Preview'),
        model('models/gemini-2.5-flash-preview-05-20', 'Gemini 2.5 Flash Preview'),
        model('models/gemini-3-flash-preview', 'Gemini 3 Flash Preview'),
      ],
      pick: 'models/gemini-2.5-flash-preview-05-20',
    },
  ]

  for (const { title, list, pick } of cases) {
    test(`no saved model: ${title}`, async ({ page }) => {
      gemini.respond = listOf(list)
      await openSettings(page)
      await saveKey(page)
      await expect(modelSelect(page)).toHaveValue(pick)
      await expect.poll(() => storedModel(page)).toBe(pick)
      // Options keep API order: every model here is shown (stable, or the
      // previews-only fallback list).
      await expect.poll(() => optionLabels(page)).toEqual(list.map((m) => m.displayName))
      await expect(modelAlert(page)).toHaveCount(0)
    })
  }

  test('no Flash at all: nothing is picked, 請選擇模型', async ({ page }) => {
    gemini.respond = listOf([
      model('models/gemini-2.5-pro', 'Gemini 2.5 Pro'),
      model('models/gemini-3-pro', 'Gemini 3 Pro'),
    ])
    await openSettings(page)
    await saveKey(page)
    await expect.poll(() => optionLabels(page)).toEqual(['Gemini 2.5 Pro', 'Gemini 3 Pro'])
    await expect(modelSelect(page)).toHaveValue('')
    await expect(modelSelect(page).locator('option:checked')).toHaveText('請選擇模型')
    await page.waitForLoadState('networkidle')
    expect((await storedModel(page)) ?? '').toBe('')
  })

  test('a saved model is never replaced by the default choice', async ({ page }) => {
    const list = [
      model('models/gemini-2.0-flash-001', 'Gemini 2.0 Flash 001'),
      model('models/gemini-2.5-pro', 'Gemini 2.5 Pro'),
      model('models/gemini-2.5-flash', 'Gemini 2.5 Flash'),
    ]
    gemini.respond = listOf(list)
    // An older Flash saved earlier stays selected.
    await seedSettings(page, { geminiApiKey: FAKE_KEY, geminiModel: 'models/gemini-2.0-flash-001' })
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.0-flash-001')
    await page.waitForLoadState('networkidle')
    expect(await storedModel(page)).toBe('models/gemini-2.0-flash-001')

    // So does a non-Flash choice, across saving the key again.
    await modelSelect(page).selectOption('models/gemini-2.5-pro')
    await expect(modelNotice(page)).toHaveText('已儲存')
    await saveKey(page)
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-pro')
    await page.reload()
    await expect(modelSelect(page)).toHaveValue('models/gemini-2.5-pro')
    await page.waitForLoadState('networkidle')
    expect(await storedModel(page)).toBe('models/gemini-2.5-pro')

    // A saved model missing from the list is not replaced either.
    await writeStore(page, 'settings', { geminiModel: 'models/gemini-1.0-pro' })
    await page.reload()
    await expect(modelAlert(page)).toHaveText(MISSING_MODEL)
    await expect(modelSelect(page)).toHaveValue('')
    await page.waitForLoadState('networkidle')
    expect(await storedModel(page)).toBe('models/gemini-1.0-pro')
  })
})
