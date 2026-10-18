import {
  GEMINI_ERROR_MESSAGES,
  GeminiError,
  REQUEST_TIMEOUT_MS,
  generateAnalysis,
  geminiErrorMessage,
  listModels,
  MODELS_URL,
} from './gemini.js'
import { ANALYSIS_RESPONSE_SCHEMA } from './analysis.js'
import { buildPrompt } from './prompt.js'

const KEY = 'test-key-123'

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function model(name, methods = ['generateContent'], displayName = undefined) {
  return { name, displayName, supportedGenerationMethods: methods }
}

describe('listModels', () => {
  it('sends the key only in the x-goog-api-key header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ models: [] }))
    await listModels(KEY, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url.startsWith(MODELS_URL)).toBe(true)
    expect(MODELS_URL).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(url).not.toContain(KEY)
    expect(new URL(url).searchParams.get('pageSize')).toBe('1000')
    expect(options.method).toBe('GET')
    expect(options.headers['x-goog-api-key']).toBe(KEY)
  })

  it('keeps only Gemini models that support generateContent, in API order', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        models: [
          model('models/gemini-2.5-pro', ['generateContent', 'countTokens'], 'Gemini 2.5 Pro'),
          model('models/gemini-embedding-001', ['embedContent'], 'Embedding'),
          model('models/gemma-3-27b-it', ['generateContent'], 'Gemma 3'),
          model('models/imagen-4.0', ['predict'], 'Imagen'),
          model('models/gemini-2.5-flash', ['generateContent'], 'Gemini 2.5 Flash'),
          { name: 'models/gemini-no-methods' },
        ],
      }),
    )
    expect(await listModels(KEY, { fetchImpl })).toEqual([
      { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    ])
  })

  it('returns an empty displayName when the API omits it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ models: [model('models/gemini-x')] }))
    expect(await listModels(KEY, { fetchImpl })).toEqual([
      { name: 'models/gemini-x', displayName: '' },
    ])
  })

  it('returns an empty list when the response has no models field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}))
    expect(await listModels(KEY, { fetchImpl })).toEqual([])
  })

  it('follows nextPageToken across pages', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ models: [model('models/gemini-a')], nextPageToken: 'p2' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ models: [model('models/gemini-b')], nextPageToken: 'p3' }),
      )
      .mockResolvedValueOnce(jsonResponse({ models: [model('models/gemini-c')] }))
    const result = await listModels(KEY, { fetchImpl })
    expect(result.map((m) => m.name)).toEqual([
      'models/gemini-a',
      'models/gemini-b',
      'models/gemini-c',
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.has('pageToken')).toBe(false)
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get('pageToken')).toBe('p2')
    expect(new URL(fetchImpl.mock.calls[2][0]).searchParams.get('pageToken')).toBe('p3')
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url).not.toContain(KEY)
      expect(options.headers['x-goog-api-key']).toBe(KEY)
    }
  })

  it('stops when the API repeats a page token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ models: [model('models/gemini-a')], nextPageToken: 'same' }))
    const result = await listModels(KEY, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.map((m) => m.name)).toEqual(['models/gemini-a', 'models/gemini-a'])
  })

  it('stops after a maximum number of pages', async () => {
    let page = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      page += 1
      return jsonResponse({ models: [], nextPageToken: `p${page}` })
    })
    await listModels(KEY, { fetchImpl })
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(20)
  })

  describe('errors', () => {
    async function codeOf(fetchImpl) {
      try {
        await listModels(KEY, { fetchImpl })
      } catch (error) {
        // The key must never leak into error messages.
        expect(String(error.message)).not.toContain(KEY)
        return error.code
      }
      throw new Error('expected listModels to reject')
    }

    it('maps a 400 API_KEY_INVALID response to invalidKey', async () => {
      const body = {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_INVALID' }],
        },
      }
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse(body, 400)))).toBe('invalidKey')
    })

    it('maps other 400 responses to other', async () => {
      const body = { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad' } }
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse(body, 400)))).toBe('other')
    })

    it('maps 401 and 403 to invalidKey', async () => {
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse({}, 401)))).toBe('invalidKey')
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse({}, 403)))).toBe('invalidKey')
    })

    it('maps a rejected fetch to network', async () => {
      expect(await codeOf(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).toBe(
        'network',
      )
    })

    it('maps server errors to other', async () => {
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse({}, 500)))).toBe('other')
    })

    it('maps 429 to quota (the settings page shows its generic text for it)', async () => {
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse({}, 429)))).toBe('quota')
    })

    it('maps an unreadable 400 body to other', async () => {
      const response = {
        ok: false,
        status: 400,
        text: async () => {
          throw new Error('stream failed')
        },
      }
      expect(await codeOf(vi.fn().mockResolvedValue(response))).toBe('other')
    })

    it('maps invalid JSON in a success response to other', async () => {
      const response = {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json')
        },
      }
      expect(await codeOf(vi.fn().mockResolvedValue(response))).toBe('other')
    })

    it('maps a malformed models field to other', async () => {
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse({ models: 'x' })))).toBe('other')
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse(null)))).toBe('other')
    })

    it('fails on a later page like on the first one', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ models: [model('models/gemini-a')], nextPageToken: 'p2' }),
        )
        .mockRejectedValueOnce(new TypeError('offline'))
      expect(await codeOf(fetchImpl)).toBe('network')
    })

    it('does not log anything', async () => {
      const spies = ['log', 'info', 'warn', 'error', 'debug'].map((n) => vi.spyOn(console, n))
      await codeOf(vi.fn().mockResolvedValue(jsonResponse({}, 403)))
      await listModels(KEY, {
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ models: [] })),
      })
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
      }
    })
  })
})

