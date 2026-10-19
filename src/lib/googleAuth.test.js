import {
  DRIVE_SCOPE,
  GIS_SCRIPT_URL,
  GOOGLE_CLIENT_ID,
  SILENT_REQUEST_TIMEOUT_MS,
  TOKEN_MIN_REMAINING_MS,
  createGisLoader,
  createGoogleAuth,
} from './googleAuth.js'

const NOW = 1_800_000_000_000
const TOKEN = 'ya29.secret-token'

// In-memory replacement for loadGoogleAuth / storeGoogleAuth.
function memoryStore(initial = {}) {
  let auth = { enabled: false, accessToken: '', expiresAt: 0, needsLogin: false, ...initial }
  return {
    load: vi.fn(async () => ({ ...auth })),
    save: vi.fn(async (next) => {
      auth = { enabled: false, accessToken: '', expiresAt: 0, needsLogin: false, ...next }
    }),
    get current() {
      return auth
    },
  }
}

// Stub of google.accounts.oauth2. `respond(config, options)` decides what
// a token request does: call config.callback / config.error_callback, or
// nothing (a request that never answers).
function fakeOAuth2(respond = (config) => config.callback({ access_token: TOKEN, expires_in: 3599 })) {
  const oauth2 = {
    configs: [],
    requests: [],
    initTokenClient: vi.fn((config) => {
      oauth2.configs.push(config)
      return {
        requestAccessToken: vi.fn((options) => {
          oauth2.requests.push(options)
          respond(config, options)
        }),
      }
    }),
    hasGrantedAllScopes: vi.fn(() => true),
    revoke: vi.fn((_token, done) => done?.()),
  }
  return oauth2
}

function setup({ stored, oauth2 = fakeOAuth2(), loadGis } = {}) {
  const store = memoryStore(stored)
  const auth = createGoogleAuth({
    loadGis: loadGis ?? vi.fn(async () => oauth2),
    load: store.load,
    save: store.save,
    now: () => NOW,
  })
  return { auth, store, oauth2 }
}

const signedIn = (expiresAt = NOW + 3_000_000) => ({
  enabled: true,
  accessToken: TOKEN,
  expiresAt,
  needsLogin: false,
})

let consoleSpies
beforeEach(() => {
  consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((name) => vi.spyOn(console, name))
})
afterEach(() => {
  // The token must never reach the console.
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  }
  vi.useRealTimers()
})

describe('constants', () => {
  it('uses the app client ID, only the appdata scope and the GIS script URL', () => {
    expect(GOOGLE_CLIENT_ID).toBe(
      '183657778897-o2qr69jd1khjror0fc0c5i7geh5eeltj.apps.googleusercontent.com',
    )
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.appdata')
    expect(GIS_SCRIPT_URL).toBe('https://accounts.google.com/gsi/client')
  })
})

describe('signIn', () => {
  it('requests a token interactively and stores it', async () => {
    const { auth, store, oauth2 } = setup()
    await expect(auth.signIn()).resolves.toEqual({ ok: true })
    expect(oauth2.configs[0]).toMatchObject({ client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE })
    expect(oauth2.requests).toEqual([{ prompt: '' }])
    expect(store.current).toEqual({
      enabled: true,
      accessToken: TOKEN,
      expiresAt: NOW + 3599 * 1000,
      needsLogin: false,
    })
    await expect(auth.getStatus()).resolves.toBe('signedIn')
  })

  it.each([
    ['the popup is closed', (config) => config.error_callback({ type: 'popup_closed' })],
    ['the popup is blocked', (config) => config.error_callback({ type: 'popup_failed_to_open' })],
    ['Google returns an error', (config) => config.callback({ error: 'access_denied' })],
    ['the response has no token', (config) => config.callback({ expires_in: 3599 })],
    ['the expiry is invalid', (config) => config.callback({ access_token: TOKEN, expires_in: 'x' })],
    ['GIS throws', () => {
      throw new Error('boom')
    }],
  ])('fails and stays signed out when %s', async (_label, respond) => {
    const { auth, store } = setup({ oauth2: fakeOAuth2(respond) })
    await expect(auth.signIn()).resolves.toEqual({ ok: false })
    expect(store.save).not.toHaveBeenCalled()
    await expect(auth.getStatus()).resolves.toBe('signedOut')
  })

  it('fails when the user did not grant the Drive scope', async () => {
    const oauth2 = fakeOAuth2()
    oauth2.hasGrantedAllScopes.mockReturnValue(false)
    const { auth, store } = setup({ oauth2 })
    await expect(auth.signIn()).resolves.toEqual({ ok: false })
    expect(oauth2.hasGrantedAllScopes).toHaveBeenCalledWith(expect.anything(), DRIVE_SCOPE)
    expect(store.save).not.toHaveBeenCalled()
  })

  it('fails when the GIS script cannot be loaded', async () => {
    const { auth } = setup({ loadGis: vi.fn().mockRejectedValue(new Error('offline')) })
    await expect(auth.signIn()).resolves.toEqual({ ok: false })
  })

  it('re-login clears needsLogin', async () => {
    const { auth, store } = setup({ stored: { enabled: true, needsLogin: true } })
    await expect(auth.getStatus()).resolves.toBe('needsLogin')
    await auth.signIn()
    expect(store.current.needsLogin).toBe(false)
    await expect(auth.getStatus()).resolves.toBe('signedIn')
  })

  it('shares one request between concurrent calls', async () => {
    let answer
    const oauth2 = fakeOAuth2((config) => {
      answer = () => config.callback({ access_token: TOKEN, expires_in: 3599 })
    })
    const { auth } = setup({ oauth2 })
    const first = auth.signIn()
    const second = auth.signIn()
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    answer()
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(oauth2.requests).toHaveLength(1)
  })
})

