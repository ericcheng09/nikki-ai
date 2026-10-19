import { test as base, expect } from '@playwright/test'

// Shared E2E helpers. Specs import `test` and `expect` from here (not from
// @playwright/test) so the external-request guard below always applies.

// --- External request guard -------------------------------------------------
// E2E must never reach the real Gemini API or any other external service
// (CLAUDE.md). Every non-localhost request is aborted and recorded; the test
// fails in teardown if any was made. installGeminiMock() layers mocked
// Gemini responses on top (page routes take precedence over context routes).

async function guardContext(context, blocked) {
  await context.route(
    (url) => url.hostname !== 'localhost',
    (route) => {
      const request = route.request()
      blocked.push(`${request.method()} ${request.url()}`)
      return route.abort('blockedbyclient')
    },
  )
  // The settings page preloads the Google Identity Services script. By
  // default it is answered locally with an empty script (never reaching
  // Google), so GIS is simply unavailable. Specs that need a working GIS
  // define window.google.accounts.oauth2 with page.addInitScript; the app
  // then adds no script at all. Registered after the guard, so it is
  // matched first (Playwright tries the most recent route first).
  await context.route(GIS_SCRIPT_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  )
}

// Google Identity Services script URL (src/lib/googleAuth.js).
export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

export const test = base.extend({
  // Unmocked external requests from all guarded contexts of the test.
  externalRequests: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const blocked = []
      await use(blocked)
      expect(blocked, 'unmocked external requests').toEqual([])
    },
    { auto: true },
  ],
  context: async ({ context, externalRequests }, use) => {
    await guardContext(context, externalRequests)
    await use(context)
  },
  // Use instead of browser.newContext(): same options, guarded the same way.
  newContext: async ({ browser, externalRequests }, use) => {
    await use(async (options) => {
      const context = await browser.newContext(options)
      await guardContext(context, externalRequests)
      return context
    })
  },
})

export { expect }

export const HOME_URL = /\/nikki-ai\/$/
export const WELCOME_URL = /\/nikki-ai\/welcome$/

// First visit in a fresh browser context: the home page must redirect to
// the welcome page (spec 3.5); pressing 開始使用 returns to the home page.
// Tests about regular diary entries start with this. It fails if the
// redirect does not happen, so it never hides a broken first-use flow.
export async function startApp(page) {
  await page.goto('./')
  await expect(page).toHaveURL(WELCOME_URL)
  await page.getByRole('button', { name: '開始使用' }).click()
  await expect(page).toHaveURL(HOME_URL)
  await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
}

// Top bar on every page (decisions.md 畫面): 「←」 返回 on settings and
// entry pages, the app name in the middle, 設定 (gear) and 使用說明 (?) on
// the right, or only 開始使用 on the welcome page.
export const topBar = (page) => page.getByRole('banner')
export const backButton = (page) => topBar(page).getByRole('button', { name: '返回', exact: true })
export const settingsIcon = (page) => topBar(page).getByRole('link', { name: '設定', exact: true })
export const guideIcon = (page) => topBar(page).getByRole('link', { name: '使用說明', exact: true })

// Reads every record of an IndexedDB object store of the app, as stored.
// For the out-of-line-keyed "settings" store, returns { key: value }.
export async function readStore(page, storeName) {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('nikki-ai')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const store = db.transaction(name, 'readonly').objectStore(name)
          const values = store.getAll()
          const keys = store.getAllKeys()
          keys.onsuccess = () => {
            db.close()
            if (store.keyPath) {
              resolve(values.result)
            } else {
              resolve(Object.fromEntries(keys.result.map((k, i) => [k, values.result[i]])))
            }
          }
          keys.onerror = () => reject(keys.error)
        }
      }),
    storeName,
  )
}

