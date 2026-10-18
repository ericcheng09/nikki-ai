// Gemini API client (spec 5.1-5.4). Calls go straight from the browser to
// Google; there is no backend. The API key is only ever sent in the
// x-goog-api-key header to API_BASE: never in a URL (URLs end up in
// history and logs) or a body, never in an error message, and nothing
// here logs (spec 5.4). Failed calls are never retried automatically
// (spec 5.3).
import { ANALYSIS_RESPONSE_SCHEMA, parseAnalysisResponse } from './analysis.js'
import { GeminiError } from './geminiError.js'
import { buildPrompt } from './prompt.js'

export { GeminiError }

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
export const MODELS_URL = `${API_BASE}/models`

// The API caps pageSize itself; asking for a lot keeps it to one request
// in practice. MAX_PAGES guards against a server that never stops paging.
const PAGE_SIZE = 1000
const MAX_PAGES = 20

// Analyses of long diaries can take a while; past this the request is
// aborted and reported as a network problem.
export const REQUEST_TIMEOUT_MS = 120_000

// Only plain resource names. The name is appended to a fixed origin and
// path, and "/", "?", "#", "%", "@" and whitespace are excluded, so it
// cannot change the host, add path segments, a query or a fragment. Dots
// are allowed (e.g. gemini-2.5-flash); a segment such as "..:generateContent"
// is not a dot-segment, so it cannot climb out of the path either.
const MODEL_NAME = /^models\/[A-Za-z0-9._-]+$/

// Chinese messages for each error code (decisions.md Phase 2 AI 批改).
export const GEMINI_ERROR_MESSAGES = Object.freeze({
  invalidKey: 'API key 無效，請到設定頁確認。',
  quota: '已達 Gemini 使用額度上限，請稍後再試。',
  network: '無法連線到 Gemini，請檢查網路後再試一次。',
  format: 'AI 回傳的格式不正確，請再試一次。',
  modelUnavailable: '所選的模型已無法使用，請到設定頁重新選擇。',
  other: '批改失敗，請稍後再試一次。',
  noKey: '請先到設定頁設定 Gemini API key。',
  noModel: '請先到設定頁選擇 Gemini 模型。',
})

// Message for an error code; unknown codes (including inherited names
// such as "toString") fall back to the generic one.
export function geminiErrorMessage(code) {
  return Object.hasOwn(GEMINI_ERROR_MESSAGES, code)
    ? GEMINI_ERROR_MESSAGES[code]
    : GEMINI_ERROR_MESSAGES.other
}

// Maps a non-2xx response to an error code, using both the HTTP status
// and the error body ({ error: { status, details: [{ reason }] } }).
// A wrong key comes back as 400 with reason API_KEY_INVALID; 401/403
// cover missing permission or a key restricted to other APIs/sites.
async function errorCodeFor(response) {
  let text = ''
  try {
    text = await response.text()
  } catch {
    // Unreadable body: decide by status only.
  }
  let status = ''
  try {
    status = JSON.parse(text)?.error?.status ?? ''
  } catch {
    // Not JSON: decide by status and raw text.
  }
  if (response.status === 401 || response.status === 403) return 'invalidKey'
  if (text.includes('API_KEY_INVALID')) return 'invalidKey'
  if (response.status === 429 || status === 'RESOURCE_EXHAUSTED') return 'quota'
  if (response.status === 404 || status === 'NOT_FOUND') return 'modelUnavailable'
  return 'other'
}

// Sends one request and resolves with the parsed JSON body of a 2xx
// response. Shared by every call so the key handling lives in one place.
// The timeout covers reading the body as well. `badBodyCode` is the code
// for a 2xx response whose body is not JSON.
async function requestJson(
  url,
  { apiKey, method = 'GET', body, fetchImpl, badBodyCode = 'other' },
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    let response
    try {
      const headers = { 'x-goog-api-key': apiKey }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch {
      // fetch only rejects for network-level failures (offline, DNS,
      // CORS) and for our own timeout abort.
      throw new GeminiError('network')
    }
    if (!response.ok) throw new GeminiError(await errorCodeFor(response))
    try {
      return await response.json()
    } catch {
      throw new GeminiError(controller.signal.aborted ? 'network' : badBodyCode)
    }
  } finally {
    clearTimeout(timer)
  }
}

// Text-generation Gemini models only: the list also contains embedding,
// image and Gemma models, which cannot be used for diary feedback.
function isUsableModel(model) {
  return (
    typeof model?.name === 'string' &&
    model.name.startsWith('models/gemini') &&
    Array.isArray(model.supportedGenerationMethods) &&
    model.supportedGenerationMethods.includes('generateContent')
  )
}

// Lists the Gemini models the key can use for generateContent, in API
// order, as [{ name, displayName }]. `name` is the full resource name
// (e.g. "models/gemini-2.5-flash") and is what gets stored as geminiModel.
// This is the full list; which of them the settings page offers is
// decided in models.js.
export async function listModels(apiKey, { fetchImpl = globalThis.fetch } = {}) {
  const models = []
  const seenTokens = new Set()
  let pageToken = ''

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(MODELS_URL)
    url.searchParams.set('pageSize', String(PAGE_SIZE))
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const body = await requestJson(url.toString(), { apiKey, fetchImpl })
    if (!body || typeof body !== 'object') throw new GeminiError('other')
    const pageModels = body.models ?? []
    if (!Array.isArray(pageModels)) throw new GeminiError('other')

    for (const model of pageModels) {
      if (!isUsableModel(model)) continue
      models.push({
        name: model.name,
        displayName: typeof model.displayName === 'string' ? model.displayName : '',
      })
    }

    const next = typeof body.nextPageToken === 'string' ? body.nextPageToken : ''
    // A repeated token would loop forever; treat it as the last page.
    if (!next || seenTokens.has(next)) break
    seenTokens.add(next)
    pageToken = next
  }

  return models
}

// Joins the text parts of the first candidate. A blocked prompt has no
// candidates; a safety stop or MAX_TOKENS may leave no or truncated text,
// which then fails parsing. Thought parts (thinking models) are skipped.
function responseText(body) {
  const parts = body?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part) => typeof part?.text === 'string' && part.thought !== true)
    .map((part) => part.text)
    .join('')
}

// Asks Gemini to analyse one diary entry and resolves with a validated
// analysis stamped with analyzedAt (spec 4.2, 5.2). The result is only
// returned; storing it is the caller's job, and it never touches the
// diary text. Rejects with GeminiError (see geminiError.js for codes).
export async function generateAnalysis(
  { apiKey, model, entry } = {},
  { fetchImpl = globalThis.fetch, now = new Date() } = {},
) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') throw new GeminiError('noKey')
  if (typeof model !== 'string' || model === '') throw new GeminiError('noModel')
  if (!MODEL_NAME.test(model)) throw new GeminiError('modelUnavailable')

  const body = await requestJson(`${API_BASE}/${model}:generateContent`, {
    apiKey,
    method: 'POST',
    fetchImpl,
    badBodyCode: 'format',
    body: {
      contents: [{ role: 'user', parts: [{ text: buildPrompt(entry) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ANALYSIS_RESPONSE_SCHEMA,
      },
    },
  })
  const text = responseText(body)
  if (!text) throw new GeminiError('format')
  return parseAnalysisResponse(text, { now })
}