describe('getAccessToken', () => {
  it('reports signedOut without loading GIS when sync is off', async () => {
    const loadGis = vi.fn()
    const { auth } = setup({ loadGis })
    await expect(auth.getAccessToken()).resolves.toEqual({ status: 'signedOut' })
    expect(loadGis).not.toHaveBeenCalled()
  })

  it('reuses a stored token with more than 60 s left, without GIS', async () => {
    const loadGis = vi.fn()
    const { auth } = setup({ stored: signedIn(NOW + TOKEN_MIN_REMAINING_MS + 1), loadGis })
    await expect(auth.getAccessToken()).resolves.toEqual({ status: 'ok', accessToken: TOKEN })
    expect(loadGis).not.toHaveBeenCalled()
  })

  it('renews a token with exactly 60 s left, silently (prompt none)', async () => {
    const oauth2 = fakeOAuth2((config) => config.callback({ access_token: 'new-token', expires_in: 3600 }))
    const { auth, store } = setup({ stored: signedIn(NOW + TOKEN_MIN_REMAINING_MS), oauth2 })
    await expect(auth.getAccessToken()).resolves.toEqual({ status: 'ok', accessToken: 'new-token' })
    expect(oauth2.requests).toEqual([{ prompt: 'none' }])
    expect(store.current).toMatchObject({ accessToken: 'new-token', expiresAt: NOW + 3_600_000 })
  })

  it('uses the consent prompt only when interactive', async () => {
    const oauth2 = fakeOAuth2()
    const { auth } = setup({ stored: signedIn(NOW - 1), oauth2 })
    await auth.getAccessToken({ interactive: true })
    expect(oauth2.requests).toEqual([{ prompt: '' }])
  })

  it('returns needsLogin (not an error) when the silent renewal fails', async () => {
    const oauth2 = fakeOAuth2((config) => config.error_callback({ type: 'popup_failed_to_open' }))
    const { auth, store } = setup({ stored: signedIn(NOW - 1), oauth2 })
    await expect(auth.getAccessToken()).resolves.toEqual({ status: 'needsLogin' })
    expect(store.current).toEqual({ enabled: true, accessToken: '', expiresAt: 0, needsLogin: true })
    await expect(auth.getStatus()).resolves.toBe('needsLogin')
  })

  it('returns needsLogin when the silent renewal never answers', async () => {
    vi.useFakeTimers()
    const { auth } = setup({ stored: signedIn(NOW - 1), oauth2: fakeOAuth2(() => {}) })
    const pending = auth.getAccessToken()
    await vi.advanceTimersByTimeAsync(SILENT_REQUEST_TIMEOUT_MS)
    await expect(pending).resolves.toEqual({ status: 'needsLogin' })
  })

  it('returns needsLogin when GIS cannot be loaded', async () => {
    const { auth } = setup({
      stored: signedIn(NOW - 1),
      loadGis: vi.fn().mockRejectedValue(new Error('offline')),
    })
    await expect(auth.getAccessToken()).resolves.toEqual({ status: 'needsLogin' })
  })

  it('stays signed out when 登出 happened while renewing', async () => {
    let fail
    const oauth2 = fakeOAuth2((config) => {
      fail = () => config.error_callback({ type: 'popup_closed' })
    })
    const { auth, store } = setup({ stored: signedIn(NOW - 1), oauth2 })
    const pending = auth.getAccessToken()
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
    await auth.signOut()
    fail()
    await expect(pending).resolves.toEqual({ status: 'signedOut' })
    expect(store.current.enabled).toBe(false)
  })
})

