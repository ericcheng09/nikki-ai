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
}

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
