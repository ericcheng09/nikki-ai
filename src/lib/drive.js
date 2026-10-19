// Google Drive client for the single sync file (spec 6; decisions.md
// Phase 4). Calls go straight from the browser to Google; there is no
// backend. Every request goes to the fixed DRIVE_ORIGIN, and the access
// token is only ever sent in the Authorization header: never in a URL
// (URLs end up in history and logs) or a body, never in an error message,
// and nothing here logs. File contents are never put in errors either.
//
// This module only talks to Drive; deciding what to merge, which file to
// keep and when to sync is the caller's job.

export const DRIVE_ORIGIN = 'https://www.googleapis.com'
export const FILES_URL = `${DRIVE_ORIGIN}/drive/v3/files`
export const UPLOAD_URL = `${DRIVE_ORIGIN}/upload/drive/v3/files`

export const SYNC_FILE_NAME = 'nikki-ai-sync.json'
// The app-private hidden folder (drive.appdata scope).
export const SYNC_SPACE = 'appDataFolder'

// A sync file is small, but a slow mobile connection can still take a
// while; past this the request is aborted and reported as 'network'.
export const REQUEST_TIMEOUT_MS = 60_000

// Normally there is one file (a few if two devices created it at once),
// so one page is enough. MAX_PAGES guards against a server that never
// stops paging.
const PAGE_SIZE = 100
const MAX_PAGES = 20

// Drive file IDs are URL-safe base64-like strings. Anything else is
// rejected before a URL is built, so an ID cannot add path segments, a
// query or a fragment, or change the host.
const FILE_ID = /^[A-Za-z0-9_-]+$/

// 403 reasons (error.errors[].reason or error.details[].reason) that mean
// the token is unusable or lacks the drive.appdata scope.
const AUTH_REASONS = new Set([
  'authError',
  'insufficientPermissions',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'ACCESS_TOKEN_EXPIRED',
  'CREDENTIALS_MISSING',
])
// 403 reasons that mean "too many requests, try again later". Storage
// full (storageQuotaExceeded) is deliberately not here: waiting does not
// fix it, so it is reported as 'other'.
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'RATE_LIMIT_EXCEEDED',
])

// `code` is machine-readable: 'auth' | 'quota' | 'notFound' | 'network' |
// 'other'. The message is fixed English text and never includes the
// token, the file ID or the file content.
export class DriveError extends Error {
  constructor(code) {
    super(`Google Drive request failed: ${code}`)
    this.name = 'DriveError'
    this.code = code
  }
}

function assertToken(token) {
  // No usable token means the caller has to sign in again.
  if (typeof token !== 'string' || token === '') throw new DriveError('auth')
}

function assertFileId(fileId) {
  if (typeof fileId !== 'string' || !FILE_ID.test(fileId)) throw new DriveError('other')
}

// Collects the reasons from both Drive error formats: the legacy
// { error: { errors: [{ reason }] } } and the newer
// { error: { status, details: [{ reason }] } }.
async function errorReasons(response) {
  let body = null
  try {
    body = JSON.parse(await response.text())
  } catch {
    // Unreadable or non-JSON body: decide by status only.
  }
  const error = body?.error
  const reasons = []
  for (const list of [error?.errors, error?.details]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (typeof item?.reason === 'string') reasons.push(item.reason)
    }
  }
  return { reasons, status: typeof error?.status === 'string' ? error.status : '' }
}

async function errorCodeFor(response) {
  if (response.status === 401) return 'auth'
  if (response.status === 404) return 'notFound'
  if (response.status === 429) return 'quota'
  if (response.status === 403) {
    const { reasons, status } = await errorReasons(response)
    if (reasons.some((reason) => AUTH_REASONS.has(reason))) return 'auth'
    if (reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))) return 'quota'
    if (status === 'RESOURCE_EXHAUSTED') return 'quota'
  }
  return 'other'
}

// Sends one request and resolves with the body read by `read` (text, JSON
// or nothing) from a 2xx response. Shared by every call so the token
// handling lives in one place. The timeout covers reading the body too.
async function request(url, { token, method = 'GET', headers = {}, body, read, fetchImpl }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body,
        signal: controller.signal,
      })
    } catch {
      // fetch only rejects for network-level failures (offline, DNS,
      // CORS) and for our own timeout abort.
      throw new DriveError('network')
    }
    if (!response.ok) {
      const code = await errorCodeFor(response)
      // A timeout while reading the error body leaves the reasons unknown;
      // report it as the timeout it is, not as whatever the status says.
      throw new DriveError(controller.signal.aborted ? 'network' : code)
    }
    if (read === 'none') return undefined
    try {
      return read === 'json' ? await response.json() : await response.text()
    } catch {
      throw new DriveError(controller.signal.aborted ? 'network' : 'other')
    }
  } finally {
    clearTimeout(timer)
  }
}