describe('review fixes', () => {
  // A GIS stub whose answers the test triggers by hand, per request.
  function manualOAuth2() {
    const pending = []
    const oauth2 = fakeOAuth2((config, options) => pending.push({ config, options }))
    oauth2.pending = pending
    oauth2.answer = (index, token = TOKEN) =>
      pending[index].config.callback({ access_token: token, expires_in: 3599 })
    oauth2.fail = (index) => pending[index].config.error_callback({ type: 'popup_closed' })
    return oauth2
  }

  // loadGis with a synchronous peek, like createGisLoader's.
  function readyLoader(oauth2) {
    const loadGis = vi.fn(async () => oauth2)
    loadGis.peek = () => oauth2
    return loadGis
  }

  it('a successful silent renewal does not undo a sign-out made meanwhile', async () => {
    const oauth2 = manualOAuth2()
    const { auth, store } = setup({ stored: signedIn(NOW - 1), oauth2 })
    const pending = auth.getAccessToken()
    await vi.waitFor(() => expect(oauth2.pending).toHaveLength(1))
    await auth.signOut()
    oauth2.answer(0, 'late-token')
    await expect(pending).resolves.toEqual({ status: 'signedOut' })
    expect(store.current).toEqual({ enabled: false, accessToken: '', expiresAt: 0, needsLogin: false })
    await expect(auth.getStatus()).resolves.toBe('signedOut')
  })

  it('a successful sign-in popup does not undo a sign-out made meanwhile', async () => {
    const oauth2 = manualOAuth2()
    const { auth, store } = setup({ oauth2 })
    const pending = auth.signIn()
    await vi.waitFor(() => expect(oauth2.pending).toHaveLength(1))
    await auth.signOut()
    oauth2.answer(0)
    await expect(pending).resolves.toEqual({ ok: false })
    expect(store.current.enabled).toBe(false)
  })

  it('a click never joins an in-flight silent renewal', async () => {
    const oauth2 = manualOAuth2()
    const { auth } = setup({ stored: { enabled: true, needsLogin: true }, oauth2 })
    const silent = auth.getAccessToken()
    await vi.waitFor(() => expect(oauth2.pending).toHaveLength(1))
    const click = auth.signIn()
    await vi.waitFor(() => expect(oauth2.pending).toHaveLength(2))
    expect(oauth2.pending.map((p) => p.options.prompt)).toEqual(['none', ''])
    oauth2.answer(1, 'clicked-token')
    await expect(click).resolves.toEqual({ ok: true })
    // The silent request fails afterwards: the fresh token is kept.
    oauth2.fail(0)
    await expect(silent).resolves.toEqual({ status: 'ok', accessToken: 'clicked-token' })
    await expect(auth.getStatus()).resolves.toBe('signedIn')
  })

  it('a silent renewal joins an in-flight sign-in click', async () => {
    const oauth2 = manualOAuth2()
    const { auth } = setup({ stored: { enabled: true, needsLogin: true }, oauth2 })
    const click = auth.signIn()
    const silent = auth.getAccessToken()
    await vi.waitFor(() => expect(oauth2.pending).toHaveLength(1))
    oauth2.answer(0)
    await expect(click).resolves.toEqual({ ok: true })
    await expect(silent).resolves.toEqual({ status: 'ok', accessToken: TOKEN })
    expect(oauth2.pending).toHaveLength(1)
  })

  it('calls requestAccessToken synchronously in signIn when GIS is loaded', () => {
    const oauth2 = fakeOAuth2()
    const { auth } = setup({ loadGis: readyLoader(oauth2) })
    auth.signIn()
    // No await yet: still inside the click's user gesture.
    expect(oauth2.requests).toEqual([{ prompt: '' }])
  })

  it('falls back to loading GIS when it is not loaded yet', async () => {
    const oauth2 = fakeOAuth2()
    const loadGis = vi.fn(async () => oauth2)
    loadGis.peek = () => null
    const { auth } = setup({ loadGis })
    await expect(auth.signIn()).resolves.toEqual({ ok: true })
    expect(loadGis).toHaveBeenCalled()
  })

  it('settles a sign-in when the token callback throws', async () => {
    const oauth2 = fakeOAuth2()
    oauth2.hasGrantedAllScopes.mockImplementation(() => {
      throw new Error('boom')
    })
    const { auth, store } = setup({ oauth2 })
    await expect(auth.signIn()).resolves.toEqual({ ok: false })
    expect(store.save).not.toHaveBeenCalled()
  })

  it('preload starts loading GIS and ignores failures', async () => {
    const loadGis = vi.fn().mockRejectedValue(new Error('offline'))
    const { auth } = setup({ loadGis })
    expect(() => auth.preload()).not.toThrow()
    expect(loadGis).toHaveBeenCalledTimes(1)
    const throwing = setup({ loadGis: vi.fn(() => { throw new Error('sync') }) })
    expect(() => throwing.auth.preload()).not.toThrow()
  })
})

