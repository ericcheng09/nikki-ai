import { listModels, MODELS_URL } from './gemini.js'

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
      expect(await codeOf(vi.fn().mockResolvedValue(jsonResponse({}, 429)))).toBe('other')
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
