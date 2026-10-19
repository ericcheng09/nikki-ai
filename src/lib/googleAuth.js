// Google sign-in for Drive sync (spec 3.6, 6; decisions.md Phase 4), using
// the Google Identity Services (GIS) token model. Every use of GIS is in
// this module, so E2E tests can stub window.google.accounts.oauth2.
//
// The access token is a secret: it is stored only locally (see
// loadGoogleAuth in connection.js), is never synced, never logged and never
// put in an error message. Failures are reported as result codes, not
// thrown errors, so nothing token-related can leak through an exception.

import { loadGoogleAuth, storeGoogleAuth } from '../storage/connection.js'

// Not a secret (spec 8.5): OAuth client IDs are public by design.
export const GOOGLE_CLIENT_ID =
  '183657778897-o2qr69jd1khjror0fc0c5i7geh5eeltj.apps.googleusercontent.com'
// App-private Drive folder only (spec 6).
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

// A token with less time left is renewed first, so a request started with
// it does not expire half-way.
export const TOKEN_MIN_REMAINING_MS = 60_000
// A silent request normally answers within a second or two. Without an
// answer (e.g. a popup that never reports back) give up, so a background
// sync can show 需要重新登入 instead of hanging.
export const SILENT_REQUEST_TIMEOUT_MS = 20_000
const REVOKE_TIMEOUT_MS = 5_000

// --- Script loading -----------------------------------------------------------

function existingOAuth2(win) {
  return win.google?.accounts?.oauth2 ?? null
}

// Loads the GIS script on demand (only from GIS_SCRIPT_URL) and resolves
// with google.accounts.oauth2. A failed load is forgotten, so the next
// sign-in attempt tries again. `loadGis.peek()` returns the API right away
// if it is already loaded (else null), so a click can call GIS
// synchronously, inside the user gesture that allows its popup.
export function createGisLoader({ win = window, doc = document } = {}) {
  let pending = null
  function loadGis() {
    const ready = existingOAuth2(win)
    if (ready) return Promise.resolve(ready)
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const script = doc.createElement('script')
        script.src = GIS_SCRIPT_URL
        script.async = true
        script.onload = () => {
          const oauth2 = existingOAuth2(win)
          if (oauth2) resolve(oauth2)
          else reject(new Error('Google sign-in is unavailable'))
        }
        script.onerror = () => reject(new Error('Google sign-in is unavailable'))
        doc.head.appendChild(script)
      }).catch((error) => {
        pending = null
        throw error
      })
    }
    return pending
  }
  loadGis.peek = () => existingOAuth2(win)
  return loadGis
}

// --- Auth client ------------------------------------------------------------------

// Resolves with the GIS token response ({ access_token, expires_in, ... })
// or null for any failure: an error response, a closed or blocked popup,
// a missing scope, a timeout, or GIS throwing.
function requestToken(oauth2, { prompt, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }
    try {
      const client = oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          // Must always settle, even if GIS (e.g. hasGrantedAllScopes)
          // throws, or an interactive sign-in would hang forever.
          try {
            const ok =
              response &&
              !response.error &&
              typeof response.access_token === 'string' &&
              response.access_token !== '' &&
              // The user may untick the Drive permission on the consent screen.
              oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)
            finish(ok ? response : null)
          } catch {
            finish(null)
          }
        },
        // popup_closed, popup_failed_to_open (blocked, no user gesture), ...
        error_callback: () => finish(null),
      })
      if (timeoutMs) timer = setTimeout(() => finish(null), timeoutMs)
      client.requestAccessToken({ prompt })
    } catch {
      finish(null)
    }
  })
}

function expiresAtFrom(response, nowMs) {
  const seconds = Number(response.expires_in)
  return Number.isFinite(seconds) && seconds > 0 ? nowMs + seconds * 1000 : NaN
}

// Status for the settings page, from the stored state alone (no network):
// 'signedOut' | 'signedIn' | 'needsLogin'.
function statusOf(auth) {
  if (!auth.enabled) return 'signedOut'
  return auth.needsLogin ? 'needsLogin' : 'signedIn'
}