describe('signOut', () => {
  it('clears the token and the flag, then revokes the token', async () => {
    const { auth, store, oauth2 } = setup({ stored: signedIn() })
    await auth.signOut()
    expect(store.current).toEqual({ enabled: false, accessToken: '', expiresAt: 0, needsLogin: false })
    expect(oauth2.revoke).toHaveBeenCalledWith(TOKEN, expect.any(Function))
    await expect(auth.getStatus()).resolves.toBe('signedOut')
  })

  it('does not call revoke without a token', async () => {
    const { auth, oauth2 } = setup({ stored: { enabled: true, needsLogin: true } })
    await auth.signOut()
    expect(oauth2.revoke).not.toHaveBeenCalled()
  })

  it('still signs out when revoking fails or GIS cannot load', async () => {
    const { auth, store } = setup({
      stored: signedIn(),
      loadGis: vi.fn().mockRejectedValue(new Error('offline')),
    })
    await expect(auth.signOut()).resolves.toBeUndefined()
    expect(store.current.enabled).toBe(false)
  })

  it('does not wait forever for a revoke callback', async () => {
    vi.useFakeTimers()
    const oauth2 = fakeOAuth2()
    oauth2.revoke.mockImplementation(() => {})
    const { auth } = setup({ stored: signedIn(), oauth2 })
    const pending = auth.signOut()
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).resolves.toBeUndefined()
  })
})

describe('onStatusChange', () => {
  it('reports sign-in, needsLogin and sign-out; unsubscribe stops it', async () => {
    const { auth } = setup()
    const listener = vi.fn()
    const off = auth.onStatusChange(listener)
    await auth.signIn()
    await auth.signOut()
    expect(listener.mock.calls).toEqual([['signedIn'], ['signedOut']])
    off()
    await auth.signIn()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('a throwing listener does not break sign-in', async () => {
    const { auth } = setup()
    auth.onStatusChange(() => {
      throw new Error('boom')
    })
    await expect(auth.signIn()).resolves.toEqual({ ok: true })
  })
})

describe('createGisLoader', () => {
  afterEach(() => {
    document.head.querySelectorAll('script').forEach((node) => node.remove())
  })

  it('uses an already present google.accounts.oauth2 without adding a script', async () => {
    const oauth2 = fakeOAuth2()
    const win = { google: { accounts: { oauth2 } } }
    await expect(createGisLoader({ win, doc: document })()).resolves.toBe(oauth2)
    expect(document.head.querySelector('script')).toBeNull()
  })

  it('adds the GIS script once and resolves when it has loaded', async () => {
    const win = {}
    const load = createGisLoader({ win, doc: document })
    const first = load()
    const second = load()
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].src).toBe(GIS_SCRIPT_URL)
    const oauth2 = fakeOAuth2()
    win.google = { accounts: { oauth2 } }
    scripts[0].onload()
    await expect(first).resolves.toBe(oauth2)
    await expect(second).resolves.toBe(oauth2)
  })

  it('rejects on a load error and tries again on the next call', async () => {
    const win = {}
    const load = createGisLoader({ win, doc: document })
    const first = load()
    document.head.querySelector('script').onerror()
    await expect(first).rejects.toThrow()
    load()
    expect(document.head.querySelectorAll('script')).toHaveLength(2)
  })

  it('peek returns the API only once it is loaded', () => {
    const win = {}
    const load = createGisLoader({ win, doc: document })
    expect(load.peek()).toBeNull()
    const oauth2 = fakeOAuth2()
    win.google = { accounts: { oauth2 } }
    expect(load.peek()).toBe(oauth2)
  })

  it('rejects when the script loads without the oauth2 API', async () => {
    const load = createGisLoader({ win: {}, doc: document })
    const pending = load()
    document.head.querySelector('script').onload()
    await expect(pending).rejects.toThrow()
  })
})
