// Google Drive sync engine (spec 6; decisions.md Phase 4): when to sync,
// one sync at a time, and the status shown in the top bar and settings.
// The merge rules live in sync.js, Drive requests in drive.js and the
// token in googleAuth.js; this module only puts them together.
//
// Nothing here logs: the snapshot holds the diary and the Gemini API key,
// and the Drive token is a secret. Errors become status codes only.

import { DriveError } from './drive.js'
import { buildSyncFile, mergeSync, parseSyncFile } from './sync.js'
import googleAuth from './googleAuth.js'
import * as driveApi from './drive.js'
import * as connection from '../storage/connection.js'
import { onSyncedDataChange } from '../storage/syncSignals.js'

// navigator.locks name shared by every tab of the app.
export const SYNC_LOCK_NAME = 'nikki-ai-sync'
// Several changes in a short time are combined into one sync
// (decisions.md Phase 4: about 2 seconds).
export const CHANGE_DEBOUNCE_MS = 2000

// A Drive file that cannot be read stops the sync before anything is
// uploaded, so data written by a newer app version is never overwritten.
class SyncFileError extends Error {
  constructor(code) {
    super(`Sync file unreadable: ${code}`)
    this.name = 'SyncFileError'
    this.code = code
  }
}

// Thrown when the user signed out (in this or another tab) while a sync
// was running: 登出 stops syncing, so nothing more is written anywhere.
class SignedOutError extends Error {
  constructor() {
    super('Signed out during sync')
    this.name = 'SignedOutError'
  }
}

const INITIAL_STATUS = Object.freeze({
  // Sync is enabled (signed in, possibly with an expired login).
  signedIn: false,
  // 'idle' | 'syncing' | 'synced' | 'error'
  state: 'idle',
  // With state 'error': 'needsLogin' | 'offline' | 'network' | 'quota' |
  // 'notFound' | 'format' | 'unsupportedVersion' | 'other'; else null.
  code: null,
  // ISO time of the last successful sync on this device, '' = never.
  lastSyncedAt: '',
})