describe('generateAnalysis', () => {
  const MODEL = 'models/gemini-2.5-flash'
  const NOW = new Date('2026-10-18T09:00:00.000Z')
  const DIARY = '今日は学校に行きました。秘密の日記'
  const ENTRY = { id: 'e1', content: DIARY, language: '日文' }

  const ANALYSIS = {
    detectedLanguage: '日文',
    grammarErrors: [],
    unclearSentences: [],
    naturalExpressions: [{ original: '行きました', alternatives: ['行った'], explanation: '說明' }],
    correctedText: '今日は学校に行きました。',
    translation: '今天去了學校。',
  }

  function candidateResponse(parts, extra = {}) {
    return jsonResponse({ candidates: [{ content: { role: 'model', parts }, ...extra }] })
  }

  function okFetch(text = JSON.stringify(ANALYSIS)) {
    return vi.fn().mockResolvedValue(candidateResponse([{ text }]))
  }

  function run(fetchImpl, args = {}) {
    return generateAnalysis(
      { apiKey: KEY, model: MODEL, entry: ENTRY, ...args },
      { fetchImpl, now: NOW },
    )
  }

  // Runs and returns the error code, checking the error never carries
  // the key, the diary, the prompt or the response.
  async function codeOf(fetchImpl, args) {
    try {
      await run(fetchImpl, args)
    } catch (error) {
      expect(error).toBeInstanceOf(GeminiError)
      for (const secret of [KEY, DIARY, '你是一位外語寫作老師', '秘密']) {
        expect(error.message).not.toContain(secret)
      }
      return error.code
    }
    throw new Error('expected generateAnalysis to reject')
  }

  it('POSTs the prompt and the JSON schema to the model endpoint', async () => {
    const fetchImpl = okFetch()
    await run(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    )
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({
      'x-goog-api-key': KEY,
      'Content-Type': 'application/json',
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(options.body)).toEqual({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(ENTRY) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: JSON.parse(JSON.stringify(ANALYSIS_RESPONSE_SCHEMA)),
      },
    })
  })

  it('never puts the key in the URL or the body', async () => {
    const fetchImpl = okFetch()
    await run(fetchImpl)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).not.toContain(KEY)
    expect(options.body).not.toContain(KEY)
  })

  it('uses the entry content and language in the prompt', async () => {
    const fetchImpl = okFetch()
    await run(fetchImpl, { entry: { content: '  Hi $& ', language: 'auto' } })
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text
    expect(sent).toBe(buildPrompt({ content: '  Hi $& ', language: 'auto' }))
  })

  it('returns the validated analysis stamped with now', async () => {
    expect(await run(okFetch())).toEqual({ ...ANALYSIS, analyzedAt: NOW.toISOString() })
  })

  it('joins all text parts of the first candidate, skipping thoughts', async () => {
    const json = JSON.stringify(ANALYSIS)
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: 'thinking…', thought: true },
                { text: json.slice(0, 20) },
                { inlineData: {} },
                { text: json.slice(20) },
              ],
            },
          },
          { content: { parts: [{ text: 'second candidate' }] } },
        ],
      }),
    )
    expect(await run(fetchImpl)).toEqual({ ...ANALYSIS, analyzedAt: NOW.toISOString() })
  })

  it.each([
    ['no candidates (blocked prompt)', { promptFeedback: { blockReason: 'SAFETY' } }],
    ['an empty candidates list', { candidates: [] }],
    ['a candidate without content (safety stop)', { candidates: [{ finishReason: 'SAFETY' }] }],
    ['a candidate without parts', { candidates: [{ content: {} }] }],
    ['no text parts', { candidates: [{ content: { parts: [{ inlineData: {} }] } }] }],
    ['only empty text', { candidates: [{ content: { parts: [{ text: '' }] } }] }],
    ['null body', null],
  ])('maps %s to format', async (_label, body) => {
    expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse(body)))).toBe('format')
  })

  it('maps truncated JSON (MAX_TOKENS) to format', async () => {
    const text = JSON.stringify(ANALYSIS).slice(0, 50)
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(candidateResponse([{ text }], { finishReason: 'MAX_TOKENS' }))
    expect(await codeOf(fetchImpl)).toBe('format')
  })

  it('maps an invalid analysis to format', async () => {
    const text = JSON.stringify({ ...ANALYSIS, grammarErrors: 'none' })
    expect(await codeOf(okFetch(text))).toBe('format')
  })

  it('maps a non-JSON success body to format', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad')
      },
    }
    expect(await codeOf(vi.fn().mockResolvedValue(response))).toBe('format')
  })

  describe('HTTP errors', () => {
    const errorBody = (status, reason) => ({
      error: { code: 0, status, message: 'msg', details: reason ? [{ reason }] : [] },
    })

    it.each([
      ['400 API_KEY_INVALID', 400, errorBody('INVALID_ARGUMENT', 'API_KEY_INVALID'), 'invalidKey'],
      ['401', 401, {}, 'invalidKey'],
      ['403', 403, errorBody('PERMISSION_DENIED'), 'invalidKey'],
      ['429', 429, {}, 'quota'],
      ['RESOURCE_EXHAUSTED status', 400, errorBody('RESOURCE_EXHAUSTED'), 'quota'],
      ['404', 404, {}, 'modelUnavailable'],
      ['NOT_FOUND status', 400, errorBody('NOT_FOUND'), 'modelUnavailable'],
      ['other 400', 400, errorBody('INVALID_ARGUMENT'), 'other'],
      ['500', 500, errorBody('INTERNAL'), 'other'],
      ['503', 503, {}, 'other'],
    ])('maps %s to %s', async (_label, status, body, code) => {
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse(body, status)), undefined)).toBe(
        code,
      )
    })

    it('maps an unreadable error body by status', async () => {
      const response = (status) => ({
        ok: false,
        status,
        text: async () => {
          throw new Error('stream')
        },
      })
      expect(await codeOf(vi.fn().mockResolvedValue(response(429)))).toBe('quota')
      expect(await codeOf(vi.fn().mockResolvedValue(response(400)))).toBe('other')
    })

    it('maps a non-JSON error body by status', async () => {
      const response = { ok: false, status: 404, text: async () => '<html>Not Found</html>' }
      expect(await codeOf(vi.fn().mockResolvedValue(response))).toBe('modelUnavailable')
    })
  })

  it('never puts the model response text into the error message', async () => {
    const MARKER = 'RESPONSE-MARKER-7f3a'
    const cases = [
      // Non-JSON text in a 2xx response.
      okFetch(`Sorry, I cannot do that. ${MARKER}`),
      // Valid JSON, invalid analysis.
      okFetch(JSON.stringify({ ...ANALYSIS, grammarErrors: MARKER })),
      // Truncated JSON.
      okFetch(`{"detectedLanguage": "${MARKER}`),
      // Error body from the API.
      vi.fn().mockResolvedValue(jsonResponse({ error: { status: 'INTERNAL', message: MARKER } }, 500)),
    ]
    for (const fetchImpl of cases) {
      const error = await run(fetchImpl).catch((caught) => caught)
      expect(error).toBeInstanceOf(GeminiError)
      expect(error.message).not.toContain(MARKER)
      expect(String(error)).not.toContain(MARKER)
      expect(JSON.stringify(error)).not.toContain(MARKER)
    }
  })

  it('maps a rejected fetch to network', async () => {
    expect(await codeOf(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).toBe(
      'network',
    )
  })

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    // A fetch that never answers but honours the abort signal, like the
    // real one.
    function hangingFetch() {
      return vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      )
    }

    it('aborts after 120 seconds and reports network', async () => {
      expect(REQUEST_TIMEOUT_MS).toBe(120_000)
      const fetchImpl = hangingFetch()
      const result = run(fetchImpl).catch((error) => error)
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1)
      expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const error = await result
      expect(error.code).toBe('network')
      expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('also times out while reading a slow body', async () => {
      let signal
      const fetchImpl = vi.fn(async (_url, options) => {
        signal = options.signal
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              )
            }),
        }
      })
      const result = run(fetchImpl).catch((error) => error)
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
      expect((await result).code).toBe('network')
    })

    it('clears the timer after a response', async () => {
      await run(okFetch())
      expect(vi.getTimerCount()).toBe(0)
    })

    it('does not retry after a failure', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500))
      await expect(run(fetchImpl)).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
  })

  describe('settings checks', () => {
    it.each([[undefined], [''], ['   '], [42]])('rejects a missing key (%j) as noKey', async (apiKey) => {
      const fetchImpl = okFetch()
      expect(await codeOf(fetchImpl, { apiKey })).toBe('noKey')
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it.each([[undefined], [''], [null]])('rejects a missing model (%j) as noModel', async (model) => {
      const fetchImpl = okFetch()
      expect(await codeOf(fetchImpl, { model })).toBe('noModel')
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it.each([
      '../x',
      'x',
      'gemini-2.5-flash',
      'models/a?b',
      'models/a#b',
      'models/a/b',
      'models/../tunedModels/x',
      'models/a%2Fb',
      'models/',
      'models/a b',
      ' models/a',
      'models/a\n',
      'https://evil.example/models/a',
    ])('rejects the model name %j as modelUnavailable without a request', async (model) => {
      const fetchImpl = okFetch()
      expect(await codeOf(fetchImpl, { model })).toBe('modelUnavailable')
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it.each(['models/gemini-2.0-flash-001', 'models/gemini-exp_1.5', 'models/a'])(
      'accepts the model name %s',
      async (model) => {
        const fetchImpl = okFetch()
        await run(fetchImpl, { model })
        expect(fetchImpl.mock.calls[0][0]).toBe(
          `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`,
        )
      },
    )
  })

  it('does not log anything', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((n) => vi.spyOn(console, n))
    await run(okFetch())
    await codeOf(vi.fn().mockResolvedValue(jsonResponse({}, 500)))
    await codeOf(okFetch('not json'))
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })
})

describe('error messages', () => {
  it('maps every code to its Chinese message', () => {
    expect(GEMINI_ERROR_MESSAGES).toEqual({
      invalidKey: 'API key 無效，請到設定頁確認。',
      quota: '已達 Gemini 使用額度上限，請稍後再試。',
      network: '無法連線到 Gemini，請檢查網路後再試一次。',
      format: 'AI 回傳的格式不正確，請再試一次。',
      modelUnavailable: '所選的模型已無法使用，請到設定頁重新選擇。',
      other: '批改失敗，請稍後再試一次。',
      noKey: '請先到設定頁設定 Gemini API key。',
      noModel: '請先到設定頁選擇 Gemini 模型。',
    })
    expect(Object.isFrozen(GEMINI_ERROR_MESSAGES)).toBe(true)
    for (const [code, message] of Object.entries(GEMINI_ERROR_MESSAGES)) {
      expect(geminiErrorMessage(code)).toBe(message)
    }
  })

  it.each([[undefined], [null], ['unknown'], ['toString'], ['constructor'], ['__proto__']])(
    'falls back to the generic message for %j',
    (code) => {
      expect(geminiErrorMessage(code)).toBe('批改失敗，請稍後再試一次。')
    },
  )
})