// Writes records into an IndexedDB object store of the app (the database
// must already exist, e.g. after startApp()). For the out-of-line-keyed
// "settings" store pass { key: value }; otherwise an array of records.
// Reload or navigate afterwards so the app reads the new data.
export async function writeStore(page, storeName, data) {
  await page.evaluate(
    ({ name, data }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('nikki-ai')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(name, 'readwrite')
          const store = tx.objectStore(name)
          if (store.keyPath) {
            for (const record of data) store.put(record)
          } else {
            for (const [key, value] of Object.entries(data)) store.put(value, key)
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    { name: storeName, data },
  )
}

// --- Gemini API mock -------------------------------------------------------
// installGeminiMock() answers:
// - GET  .../v1beta/models (list):  `mock.respond(route, callNumber)`,
//   recorded in `mock.modelRequests` ({ url, headers })
// - POST .../v1beta/models/<id>:generateContent: `mock.generate(route,
//   callNumber)`, recorded in `mock.generateRequests` ({ url, headers, body })
// Both handlers are replaceable per test. Any other external request falls
// back to the guard above, which aborts it and fails the test.

export const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const GENERATE_PATH = /^\/v1beta\/models\/[^/]+:generateContent$/

// A complete, valid analysis as the model would return it (no analyzedAt).
export const MOCK_ANALYSIS = {
  detectedLanguage: '日文',
  grammarErrors: [
    { original: 'カフェを行きました', corrected: 'カフェに行きました', explanation: '移動的目的地用「に」。' },
  ],
  unclearSentences: [
    { original: '明日も早く起きるつもりです、でも少し疲れました。', suggestion: '少し疲れましたが、明日も早く起きるつもりです。', explanation: '用「が」連接比較自然。' },
  ],
  naturalExpressions: [
    { original: 'ケーキを二つ食べました', alternatives: ['ケーキを二つも食べちゃった', 'ケーキを二つ平らげた'], explanation: '口語更自然。' },
  ],
  correctedText: '今日は友達とカフェ**に**行きました。',
  translation: '今天和朋友去了咖啡店。',
}

// generateContent response body carrying `text` as the model output.
export function generateBody(text) {
  return { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }
}

// A typical models list: includes entries the app must filter out.
export const MOCK_MODELS = [
  { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-embedding-001', displayName: 'Gemini Embedding 001', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemma-3-27b-it', displayName: 'Gemma 3 27B', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/imagen-4.0-generate-001', displayName: 'Imagen 4', supportedGenerationMethods: ['predict'] },
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.0-flash-lite', displayName: 'Gemini 2.0 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
]

// Fulfills a mocked Gemini request with JSON (CORS-enabled, like the real API).
export function fulfillJson(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  })
}

export async function installGeminiMock(page, respond = (route) => fulfillJson(route, { models: MOCK_MODELS })) {
  const mock = {
    respond,
    generate: (route) => fulfillJson(route, generateBody(JSON.stringify(MOCK_ANALYSIS))),
    modelRequests: [],
    generateRequests: [],
  }
  await page.route(
    (url) => url.hostname !== 'localhost',
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (`${url.origin}${url.pathname}` === GEMINI_MODELS_URL && request.method() === 'GET') {
        mock.modelRequests.push({ url: request.url(), headers: await request.allHeaders() })
        return mock.respond(route, mock.modelRequests.length)
      }
      if (url.origin === new URL(GEMINI_MODELS_URL).origin && GENERATE_PATH.test(url.pathname)) {
        if (request.method() === 'POST') {
          mock.generateRequests.push({
            url: request.url(),
            headers: await request.allHeaders(),
            body: request.postDataJSON(),
          })
          return mock.generate(route, mock.generateRequests.length)
        }
      }
      return route.fallback()
    },
  )
  return mock
}

// --- Google Identity Services stub ----------------------------------------------
// installGisStub() defines window.google.accounts.oauth2 before the app
// loads, so the app uses it and adds no GIS script. window.__gis.mode
// decides how each token request ends:
//   'ok'      a token (window.__gis.token, by default GOOGLE_TOKEN)
//   'closed'  popup closed            'failed'  popup blocked
//   'denied'  error response          'noScope' Drive permission unticked
//   'hold'    no answer until window.__gisAnswer(index, 'ok' | 'fail')
// Calls are recorded in window.__gis (inits, requests [{ prompt }], revoked).
// Works on a page or a whole browser context (both have addInitScript).

export const GOOGLE_TOKEN = 'ya29.E2E-SECRET-TOKEN-0123456789'

