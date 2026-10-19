import {
  DRIVE_ORIGIN,
  DriveError,
  FILES_URL,
  REQUEST_TIMEOUT_MS,
  SYNC_FILE_NAME,
  UPLOAD_URL,
  createSyncFile,
  deleteSyncFile,
  downloadSyncFile,
  listSyncFiles,
  updateSyncFile,
} from './drive.js'

const TOKEN = 'ya29.secret-token-XYZ'
const CONTENT = '{"format":"nikki-ai-sync","secretDiary":"my private text"}'

function response({ status = 200, json, text } = {}) {
  const bodyText = text ?? (json === undefined ? '' : JSON.stringify(json))
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(bodyText),
    text: async () => bodyText,
  }
}

function errorBody(status, { reasons = [], details = [], grpcStatus } = {}) {
  return response({
    status,
    json: {
      error: {
        code: status,
        status: grpcStatus,
        errors: reasons.map((reason) => ({ reason })),
        details: details.map((reason) => ({ reason })),
      },
    },
  })
}

function okFetch(res = response({ json: {} })) {
  return vi.fn().mockResolvedValue(res)
}

// Asserts the token appears only in the Authorization header of a call.
function expectTokenOnlyInHeader([url, options]) {
  expect(url).not.toContain(TOKEN)
  expect(url.startsWith(`${DRIVE_ORIGIN}/`)).toBe(true)
  expect(new URL(url).origin).toBe('https://www.googleapis.com')
  expect(options.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  for (const [name, value] of Object.entries(options.headers)) {
    if (name !== 'Authorization') expect(value).not.toContain(TOKEN)
  }
  if (options.body !== undefined) expect(String(options.body)).not.toContain(TOKEN)
  expect(options.signal).toBeInstanceOf(AbortSignal)
}

async function errorOf(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('constants', () => {
  it('uses fixed Google endpoints and the app folder file name', () => {
    expect(FILES_URL).toBe('https://www.googleapis.com/drive/v3/files')
    expect(UPLOAD_URL).toBe('https://www.googleapis.com/upload/drive/v3/files')
    expect(SYNC_FILE_NAME).toBe('nikki-ai-sync.json')
  })
})

describe('listSyncFiles', () => {
  it('queries the app folder for the sync file with the token only in the header', async () => {
    const fetchImpl = okFetch(response({ json: { files: [] } }))
    expect(await listSyncFiles(TOKEN, { fetchImpl })).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const call = fetchImpl.mock.calls[0]
    expectTokenOnlyInHeader(call)
    const url = new URL(call[0])
    expect(`${url.origin}${url.pathname}`).toBe(FILES_URL)
    expect(url.searchParams.get('spaces')).toBe('appDataFolder')
    expect(url.searchParams.get('q')).toBe("name = 'nikki-ai-sync.json' and trashed = false")
    expect(url.searchParams.get('fields')).toBe(
      'nextPageToken,files(id,createdTime,modifiedTime)',
    )
    expect(url.searchParams.has('pageToken')).toBe(false)
    expect(call[1].method).toBe('GET')
    expect(call[1].body).toBeUndefined()
  })

  it('follows pageToken and returns all files oldest first', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          json: {
            nextPageToken: 'page-2',
            files: [
              { id: 'b', createdTime: '2026-10-03T00:00:00.000Z', modifiedTime: 'm-b' },
              { id: 'a', createdTime: '2026-10-01T00:00:00.000Z', modifiedTime: 'm-a' },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          json: { files: [{ id: 'c', createdTime: '2026-10-02T00:00:00.000Z', modifiedTime: 'm-c' }] },
        }),
      )
    const files = await listSyncFiles(TOKEN, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get('pageToken')).toBe('page-2')
    expectTokenOnlyInHeader(fetchImpl.mock.calls[1])
    expect(files).toEqual([
      { id: 'a', createdTime: '2026-10-01T00:00:00.000Z', modifiedTime: 'm-a' },
      { id: 'c', createdTime: '2026-10-02T00:00:00.000Z', modifiedTime: 'm-c' },
      { id: 'b', createdTime: '2026-10-03T00:00:00.000Z', modifiedTime: 'm-b' },
    ])
  })

  it('orders ties by id and puts unparsable times last', async () => {
    const t = '2026-10-01T00:00:00.000Z'
    const fetchImpl = okFetch(
      response({
        json: {
          files: [
            { id: 'z', createdTime: 'garbage' },
            { id: 'y', createdTime: t },
            { id: 'x', createdTime: t },
          ],
        },
      }),
    )
    expect((await listSyncFiles(TOKEN, { fetchImpl })).map((f) => f.id)).toEqual(['x', 'y', 'z'])
  })

  it('skips entries with a missing or unsafe id', async () => {
    const fetchImpl = okFetch(
      response({
        json: {
          files: [
            { id: '../evil', createdTime: '2026-10-01T00:00:00Z' },
            { createdTime: '2026-10-01T00:00:00Z' },
            null,
            { id: 'good_ID-1', createdTime: '2026-10-01T00:00:00Z' },
          ],
        },
      }),
    )
    expect(await listSyncFiles(TOKEN, { fetchImpl })).toEqual([
      { id: 'good_ID-1', createdTime: '2026-10-01T00:00:00Z', modifiedTime: '' },
    ])
  })

  it('stops on a repeated page token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ json: { nextPageToken: 'same', files: [] } }),
    )
    await listSyncFiles(TOKEN, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops after 20 pages even with endless distinct page tokens', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => {
      n += 1
      return response({
        json: { nextPageToken: `page-${n}`, files: [{ id: `f${n}`, createdTime: '2026-10-01T00:00:00Z' }] },
      })
    })
    const files = await listSyncFiles(TOKEN, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(20)
    expect(files).toHaveLength(20)
  })

  it('rejects a body that is not a file list', async () => {
    expect((await errorOf(listSyncFiles(TOKEN, { fetchImpl: okFetch(response({ text: 'nope' })) }))).code).toBe('other')
    expect((await errorOf(listSyncFiles(TOKEN, { fetchImpl: okFetch(response({ json: { files: 'x' } })) }))).code).toBe('other')
  })

  it('rejects a missing token without a request', async () => {
    const fetchImpl = okFetch()
    for (const token of ['', undefined, null, 42]) {
      expect((await errorOf(listSyncFiles(token, { fetchImpl }))).code).toBe('auth')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('downloadSyncFile', () => {
  it('fetches the content with alt=media and returns the text', async () => {
    const fetchImpl = okFetch(response({ text: CONTENT }))
    expect(await downloadSyncFile(TOKEN, 'file_1-A', { fetchImpl })).toBe(CONTENT)
    const call = fetchImpl.mock.calls[0]
    expectTokenOnlyInHeader(call)
    expect(call[0]).toBe(`${FILES_URL}/file_1-A?alt=media`)
    expect(call[1].method).toBe('GET')
  })

  it('returns an empty file as an empty string', async () => {
    expect(await downloadSyncFile(TOKEN, 'id1', { fetchImpl: okFetch(response({ text: '' })) })).toBe('')
  })
})

describe('createSyncFile', () => {
  it('uploads metadata and content as multipart/related and returns the id', async () => {
    const fetchImpl = okFetch(response({ json: { id: 'new_ID-9' } }))
    expect(await createSyncFile(TOKEN, CONTENT, { fetchImpl })).toBe('new_ID-9')
    const call = fetchImpl.mock.calls[0]
    expectTokenOnlyInHeader(call)
    const [url, options] = call
    expect(url).toBe(`${UPLOAD_URL}?uploadType=multipart&fields=id`)
    expect(options.method).toBe('POST')

    const match = /^multipart\/related; boundary=(.+)$/.exec(options.headers['Content-Type'])
    expect(match).not.toBeNull()
    const boundary = match[1]
    expect(CONTENT).not.toContain(boundary)

    const body = options.body
    expect(body.endsWith(`\r\n--${boundary}--`)).toBe(true)
    const parts = body.slice(0, -`\r\n--${boundary}--`.length).split(`--${boundary}\r\n`)
    expect(parts[0]).toBe('')
    expect(parts).toHaveLength(3)
    const [metaHead, meta] = parts[1].split('\r\n\r\n')
    expect(metaHead).toBe('Content-Type: application/json; charset=UTF-8')
    expect(JSON.parse(meta)).toEqual({ name: 'nikki-ai-sync.json', parents: ['appDataFolder'] })
    const [mediaHead, media] = parts[2].split('\r\n\r\n')
    expect(mediaHead).toBe('Content-Type: application/json; charset=UTF-8')
    expect(media).toBe(CONTENT)
  })

  it('uses a different boundary on each call', async () => {
    const fetchImpl = okFetch(response({ json: { id: 'id1' } }))
    await createSyncFile(TOKEN, CONTENT, { fetchImpl })
    await createSyncFile(TOKEN, CONTENT, { fetchImpl })
    const [a, b] = fetchImpl.mock.calls.map((c) => c[1].headers['Content-Type'])
    expect(a).not.toBe(b)
  })

  it('rejects a response without a safe id', async () => {
    for (const json of [{}, { id: 'a/b' }, { id: 7 }]) {
      const error = await errorOf(createSyncFile(TOKEN, CONTENT, { fetchImpl: okFetch(response({ json })) }))
      expect(error.code).toBe('other')
    }
  })

  it('rejects a 2xx response whose body is not JSON', async () => {
    const fetchImpl = okFetch(response({ text: 'not json' }))
    expect((await errorOf(createSyncFile(TOKEN, CONTENT, { fetchImpl }))).code).toBe('other')
  })

  it('rejects non-string content without a request', async () => {
    const fetchImpl = okFetch()
    expect((await errorOf(createSyncFile(TOKEN, { a: 1 }, { fetchImpl }))).code).toBe('other')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('updateSyncFile', () => {
  it('PATCHes the media upload endpoint with the JSON text', async () => {
    const fetchImpl = okFetch(response({ json: { id: 'id1' } }))
    expect(await updateSyncFile(TOKEN, 'id1', CONTENT, { fetchImpl })).toBeUndefined()
    const call = fetchImpl.mock.calls[0]
    expectTokenOnlyInHeader(call)
    expect(call[0]).toBe(`${UPLOAD_URL}/id1?uploadType=media&fields=id`)
    expect(call[1].method).toBe('PATCH')
    expect(call[1].headers['Content-Type']).toBe('application/json; charset=UTF-8')
    expect(call[1].body).toBe(CONTENT)
  })

  it('rejects non-string content without a request', async () => {
    const fetchImpl = okFetch()
    expect((await errorOf(updateSyncFile(TOKEN, 'id1', undefined, { fetchImpl }))).code).toBe('other')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('deleteSyncFile', () => {
  it('sends DELETE for the file', async () => {
    const fetchImpl = okFetch(response({ status: 204 }))
    expect(await deleteSyncFile(TOKEN, 'id1', { fetchImpl })).toBeUndefined()
    const call = fetchImpl.mock.calls[0]
    expectTokenOnlyInHeader(call)
    expect(call[0]).toBe(`${FILES_URL}/id1`)
    expect(call[1].method).toBe('DELETE')
    expect(call[1].body).toBeUndefined()
  })
})

describe('file id validation', () => {
  const badIds = ['', '../x', 'a/b', 'a?b', 'a#b', 'a%2F', 'a b', '@evil.com', 'a.b', undefined, null, 5]
  const ops = {
    downloadSyncFile: (id, opts) => downloadSyncFile(TOKEN, id, opts),
    updateSyncFile: (id, opts) => updateSyncFile(TOKEN, id, CONTENT, opts),
    deleteSyncFile: (id, opts) => deleteSyncFile(TOKEN, id, opts),
  }

  for (const [name, op] of Object.entries(ops)) {
    it(`${name} rejects an invalid id without a request`, async () => {
      const fetchImpl = okFetch()
      for (const id of badIds) {
        const error = await errorOf(op(id, { fetchImpl }))
        expect(error).toBeInstanceOf(DriveError)
        expect(error.code).toBe('other')
      }
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it(`${name} rejects a missing token without a request`, async () => {
      const fetchImpl = okFetch()
      const call =
        name === 'downloadSyncFile'
          ? downloadSyncFile('', 'id1', { fetchImpl })
          : name === 'updateSyncFile'
            ? updateSyncFile('', 'id1', CONTENT, { fetchImpl })
            : deleteSyncFile('', 'id1', { fetchImpl })
      expect((await errorOf(call)).code).toBe('auth')
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  }

  it('createSyncFile rejects a missing token without a request', async () => {
    const fetchImpl = okFetch()
    expect((await errorOf(createSyncFile('', CONTENT, { fetchImpl }))).code).toBe('auth')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('error mapping', () => {
  const cases = [
    ['401', errorBody(401), 'auth'],
    ['403 insufficientPermissions', errorBody(403, { reasons: ['insufficientPermissions'] }), 'auth'],
    ['403 authError', errorBody(403, { reasons: ['authError'] }), 'auth'],
    ['403 scope insufficient (details)', errorBody(403, { details: ['ACCESS_TOKEN_SCOPE_INSUFFICIENT'], grpcStatus: 'PERMISSION_DENIED' }), 'auth'],
    ['403 userRateLimitExceeded', errorBody(403, { reasons: ['userRateLimitExceeded'] }), 'quota'],
    ['403 rateLimitExceeded', errorBody(403, { reasons: ['rateLimitExceeded'] }), 'quota'],
    ['403 dailyLimitExceeded', errorBody(403, { reasons: ['dailyLimitExceeded'] }), 'quota'],
    ['403 RESOURCE_EXHAUSTED', errorBody(403, { grpcStatus: 'RESOURCE_EXHAUSTED' }), 'quota'],
    ['403 storageQuotaExceeded', errorBody(403, { reasons: ['storageQuotaExceeded'] }), 'other'],
    ['403 unknown reason', errorBody(403, { reasons: ['appNotAuthorizedToFile'] }), 'other'],
    ['403 non-JSON body', response({ status: 403, text: '<html>' }), 'other'],
    ['429', errorBody(429), 'quota'],
    ['404', errorBody(404), 'notFound'],
    ['500', errorBody(500), 'other'],
    ['400', errorBody(400), 'other'],
  ]

  for (const [label, res, code] of cases) {
    it(`maps ${label} to ${code} for every call`, async () => {
      const calls = [
        (f) => listSyncFiles(TOKEN, { fetchImpl: f }),
        (f) => downloadSyncFile(TOKEN, 'id1', { fetchImpl: f }),
        (f) => createSyncFile(TOKEN, CONTENT, { fetchImpl: f }),
        (f) => updateSyncFile(TOKEN, 'id1', CONTENT, { fetchImpl: f }),
        (f) => deleteSyncFile(TOKEN, 'id1', { fetchImpl: f }),
      ]
      for (const run of calls) {
        const error = await errorOf(run(okFetch(res)))
        expect(error).toBeInstanceOf(DriveError)
        expect(error.code).toBe(code)
      }
    })
  }

  it('maps a rejected fetch to network for every call', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await errorOf(listSyncFiles(TOKEN, { fetchImpl }))).code).toBe('network')
    expect((await errorOf(downloadSyncFile(TOKEN, 'id1', { fetchImpl }))).code).toBe('network')
    expect((await errorOf(createSyncFile(TOKEN, CONTENT, { fetchImpl }))).code).toBe('network')
    expect((await errorOf(updateSyncFile(TOKEN, 'id1', CONTENT, { fetchImpl }))).code).toBe('network')
    expect((await errorOf(deleteSyncFile(TOKEN, 'id1', { fetchImpl }))).code).toBe('network')
    expect(fetchImpl).toHaveBeenCalledTimes(5)
  })

  it('never puts the token, file id or content in the error', async () => {
    const res = response({ status: 403, text: `${TOKEN} ${CONTENT}` })
    for (const error of [
      await errorOf(updateSyncFile(TOKEN, 'id1', CONTENT, { fetchImpl: okFetch(res) })),
      await errorOf(listSyncFiles(TOKEN, { fetchImpl: vi.fn().mockRejectedValue(new Error(TOKEN)) })),
    ]) {
      expect(error.message).not.toContain(TOKEN)
      expect(error.message).not.toContain('secretDiary')
      expect(error.message).not.toContain('id1')
      expect(error.cause).toBeUndefined()
      expect(JSON.stringify(error)).not.toContain(TOKEN)
    }
  })

  it('does not log anything', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((n) => vi.spyOn(console, n))
    await errorOf(listSyncFiles(TOKEN, { fetchImpl: okFetch(errorBody(500)) }))
    await errorOf(downloadSyncFile(TOKEN, 'id1', { fetchImpl: vi.fn().mockRejectedValue(new Error('x')) }))
    await createSyncFile(TOKEN, CONTENT, { fetchImpl: okFetch(response({ json: { id: 'a' } })) })
    await updateSyncFile(TOKEN, 'a', CONTENT, { fetchImpl: okFetch() })
    await deleteSyncFile(TOKEN, 'a', { fetchImpl: okFetch(response({ status: 204 })) })
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })
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
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
  }

  it('aborts after 60 seconds and reports network', async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(60_000)
    const fetchImpl = hangingFetch()
    const pending = errorOf(downloadSyncFile(TOKEN, 'id1', { fetchImpl }))
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1)
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await pending).code).toBe('network')
  })

  it('covers reading the body too', async () => {
    const fetchImpl = vi.fn((_url, { signal }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      }),
    )
    const pending = errorOf(downloadSyncFile(TOKEN, 'id1', { fetchImpl }))
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    expect((await pending).code).toBe('network')
  })

  it('reports network when the timeout hits while reading an error body', async () => {
    const fetchImpl = vi.fn((_url, { signal }) =>
      Promise.resolve({
        ok: false,
        status: 403,
        text: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      }),
    )
    const pending = errorOf(updateSyncFile(TOKEN, 'id1', CONTENT, { fetchImpl }))
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    expect((await pending).code).toBe('network')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer after an error response', async () => {
    await errorOf(listSyncFiles(TOKEN, { fetchImpl: okFetch(errorBody(500)) }))
    await errorOf(deleteSyncFile(TOKEN, 'id1', { fetchImpl: okFetch(errorBody(404)) }))
    await errorOf(downloadSyncFile(TOKEN, 'id1', { fetchImpl: vi.fn().mockRejectedValue(new TypeError('x')) }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer after a timeout', async () => {
    const pending = errorOf(downloadSyncFile(TOKEN, 'id1', { fetchImpl: hangingFetch() }))
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    expect((await pending).code).toBe('network')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer after a successful request', async () => {
    await listSyncFiles(TOKEN, { fetchImpl: okFetch(response({ json: { files: [] } })) })
    expect(vi.getTimerCount()).toBe(0)
  })
})