// Dependencies are injectable for tests; the default instance below uses
// the real GIS script and IndexedDB.
export function createGoogleAuth({
  loadGis = createGisLoader(),
  // Wrapped so the storage functions are looked up only when used.
  load = () => loadGoogleAuth(),
  save = (auth) => storeGoogleAuth(auth),
  now = () => Date.now(),
} = {}) {
  const listeners = new Set()
  // Requests of the same kind are shared, so a burst of syncs or a double
  // click never starts several. An interactive request (a click) never
  // joins a silent one: prompt 'none' cannot show the popup the user asked
  // for. A silent request may join an interactive one, which yields a
  // token just as well.
  let inFlightInteractive = null
  let inFlightSilent = null
  // Bumped by every sign-out. A token request that started before the
  // latest sign-out is discarded instead of signing the user back in.
  let signOutCount = 0

  function emit(status) {
    for (const listener of [...listeners]) {
      try {
        listener(status)
      } catch {
        // A failing listener must not break sign-in; never logged.
      }
    }
  }

  async function update(auth) {
    await save(auth)
    emit(statusOf(auth))
  }

  // Asks GIS for a token and stores it. `interactive`: started by a click,
  // so the consent screen may be shown (prompt ''); otherwise prompt 'none'
  // never shows any Google screen and simply fails when consent or a login
  // is needed. Resolves with the new auth state, or null on failure.
  // When GIS is already loaded, requestAccessToken is called synchronously
  // (no await before it), keeping it inside the click's user gesture;
  // otherwise the script is loaded first as a fallback.
  function obtainToken({ interactive }) {
    const startedAfter = signOutCount
    const options = {
      prompt: interactive ? '' : 'none',
      timeoutMs: interactive ? 0 : SILENT_REQUEST_TIMEOUT_MS,
    }
    let ready = null
    try {
      ready = loadGis.peek?.() ?? null
    } catch {
      ready = null
    }
    const responsePromise = ready
      ? requestToken(ready, options)
      : Promise.resolve()
          .then(() => loadGis())
          .then((oauth2) => requestToken(oauth2, options), () => null)
    return responsePromise.then(async (response) => {
      if (!response) return null
      // Signed out while the request ran: never undo the sign-out.
      if (signOutCount !== startedAfter) return null
      const expiresAt = expiresAtFrom(response, now())
      if (Number.isNaN(expiresAt)) return null
      const auth = { enabled: true, accessToken: response.access_token, expiresAt, needsLogin: false }
      await update(auth)
      return auth
    })
  }

  function obtainShared({ interactive }) {
    if (interactive) {
      if (!inFlightInteractive) {
        inFlightInteractive = obtainToken({ interactive: true }).finally(() => {
          inFlightInteractive = null
        })
      }
      return inFlightInteractive
    }
    if (inFlightInteractive) return inFlightInteractive
    if (!inFlightSilent) {
      inFlightSilent = obtainToken({ interactive: false }).finally(() => {
        inFlightSilent = null
      })
    }
    return inFlightSilent
  }

  function hasUsableToken(auth) {
    return Boolean(auth.accessToken) && auth.expiresAt - now() > TOKEN_MIN_REMAINING_MS
  }

  return {
    async getStatus() {
      return statusOf(await load())
    },

    // Starts loading the GIS script ahead of a click (settings page), so
    // the click can open the popup synchronously. Failures are ignored:
    // the click falls back to loading it on demand.
    preload() {
      try {
        Promise.resolve(loadGis()).catch(() => {})
      } catch {
        // Ignored, see above.
      }
    },

    // Subscribes to status changes ('signedOut' | 'signedIn' |
    // 'needsLogin'); returns an unsubscribe function.
    onStatusChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    // 登入 Google / 重新登入 (must be called from a click so the popup is
    // allowed). Resolves with { ok: true } or { ok: false }; on failure the
    // stored state is left as it was (signed out stays signed out).
    // Not async on purpose: the GIS call must happen before any await.
    signIn() {
      return obtainShared({ interactive: true }).then(
        (auth) => ({ ok: auth !== null }),
        () => ({ ok: false }),
      )
    },

    // For Drive requests. Resolves with one of
    //   { status: 'ok', accessToken }
    //   { status: 'signedOut' }   sync is not enabled
    //   { status: 'needsLogin' }  no valid token and none could be obtained
    // A stored token with more than TOKEN_MIN_REMAINING_MS left is reused;
    // otherwise a new one is requested, silently unless `interactive`.
    async getAccessToken({ interactive = false } = {}) {
      const auth = await load()
      if (!auth.enabled) return { status: 'signedOut' }
      if (hasUsableToken(auth)) return { status: 'ok', accessToken: auth.accessToken }
      const renewed = await obtainShared({ interactive })
      if (renewed) return { status: 'ok', accessToken: renewed.accessToken }
      // Signed out meanwhile (登出 during the request): stay signed out.
      const current = await load()
      if (!current.enabled) return { status: 'signedOut' }
      // Another request (e.g. the user's 重新登入) got a token meanwhile.
      if (hasUsableToken(current)) return { status: 'ok', accessToken: current.accessToken }
      await update({ enabled: true, accessToken: '', expiresAt: 0, needsLogin: true })
      return { status: 'needsLogin' }
    },

    // 登出: forget the token and stop syncing. Local data and the Drive
    // file are kept (decisions.md Phase 4). The token is then revoked at
    // Google on a best-effort basis; a failure there changes nothing here.
    async signOut() {
      signOutCount += 1
      const { accessToken } = await load()
      await update({ enabled: false, accessToken: '', expiresAt: 0, needsLogin: false })
      if (!accessToken) return
      try {
        const oauth2 = await loadGis()
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, REVOKE_TIMEOUT_MS)
          oauth2.revoke(accessToken, () => {
            clearTimeout(timer)
            resolve()
          })
        })
      } catch {
        // Revoking is best effort; the token expires on its own anyway.
      }
    },
  }
}

const googleAuth = createGoogleAuth()
export default googleAuth