export function installGisStub(target, { token = GOOGLE_TOKEN, mode = 'ok' } = {}) {
  return target.addInitScript(
    ({ accessToken, initialMode }) => {
      const gis = { mode: initialMode, token: accessToken, inits: [], requests: [], revoked: [], held: [] }
      window.__gis = gis
      const grant = (config) =>
        config.callback({ access_token: gis.token, expires_in: 3599, scope: config.scope, token_type: 'Bearer' })
      window.__gisAnswer = (index, outcome) => {
        const { config } = gis.held[index]
        if (outcome === 'ok') grant(config)
        else config.error_callback?.({ type: 'popup_closed' })
      }
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient(config) {
              gis.inits.push({ client_id: config.client_id, scope: config.scope })
              return {
                requestAccessToken(options = {}) {
                  gis.requests.push({ prompt: options.prompt })
                  const current = gis.mode
                  if (current === 'hold') {
                    gis.held.push({ config, prompt: options.prompt })
                    return
                  }
                  setTimeout(() => {
                    if (current === 'ok') grant(config)
                    else if (current === 'noScope') {
                      config.callback({ access_token: gis.token, expires_in: 3599, scope: 'openid', token_type: 'Bearer' })
                    } else if (current === 'denied') config.callback({ error: 'access_denied' })
                    else if (current === 'closed') config.error_callback?.({ type: 'popup_closed' })
                    else if (current === 'failed') config.error_callback?.({ type: 'popup_failed_to_open' })
                  }, 50)
                },
              }
            },
            hasGrantedAllScopes(response, ...scopes) {
              const granted = String(response?.scope ?? '').split(' ')
              return scopes.every((s) => granted.includes(s))
            },
            revoke(token, done) {
              gis.revoked.push(token)
              setTimeout(() => done?.({ successful: true }), 10)
            },
          },
        },
      }
    },
    { accessToken: token, initialMode: mode },
  )
}

// GIS calls recorded by the stub (without the held callbacks).
export const gisCalls = (page) =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__gis, (k, v) => (k === 'config' ? undefined : v))))
export const setGisMode = (page, mode) => page.evaluate((m) => (window.__gis.mode = m), mode)

// googleAuth record for a signed-in browser (settings store, key
// googleAuth), with a token valid for about an hour.
export function signedInAuth(token = GOOGLE_TOKEN) {
  return { enabled: true, accessToken: token, expiresAt: Date.now() + 60 * 60 * 1000, needsLogin: false }
}

// --- Fake Google Drive -------------------------------------------------------------
// An in-memory Drive app-data folder answering the requests of
// src/lib/drive.js on https://www.googleapis.com. One fake can be attached
// to several browser contexts (two devices sharing one Drive). Requests
// without a valid Bearer token get 401. Nothing reaches Google.
//
//   drive.seed(content, { id, createdTime })   add a file (object or raw text)
//   drive.files                                Map id -> { id, name, createdTime, modifiedTime, content }
//   drive.file(id?) / drive.json(id?)          a file (default: the only one) / its parsed content
//   drive.requests                             [{ kind, method, fileId, token, url, body, at }]
//                                              kind: list | get | create | update | delete | unknown
//   drive.count(kind)                          number of recorded requests of that kind
//   drive.fail(kind, failure, times = 1)       next `times` matching requests fail ('any' matches all;
//                                              times Infinity = always). failure: 'auth' (401),
//                                              'quota' (403 rateLimitExceeded), 'quota429', 'server'
//                                              (500), 'abort' (network error), 'notFound' (404)
//   drive.clearFailures()
//   drive.hold() -> release()                  requests wait until release() is called
//   drive.validTokens                          Set of accepted tokens

export const DRIVE_FILE_NAME = 'nikki-ai-sync.json'

export function syncFile({ entries = [], customLanguages = [], settings = {} } = {}) {
  return { format: 'nikki-ai-sync', version: 1, entries, customLanguages, settings }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

function driveFailureResponse(failure) {
  const json = (status, body) => ({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) })
  switch (failure) {
    case 'auth':
      return json(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } })
    case 'quota':
      return json(403, { error: { code: 403, message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } })
    case 'quota429':
      return json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } })
    case 'notFound':
      return json(404, { error: { code: 404, message: 'File not found' } })
    case 'server':
    default:
      return json(500, { error: { code: 500, message: 'Backend Error' } })
  }
}