function fileUrl(base, fileId, params) {
  const url = new URL(`${base}/${fileId}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function timeOf(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isNaN(time) ? Infinity : time
}

// Lists every non-trashed sync file in the app folder as
// [{ id, createdTime, modifiedTime }], oldest first. More than one can
// exist if two devices created the file at the same time; the caller
// decides what to do with the extras. Entries without a valid ID are
// skipped. Ties (and unparsable times, which sort last) are ordered by ID
// so every device picks the same file.
export async function listSyncFiles(token, { fetchImpl = globalThis.fetch } = {}) {
  assertToken(token)
  const files = []
  const seenTokens = new Set()
  let pageToken = ''

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(FILES_URL)
    url.searchParams.set('spaces', SYNC_SPACE)
    url.searchParams.set('q', `name = '${SYNC_FILE_NAME}' and trashed = false`)
    url.searchParams.set('fields', 'nextPageToken,files(id,createdTime,modifiedTime)')
    url.searchParams.set('pageSize', String(PAGE_SIZE))
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const body = await request(url.toString(), { token, read: 'json', fetchImpl })
    if (!body || typeof body !== 'object') throw new DriveError('other')
    const pageFiles = body.files ?? []
    if (!Array.isArray(pageFiles)) throw new DriveError('other')

    for (const file of pageFiles) {
      if (typeof file?.id !== 'string' || !FILE_ID.test(file.id)) continue
      files.push({
        id: file.id,
        createdTime: typeof file.createdTime === 'string' ? file.createdTime : '',
        modifiedTime: typeof file.modifiedTime === 'string' ? file.modifiedTime : '',
      })
    }

    const next = typeof body.nextPageToken === 'string' ? body.nextPageToken : ''
    // A repeated token would loop forever; treat it as the last page.
    if (!next || seenTokens.has(next)) break
    seenTokens.add(next)
    pageToken = next
  }

  return files.sort((a, b) => {
    const diff = timeOf(a.createdTime) - timeOf(b.createdTime)
    if (diff < 0 || diff > 0) return diff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

// Resolves with the raw text of the file. Parsing and validating it
// (parseSyncFile) is the caller's job.
export async function downloadSyncFile(token, fileId, { fetchImpl = globalThis.fetch } = {}) {
  assertToken(token)
  assertFileId(fileId)
  return request(fileUrl(FILES_URL, fileId, { alt: 'media' }), {
    token,
    read: 'text',
    fetchImpl,
  })
}

// A boundary that does not occur in the content, so the multipart body
// cannot be split in the wrong place.
function makeBoundary(text) {
  for (;;) {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const boundary = `nikki-ai-${hex}`
    if (!text.includes(boundary)) return boundary
  }
}

function assertText(text) {
  if (typeof text !== 'string') throw new DriveError('other')
}

// Creates the sync file in the app folder with `text` as its content and
// resolves with the new file ID. Uses a multipart upload so the name,
// folder and content are set in one request.
export async function createSyncFile(token, text, { fetchImpl = globalThis.fetch } = {}) {
  assertToken(token)
  assertText(text)
  const boundary = makeBoundary(text)
  const metadata = JSON.stringify({ name: SYNC_FILE_NAME, parents: [SYNC_SPACE] })
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${text}\r\n` +
    `--${boundary}--`

  const url = new URL(UPLOAD_URL)
  url.searchParams.set('uploadType', 'multipart')
  url.searchParams.set('fields', 'id')
  const result = await request(url.toString(), {
    token,
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
    read: 'json',
    fetchImpl,
  })
  // The ID is used to build later URLs, so it has to pass the same check.
  if (typeof result?.id !== 'string' || !FILE_ID.test(result.id)) {
    throw new DriveError('other')
  }
  return result.id
}

// Replaces the content of an existing sync file.
export async function updateSyncFile(token, fileId, text, { fetchImpl = globalThis.fetch } = {}) {
  assertToken(token)
  assertFileId(fileId)
  assertText(text)
  await request(fileUrl(UPLOAD_URL, fileId, { uploadType: 'media', fields: 'id' }), {
    token,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: text,
    read: 'none',
    fetchImpl,
  })
}

// Permanently deletes a sync file (used for duplicates). A file that is
// already gone rejects with 'notFound'; the caller may treat that as done.
export async function deleteSyncFile(token, fileId, { fetchImpl = globalThis.fetch } = {}) {
  assertToken(token)
  assertFileId(fileId)
  await request(fileUrl(FILES_URL, fileId, {}), {
    token,
    method: 'DELETE',
    read: 'none',
    fetchImpl,
  })
}
