// Gemini API client (spec 5.1). Calls go straight from the browser to
// Google; there is no backend. The API key is only ever sent in the
// x-goog-api-key header to generativelanguage.googleapis.com: never in a
// URL (URLs end up in history and logs), never in an error message, and
// nothing here logs (spec 5.4).

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
export const MODELS_URL = `${API_BASE}/models`

// The API caps pageSize itself; asking for a lot keeps it to one request
// in practice. MAX_PAGES guards against a server that never stops paging.
const PAGE_SIZE = 1000
const MAX_PAGES = 20

// Error with a machine-readable `code` the UI maps to Chinese text:
// 'invalidKey' | 'network' | 'format' | 'other' ('format' comes from
// analysis.js). The message is fixed English text and never includes
// request or response data.
export class GeminiError extends Error {
  constructor(code) {
    super(`Gemini request failed: ${code}`)
    this.name = 'GeminiError'
    this.code = code
  }
}

async function request(url, apiKey, fetchImpl) {
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
    })
  } catch {
    // fetch only rejects for network-level failures (offline, DNS, CORS).
    throw new GeminiError('network')
  }
}

// Maps a non-2xx response to an error code. A wrong key comes back as
// 400 with reason API_KEY_INVALID; 401/403 cover missing permission or a
// key restricted to other APIs/sites.
async function errorCodeFor(response) {
  if (response.status === 401 || response.status === 403) return 'invalidKey'
  if (response.status === 400) {
    try {
      const text = await response.text()
      if (text.includes('API_KEY_INVALID')) return 'invalidKey'
    } catch {
      // Unreadable body: fall through to 'other'.
    }
  }
  return 'other'
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
export async function listModels(apiKey, { fetchImpl = globalThis.fetch } = {}) {
  const models = []
  const seenTokens = new Set()
  let pageToken = ''

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(MODELS_URL)
    url.searchParams.set('pageSize', String(PAGE_SIZE))
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const response = await request(url.toString(), apiKey, fetchImpl)
    if (!response.ok) throw new GeminiError(await errorCodeFor(response))

    let body
    try {
      body = await response.json()
    } catch {
      throw new GeminiError('other')
    }
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