export function createFakeDrive({ validTokens = [GOOGLE_TOKEN] } = {}) {
  let nextId = 1
  let clock = Date.parse('2026-01-01T00:00:00.000Z')
  const stamp = () => {
    // Monotonic, so createdTime order is the creation order.
    clock = Math.max(clock + 1000, Date.now())
    return new Date(clock).toISOString()
  }
  let holdPromise = null
  const failures = []

  const drive = {
    files: new Map(),
    requests: [],
    validTokens: new Set(validTokens),

    seed(content, { id, createdTime } = {}) {
      const fileId = id ?? `seed${nextId++}`
      const time = createdTime ?? stamp()
      drive.files.set(fileId, {
        id: fileId,
        name: DRIVE_FILE_NAME,
        createdTime: time,
        modifiedTime: time,
        content: typeof content === 'string' ? content : JSON.stringify(content),
      })
      return fileId
    },
    file(id) {
      if (id) return drive.files.get(id)
      if (drive.files.size !== 1) throw new Error(`expected one Drive file, found ${drive.files.size}`)
      return [...drive.files.values()][0]
    },
    json(id) {
      return JSON.parse(drive.file(id).content)
    },
    count(kind) {
      return drive.requests.filter((r) => kind === undefined || r.kind === kind).length
    },
    fail(kind, failure, times = 1) {
      failures.push({ kind, failure, times })
    },
    clearFailures() {
      failures.length = 0
    },
    hold() {
      let release
      holdPromise = new Promise((resolve) => {
        release = resolve
      })
      return () => {
        holdPromise = null
        release()
      }
    },

    async attach(target) {
      await target.route(
        (url) => url.origin === 'https://www.googleapis.com' && /^\/(upload\/)?drive\/v3\/files/.test(url.pathname),
        (route) => handle(route),
      )
    },
  }

  function classify(method, url) {
    const upload = url.pathname.startsWith('/upload/')
    const match = /^\/(?:upload\/)?drive\/v3\/files(?:\/([^/]+))?$/.exec(url.pathname)
    const fileId = match?.[1] ?? null
    if (!match) return { kind: 'unknown', fileId }
    if (!upload && !fileId && method === 'GET') return { kind: 'list', fileId }
    if (!upload && fileId && method === 'GET' && url.searchParams.get('alt') === 'media') return { kind: 'get', fileId }
    if (upload && !fileId && method === 'POST' && url.searchParams.get('uploadType') === 'multipart') {
      return { kind: 'create', fileId }
    }
    if (upload && fileId && method === 'PATCH' && url.searchParams.get('uploadType') === 'media') {
      return { kind: 'update', fileId }
    }
    if (!upload && fileId && method === 'DELETE') return { kind: 'delete', fileId }
    return { kind: 'unknown', fileId }
  }

  function takeFailure(kind) {
    const index = failures.findIndex((f) => f.kind === kind || f.kind === 'any')
    if (index === -1) return null
    const entry = failures[index]
    entry.times -= 1
    if (entry.times <= 0) failures.splice(index, 1)
    return entry.failure
  }

  // Splits a multipart/related body into its parts' bodies.
  function multipartParts(body, contentType) {
    const boundary = /boundary=([^;]+)/.exec(contentType ?? '')?.[1]
    if (!boundary) return []
    return body
      .split(`--${boundary}`)
      .slice(1, -1)
      .map((part) => {
        const start = part.indexOf('\r\n\r\n')
        return part.slice(start + 4).replace(/\r\n$/, '')
      })
  }

  async function handle(route) {
    const request = route.request()
    const method = request.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(request.url())
    const headers = await request.allHeaders()
    const token = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1] ?? null
    const { kind, fileId } = classify(method, url)
    const body = request.postData() ?? ''
    drive.requests.push({ kind, method, fileId, token, url: request.url(), body, at: Date.now() })

    if (holdPromise) await holdPromise
    const json = (status, data) =>
      route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(data) })

    if (!token || !drive.validTokens.has(token)) return route.fulfill(driveFailureResponse('auth'))
    const failure = takeFailure(kind)
    if (failure === 'abort') return route.abort('failed')
    if (failure) return route.fulfill(driveFailureResponse(failure))

    switch (kind) {
      case 'list': {
        if (url.searchParams.get('spaces') !== 'appDataFolder') return json(400, { error: { code: 400 } })
        const q = url.searchParams.get('q') ?? ''
        const files = [...drive.files.values()]
          .filter((f) => q.includes(`name = '${f.name}'`))
          .map(({ id, createdTime, modifiedTime }) => ({ id, createdTime, modifiedTime }))
        return json(200, { files })
      }
      case 'get': {
        const file = drive.files.get(fileId)
        if (!file) return route.fulfill(driveFailureResponse('notFound'))
        return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: file.content })
      }
      case 'create': {
        const [metadataText, content] = multipartParts(body, headers['content-type'])
        const metadata = JSON.parse(metadataText ?? '{}')
        const id = `file${nextId++}`
        const time = stamp()
        drive.files.set(id, {
          id,
          name: metadata.name,
          parents: metadata.parents,
          createdTime: time,
          modifiedTime: time,
          content: content ?? '',
        })
        return json(200, { id })
      }
      case 'update': {
        const file = drive.files.get(fileId)
        if (!file) return route.fulfill(driveFailureResponse('notFound'))
        file.content = body
        file.modifiedTime = stamp()
        return json(200, { id: fileId })
      }
      case 'delete': {
        if (!drive.files.delete(fileId)) return route.fulfill(driveFailureResponse('notFound'))
        return route.fulfill({ status: 204, headers: CORS, body: '' })
      }
      default:
        return json(400, { error: { code: 400, message: 'Unexpected request' } })
    }
  }

  return drive
}