// Dependencies are injectable for tests; see the default instance at the
// bottom of the file for the real ones.
//   auth:  { getStatus, getAccessToken, onStatusChange } (googleAuth.js)
//   drive: { listSyncFiles, downloadSyncFile, createSyncFile,
//            updateSyncFile, deleteSyncFile } (drive.js)
//   store: { readSyncSnapshot, applySyncResult, invalidateGoogleToken,
//            loadLastSyncedAt, storeLastSyncedAt, onSyncedDataChange }
//          (storage/connection.js)
export function createSyncEngine({
  auth,
  drive,
  store,
  now = () => new Date(),
  isOnline = () => globalThis.navigator?.onLine !== false,
  getLocks = () => globalThis.navigator?.locks,
  getWindow = () => globalThis.window,
  debounceMs = CHANGE_DEBOUNCE_MS,
} = {}) {
  let status = INITIAL_STATUS
  const listeners = new Set()

  function setStatus(patch) {
    status = Object.freeze({ ...status, ...patch })
    for (const listener of [...listeners]) {
      try {
        listener(status)
      } catch {
        // A failing listener must not break the sync; never logged.
      }
    }
  }

  // Last auth status seen ('signedOut' | 'signedIn' | 'needsLogin'), to
  // tell a real sign-in from a silent token renewal (both emit
  // 'signedIn').
  let knownAuth = 'signedOut'
  // Set by the first auth event; a status read at start that is older
  // than an event is then ignored.
  let authEventSeen = false
  // Bumped by every sign-out, so a sync that was running then does not
  // report its result afterwards.
  let signOutCount = 0

  // --- One sync ---------------------------------------------------------------

  // Called right before every write (local data, Drive file). A sign-out
  // in this tab bumps signOutCount; one in another tab is only visible in
  // storage, hence the local status read too.
  async function assertStillSignedIn(startedAfter) {
    if (signOutCount !== startedAfter) throw new SignedOutError()
    if ((await auth.getStatus()) === 'signedOut') throw new SignedOutError()
    if (signOutCount !== startedAfter) throw new SignedOutError()
  }

  async function syncWithToken(token, startedAfter) {
    const listed = await drive.listSyncFiles(token)
    const files = []
    const remotes = []
    for (const file of listed) {
      let text
      try {
        text = await drive.downloadSyncFile(token, file.id)
      } catch (error) {
        // Deleted since the list call (another device removing a
        // duplicate after merging it): it simply is not there any more.
        if (error instanceof DriveError && error.code === 'notFound') continue
        throw error
      }
      const parsed = parseSyncFile(text)
      if (!parsed.ok) throw new SyncFileError(parsed.error)
      files.push(file)
      remotes.push(parsed.data)
    }

    const at = now()
    // Duplicates (two devices created the file at once) are combined
    // with the same rules as local and remote, so nothing in any of them
    // is lost.
    let combined = null
    for (const remote of remotes) {
      combined = combined === null ? remote : mergeSync(combined, remote, { now: at }).merged
    }

    const local = await store.readSyncSnapshot()
    const result = mergeSync(local, combined, { now: at })
    if (result.localChanged) {
      await assertStillSignedIn(startedAfter)
      await store.applySyncResult(result.merged)
    }

    // With duplicates the oldest one (listSyncFiles sorts oldest first,
    // so every device picks the same) gets everything and the rest are
    // deleted.
    if (result.remoteChanged || files.length !== 1) {
      const text = JSON.stringify(buildSyncFile(result.merged))
      await assertStillSignedIn(startedAfter)
      if (files.length === 0) {
        await drive.createSyncFile(token, text)
      } else {
        await drive.updateSyncFile(token, files[0].id, text)
      }
      for (const extra of files.slice(1)) {
        await assertStillSignedIn(startedAfter)
        try {
          await drive.deleteSyncFile(token, extra.id)
        } catch (error) {
          // Already deleted by another device: done.
          if (!(error instanceof DriveError && error.code === 'notFound')) throw error
        }
      }
    }
  }

  function errorCodeOf(error) {
    if (error instanceof SyncFileError || error instanceof DriveError) return error.code
    // Storage failures and anything unexpected.
    return 'other'
  }

  // Resolves with the final status patch; never rejects.
  async function runOnce(interactive, startedAfter) {
    // Local read only: a signed-out user makes no request to Google.
    let authStatus
    try {
      authStatus = await auth.getStatus()
    } catch {
      return { state: 'error', code: 'other' }
    }
    if (authStatus === 'signedOut') return { signedIn: false, state: 'idle', code: null }
    if (!isOnline()) return { signedIn: true, state: 'error', code: 'offline' }

    setStatus({ signedIn: true, state: 'syncing', code: null })
    try {
      // A token Drive rejects although it had not expired (e.g. revoked)
      // is dropped and renewed once in the background (decisions.md: try
      // to renew first); a second rejection needs a new sign-in.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = await auth.getAccessToken({ interactive })
        if (token.status === 'signedOut') return { signedIn: false, state: 'idle', code: null }
        if (token.status !== 'ok') return { state: 'error', code: 'needsLogin' }
        try {
          await syncWithToken(token.accessToken, startedAfter)
        } catch (error) {
          if (!(error instanceof DriveError && error.code === 'auth')) throw error
          const last = attempt === 1
          // Only this token: one obtained meanwhile (another tab, a
          // parallel 重新登入) is kept.
          const dropped = await store.invalidateGoogleToken({
            token: token.accessToken,
            needsLogin: last,
          })
          if (!last) continue
          // A newer token was stored meanwhile (e.g. 重新登入), so the login
          // is not expired; its sign-in event syncs again.
          if (!dropped) return { state: 'error', code: 'other' }
          // Marked directly in storage, so googleAuth did not emit; the
          // next 'signedIn' (重新登入) must count as a new sign-in.
          knownAuth = 'needsLogin'
          return { state: 'error', code: 'needsLogin' }
        }
        const lastSyncedAt = now().toISOString()
        try {
          await store.storeLastSyncedAt(lastSyncedAt)
        } catch {
          // Only the shown time is lost; the data is in sync.
        }
        return { state: 'synced', code: null, lastSyncedAt }
      }
      return { state: 'error', code: 'needsLogin' }
    } catch (error) {
      if (error instanceof SignedOutError) return { signedIn: false, state: 'idle', code: null }
      return { state: 'error', code: errorCodeOf(error) }
    }
  }

  // Runs one sync while holding the cross-tab lock when the browser has
  // navigator.locks, so two tabs never write the Drive file at once.
  async function runExclusive(interactive) {
    const startedAfter = signOutCount
    const locks = getLocks()
    let patch
    if (locks && typeof locks.request === 'function') {
      try {
        patch = await locks.request(SYNC_LOCK_NAME, () => runOnce(interactive, startedAfter))
      } catch {
        patch = { state: 'error', code: 'other' }
      }
    } else {
      patch = await runOnce(interactive, startedAfter)
    }
    // Signed out while it ran: stay signed out and idle.
    if (signOutCount !== startedAfter) return
    setStatus(patch)
  }

  // --- Serialisation ----------------------------------------------------------
  // One sync at a time in this tab. A request during a sync is not
  // dropped: one more sync runs after the current one (several requests
  // meanwhile still give only one), so a change made during a sync is
  // uploaded too.
  let loop = null
  let pending = false
  let pendingInteractive = false

  async function drain() {
    try {
      while (pending) {
        const interactive = pendingInteractive
        pending = false
        pendingInteractive = false
        await runExclusive(interactive)
      }
    } finally {
      // Same tick as the last `pending` check, so no request is missed.
      loop = null
    }
  }

  // Resolves once this request has been served (possibly by a follow-up
  // sync). `interactive`: started by a click (立即同步), so an expired
  // login may show Google's sign-in popup.
  function syncNow({ interactive = false } = {}) {
    pending = true
    pendingInteractive = pendingInteractive || interactive
    if (!loop) loop = drain()
    return loop
  }

  // --- Triggers ---------------------------------------------------------------

  let debounceTimer = null
  function clearDebounce() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = null
  }

  function handleDataChange() {
    if (!status.signedIn) return
    clearDebounce()
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      syncNow()
    }, debounceMs)
  }

  function handleOnline() {
    if (status.signedIn) syncNow()
  }

  function handleAuthStatus(next) {
    const previous = knownAuth
    knownAuth = next
    authEventSeen = true
    if (next === 'signedOut') {
      signOutCount += 1
      clearDebounce()
      setStatus({ signedIn: false, state: 'idle', code: null })
      return
    }
    if (!status.signedIn) setStatus({ signedIn: true })
    // A real sign-in (登入 Google, 重新登入), not a silent renewal.
    if (next === 'signedIn' && previous !== 'signedIn') syncNow()
  }

  let started = null
  const cleanups = []

  // Starts listening and, when signed in, syncs (app start). Idempotent.
  function start() {
    if (started) return started
    started = (async () => {
      cleanups.push(auth.onStatusChange(handleAuthStatus))
      cleanups.push(store.onSyncedDataChange(handleDataChange))
      const win = getWindow()
      if (win?.addEventListener) {
        win.addEventListener('online', handleOnline)
        cleanups.push(() => win.removeEventListener('online', handleOnline))
      }
      try {
        const lastSyncedAt = await store.loadLastSyncedAt()
        if (lastSyncedAt && !status.lastSyncedAt) setStatus({ lastSyncedAt })
      } catch {
        // No time shown until the next successful sync.
      }
      let initial = 'signedOut'
      try {
        initial = await auth.getStatus()
      } catch {
        // Treated as signed out: no request to Google.
      }
      // An event that arrived meanwhile is newer than this read.
      if (!authEventSeen) {
        knownAuth = initial
        if (initial !== 'signedOut') {
          setStatus({ signedIn: true })
          syncNow()
        }
      }
    })()
    return started
  }

  // Stops listening (tests). A running sync still finishes.
  function stop() {
    clearDebounce()
    while (cleanups.length) cleanups.pop()()
    started = null
  }

  return {
    start,
    stop,
    syncNow,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// --- Default instance ---------------------------------------------------------
// Started once from main.jsx; components only read its status and call
// syncNow, so unit tests that render them never start syncing. Storage
// functions are looked up only when used (component tests mock the
// storage module with just the functions they need).

const syncEngine = createSyncEngine({
  auth: googleAuth,
  drive: driveApi,
  store: {
    applySyncResult: (merged) => connection.applySyncResult(merged),
    invalidateGoogleToken: (options) => connection.invalidateGoogleToken(options),
    loadLastSyncedAt: () => connection.loadLastSyncedAt(),
    onSyncedDataChange,
    readSyncSnapshot: () => connection.readSyncSnapshot(),
    storeLastSyncedAt: (value) => connection.storeLastSyncedAt(value),
  },
})
export default syncEngine
