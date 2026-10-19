import {
  test,
  expect,
  startApp,
  readStore,
  writeStore,
  settingsIcon,
  installGeminiMock,
  GIS_SCRIPT_URL,
} from './helpers.js'

// E2E for Phase 4 T3: Google sign-in on the settings page (spec 3.6, 6,
// 8.4-2, 8.4-10; decisions.md Phase 4). Google Identity Services is
// replaced by a stub defined before the app loads (the app uses an
// existing window.google.accounts.oauth2 and adds no script). The global
// guard in helpers.js still aborts and fails any real request to
// accounts.google.com / googleapis.com.

const CLIENT_ID = '183657778897-o2qr69jd1khjror0fc0c5i7geh5eeltj.apps.googleusercontent.com'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const TOKEN = 'ya29.E2E-SECRET-TOKEN-0123456789'
const INTRO =
  '登入 Google 後，日記、語言清單、API key 與模型會同步到你 Google Drive 中只有這個 App 看得到的資料夾。'
const SIGN_IN_ERROR = '無法登入 Google，請再試一次。'
const EXPIRED = 'Google 登入已過期，請重新登入。'

const section = (page) => page.getByRole('region', { name: 'Google Drive 同步' })
const signInButton = (page) => section(page).getByRole('button', { name: '登入 Google', exact: true })
const reLoginButton = (page) => section(page).getByRole('button', { name: '重新登入', exact: true })
const signOutButton = (page) => section(page).getByRole('button', { name: '登出', exact: true })

// GIS stub. window.__gis.mode decides how the next token request ends:
// 'ok' | 'closed' (popup closed) | 'failed' (popup blocked) | 'denied'
// (error response) | 'noScope' (Drive permission unticked) | 'silent'
// (never answers). Calls are recorded in window.__gis.
function installGisStub(page, { token = TOKEN } = {}) {
  return page.addInitScript((accessToken) => {
    const gis = { mode: 'ok', inits: [], requests: [], revoked: [], held: [] }
    window.__gis = gis
    window.__gisAnswer = (index, outcome) => {
      const { config } = gis.held[index]
      if (outcome === 'ok') {
        config.callback({ access_token: accessToken, expires_in: 3599, scope: config.scope, token_type: 'Bearer' })
      } else {
        config.error_callback?.({ type: 'popup_closed' })
      }
    }
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient(config) {
            gis.inits.push({ client_id: config.client_id, scope: config.scope })
            return {
              requestAccessToken(options = {}) {
                gis.requests.push({ prompt: options.prompt })
                const mode = gis.mode
                if (mode === 'hold') {
                  // Answered later by window.__gisAnswer(index, outcome).
                  gis.held.push({ config, prompt: options.prompt })
                  return
                }
                setTimeout(() => {
                  if (mode === 'ok') {
                    config.callback({ access_token: accessToken, expires_in: 3599, scope: config.scope, token_type: 'Bearer' })
                  } else if (mode === 'noScope') {
                    config.callback({ access_token: accessToken, expires_in: 3599, scope: 'openid', token_type: 'Bearer' })
                  } else if (mode === 'denied') {
                    config.callback({ error: 'access_denied' })
                  } else if (mode === 'closed') {
                    config.error_callback?.({ type: 'popup_closed' })
                  } else if (mode === 'failed') {
                    config.error_callback?.({ type: 'popup_failed_to_open' })
                  }
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
  }, token)
}

const gis = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__gis, (k, v) => (k === 'config' ? undefined : v))))
const setMode = (page, mode) => page.evaluate((m) => (window.__gis.mode = m), mode)

async function openSettings(page) {
  await settingsIcon(page).click()
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
  await expect(section(page).getByRole('heading', { level: 3 })).toHaveText('Google Drive 同步')
}

async function expectSignedOut(page) {
  await expect(section(page).getByText(INTRO, { exact: true })).toBeVisible()
  await expect(signInButton(page)).toBeVisible()
  await expect(signOutButton(page)).toHaveCount(0)
  await expect(section(page).getByText('已登入', { exact: true })).toHaveCount(0)
}

async function expectSignedIn(page) {
  await expect(section(page).getByText('已登入', { exact: true })).toBeVisible()
  await expect(signOutButton(page)).toBeVisible()
  await expect(signInButton(page)).toHaveCount(0)
  await expect(section(page).getByText(INTRO)).toHaveCount(0)
}

async function storedAuth(page) {
  return (await readStore(page, 'settings')).googleAuth
}

// Records every console message and every request made by the page.
function watch(page) {
  const seen = { console: [], requests: [] }
  page.on('console', (msg) => seen.console.push(msg.text()))
  page.on('pageerror', (err) => seen.console.push(String(err)))
  page.on('request', async (request) => {
    seen.requests.push({
      url: request.url(),
      headers: JSON.stringify(await request.allHeaders()),
      body: request.postData() ?? '',
    })
  })
  return seen
}

test.describe('Google sign-in (settings)', () => {
  test('signed-out view; no Google request outside the settings page', async ({ page }) => {
    // No stub: the default GIS route in helpers.js answers the script
    // locally; any other Google request is caught by the guard.
    const seen = watch(page)
    const external = () => seen.requests.filter((r) => new URL(r.url).hostname !== 'localhost')
    await startApp(page)
    // Welcome and home pages, an entry page and the new-entry page: none.
    await writeStore(page, 'entries', [
      {
        id: 'e1',
        date: '2026-10-01',
        content: 'Entry',
        language: 'auto',
        createdAt: '2026-10-01T01:00:00.000Z',
        updatedAt: '2026-10-01T01:00:00.000Z',
        deleted: false,
        deletedAt: null,
        analysis: null,
      },
    ])
    for (const path of ['./', './entry/e1', './entry/new', './welcome', './']) {
      await page.goto(path)
      await expect(page.locator('main h2').first()).toBeVisible()
    }
    expect(external()).toEqual([])

    // The settings page preloads only the GIS script.
    await openSettings(page)
    await expectSignedOut(page)
    // The section comes after 語言清單.
    expect(await page.locator('section.settings h3').allTextContents()).toEqual([
      'Gemini API key',
      '語言清單',
      'Google Drive 同步',
    ])
    await expect.poll(() => external().length).toBeGreaterThan(0)
    await page.reload()
    await expectSignedOut(page)
    expect([...new Set(external().map((r) => r.url))]).toEqual([GIS_SCRIPT_URL])
    expect(external().every((r) => !r.headers.includes('authorization'))).toBe(true)
    expect(await storedAuth(page)).toBeUndefined()

    // Leaving settings does not request anything more.
    const count = external().length
    await page.goto('./')
    await expect(page.locator('main h2').first()).toBeVisible()
    expect(external()).toHaveLength(count)
  })

  test('sign-in without a working GIS (script loaded locally, empty): error, signed out', async ({ page }) => {
    await startApp(page)
    await openSettings(page)
    await signInButton(page).click()
    await expect(section(page).getByRole('alert')).toHaveText(SIGN_IN_ERROR)
    await expectSignedOut(page)
  })

  test('sign in: 已登入 + 登出, only drive.appdata, the agreed client ID', async ({ page }) => {
    await installGisStub(page)
    const seen = watch(page)
    await startApp(page)
    await openSettings(page)
    await expectSignedOut(page)
    expect((await gis(page)).inits).toEqual([])

    await signInButton(page).click()
    await expectSignedIn(page)
    await expect(signOutButton(page)).toBeFocused()
    const calls = await gis(page)
    expect(calls.inits).toEqual([{ client_id: CLIENT_ID, scope: DRIVE_SCOPE }])
    expect(calls.requests).toHaveLength(1)
    // The stub was used: no GIS script was added.
    expect(await page.locator('script[src*="accounts.google.com"]').count()).toBe(0)

    // No account information is shown.
    const text = await section(page).innerText()
    expect(text).not.toMatch(/@|帳號|account/i)

    const auth = await storedAuth(page)
    expect(auth).toMatchObject({ enabled: true, accessToken: TOKEN, needsLogin: false })
    expect(auth.expiresAt).toBeGreaterThan(Date.now() + 50 * 60 * 1000)

    // The token never leaks.
    expect(await page.locator('body').innerText()).not.toContain(TOKEN)
    expect(seen.console.join('\n')).not.toContain(TOKEN)
    for (const r of seen.requests) {
      expect(`${r.url} ${r.headers} ${r.body}`, r.url).not.toContain(TOKEN)
    }
    expect(seen.requests.every((r) => new URL(r.url).hostname === 'localhost')).toBe(true)
    // Local only: it is not part of the normal settings values shown anywhere else.
    expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain(TOKEN)
  })

  for (const [mode, label] of [
    ['closed', 'popup closed'],
    ['failed', 'popup blocked'],
    ['denied', 'access denied'],
    ['noScope', 'Drive permission not granted'],
  ]) {
    test(`sign-in failure (${label}): error and still signed out`, async ({ page }) => {
      await installGisStub(page)
      await startApp(page)
      await openSettings(page)
      await setMode(page, mode)
      await signInButton(page).click()
      await expect(section(page).getByRole('alert')).toHaveText(SIGN_IN_ERROR)
      await expectSignedOut(page)
      const auth = await storedAuth(page)
      expect(auth?.enabled ?? false).toBe(false)
      expect(auth?.accessToken ?? '').toBe('')

      // Trying again works.
      await setMode(page, 'ok')
      await signInButton(page).click()
      await expectSignedIn(page)
      await expect(section(page).getByRole('alert')).toHaveCount(0)
    })
  }

  test('reload keeps signed in without asking Google again', async ({ page }) => {
    await installGisStub(page)
    await startApp(page)
    await openSettings(page)
    await signInButton(page).click()
    await expectSignedIn(page)
    await page.reload()
    await expectSignedIn(page)
    await page.goto('./')
    await page.goto('./settings')
    await expectSignedIn(page)
    const calls = await gis(page)
    expect(calls.inits).toEqual([])
    expect(calls.requests).toEqual([])
  })

  test('sign out: revokes, keeps local data, back to signed out', async ({ page }) => {
    await installGisStub(page)
    // The stored API key makes the settings page query the model list.
    await installGeminiMock(page)
    await startApp(page)
    await writeStore(page, 'entries', [
      {
        id: 'keep',
        date: '2026-10-01',
        content: 'Keep me',
        language: '韓文',
        createdAt: '2026-10-01T01:00:00.000Z',
        updatedAt: '2026-10-01T01:00:00.000Z',
        deleted: false,
        deletedAt: null,
        analysis: null,
      },
    ])
    await writeStore(page, 'settings', {
      geminiApiKey: 'test-key-123',
      customLanguages: [{ name: '韓文', updatedAt: '2026-10-01T01:00:00.000Z', deleted: false, deletedAt: null }],
    })
    await page.reload()
    await openSettings(page)
    await signInButton(page).click()
    await expectSignedIn(page)
    const entriesBefore = await readStore(page, 'entries')
    const { googleAuth: _ignored, ...settingsBefore } = await readStore(page, 'settings')

    await signOutButton(page).click()
    await expectSignedOut(page)
    await expect(signInButton(page)).toBeFocused()
    await expect.poll(async () => (await gis(page)).revoked).toEqual([TOKEN])

    expect(await readStore(page, 'entries')).toEqual(entriesBefore)
    const { googleAuth, ...settingsAfter } = await readStore(page, 'settings')
    expect(settingsAfter).toEqual(settingsBefore)
    expect(settingsAfter.geminiApiKey).toBe('test-key-123')
    expect(googleAuth).toMatchObject({ enabled: false, accessToken: '', needsLogin: false })

    // Still signed out after a reload; the diary is still listed.
    await page.reload()
    await expectSignedOut(page)
    await page.goto('./')
    await expect(page.getByText('Keep me')).toBeVisible()
  })

  test('expired login: message, 重新登入 and 登出', async ({ page }) => {
    await installGisStub(page)
    await startApp(page)
    // State left by a failed silent renewal (getAccessToken -> needsLogin).
    // P4-T3 has no Drive request yet that would trigger the renewal from
    // the UI, so the state is seeded.
    await writeStore(page, 'settings', {
      googleAuth: { enabled: true, accessToken: '', expiresAt: 0, needsLogin: true },
    })
    await page.reload()
    await openSettings(page)
    await expect(section(page).getByText(EXPIRED, { exact: true })).toBeVisible()
    await expect(reLoginButton(page)).toBeVisible()
    await expect(signOutButton(page)).toBeVisible()
    await expect(section(page).getByText('已登入', { exact: true })).toHaveCount(0)

    // 重新登入 failing keeps the expired view.
    await setMode(page, 'closed')
    await reLoginButton(page).click()
    await expect(section(page).getByRole('alert')).toHaveText(SIGN_IN_ERROR)
    await expect(section(page).getByText(EXPIRED, { exact: true })).toBeVisible()

    // 重新登入 succeeding.
    await setMode(page, 'ok')
    await reLoginButton(page).click()
    await expectSignedIn(page)
    expect(await storedAuth(page)).toMatchObject({ enabled: true, accessToken: TOKEN, needsLogin: false })
  })

  test('expired login: 登出 signs out', async ({ page }) => {
    await installGisStub(page)
    await startApp(page)
    await writeStore(page, 'settings', {
      googleAuth: { enabled: true, accessToken: '', expiresAt: 0, needsLogin: true },
    })
    await page.reload()
    await openSettings(page)
    await signOutButton(page).click()
    await expectSignedOut(page)
    // Nothing to revoke without a token.
    expect((await gis(page)).revoked).toEqual([])
    await page.reload()
    await expectSignedOut(page)
  })

  test('the token is not part of the synced settings values', async ({ page }) => {
    await installGisStub(page)
    await startApp(page)
    await openSettings(page)
    await signInButton(page).click()
    await expectSignedIn(page)
    // The settings page's own data (API key section etc.) never shows it.
    await page.reload()
    expect(await page.locator('body').innerText()).not.toContain(TOKEN)
    expect(await page.locator('input').evaluateAll((els) => els.map((e) => e.value).join('|'))).not.toContain(TOKEN)
  })
})

// Silent renewals are started by Drive sync, which has no UI yet (P4-T5).
// On the dev server the app's own googleAuth module instance can be
// imported and driven directly; the production build has no such URL, so
// these run on dev only.
test.describe('Google sign-in: silent renewal races (dev server only)', () => {
  const EXPIRED_AUTH = { enabled: true, accessToken: 'old-expired', expiresAt: 1, needsLogin: false }

  async function setupRenewal(page, auth) {
    await installGisStub(page)
    await startApp(page)
    const isDev = await page.evaluate(() => Boolean(document.querySelector('script[src*="/@vite/client"]')))
    test.skip(!isDev, 'needs the dev server module graph')
    await writeStore(page, 'settings', { googleAuth: auth })
    await page.reload()
    await openSettings(page)
    await setMode(page, 'hold')
  }

  // Starts googleAuth.getAccessToken() (silent) in the page; the result is
  // stored in window.__renewal.
  async function startSilentRenewal(page) {
    await page.evaluate(async () => {
      const mod = await import('/nikki-ai/src/lib/googleAuth.js')
      window.__renewal = null
      mod.default.getAccessToken().then((r) => (window.__renewal = r))
    })
    await expect.poll(async () => (await gis(page)).requests).toEqual([{ prompt: 'none' }])
  }

  test('登出 during an in-flight silent renewal stays signed out', async ({ page }) => {
    await setupRenewal(page, EXPIRED_AUTH)
    await expectSignedIn(page)
    await startSilentRenewal(page)

    await signOutButton(page).click()
    await expectSignedOut(page)
    // The renewal now succeeds at Google, after the sign-out.
    await page.evaluate(() => window.__gisAnswer(0, 'ok'))
    await expect.poll(() => page.evaluate(() => window.__renewal)).toEqual({ status: 'signedOut' })
    await expectSignedOut(page)
    expect(await storedAuth(page)).toMatchObject({ enabled: false, accessToken: '', needsLogin: false })
    await page.reload()
    await expectSignedOut(page)
  })

  test('重新登入 during a silent renewal opens its own interactive request', async ({ page }) => {
    await setupRenewal(page, { enabled: true, accessToken: '', expiresAt: 0, needsLogin: true })
    await expect(reLoginButton(page)).toBeVisible()
    await startSilentRenewal(page)

    await reLoginButton(page).click()
    // Not joined to the silent request: a second, interactive one.
    await expect.poll(async () => (await gis(page)).requests).toEqual([{ prompt: 'none' }, { prompt: '' }])
    await page.evaluate(() => window.__gisAnswer(1, 'ok'))
    await expectSignedIn(page)

    // The silent one fails afterwards: the new token is kept, no 過期 view.
    await page.evaluate(() => window.__gisAnswer(0, 'fail'))
    await expect.poll(() => page.evaluate(() => window.__renewal)).toEqual({ status: 'ok', accessToken: TOKEN })
    await expectSignedIn(page)
    await expect(section(page).getByText(EXPIRED)).toHaveCount(0)
    expect(await storedAuth(page)).toMatchObject({ enabled: true, accessToken: TOKEN, needsLogin: false })
  })

  test('a failed silent renewal shows the expiry message live, as an alert', async ({ page }) => {
    await setupRenewal(page, EXPIRED_AUTH)
    await expectSignedIn(page)
    await startSilentRenewal(page)
    await page.evaluate(() => window.__gisAnswer(0, 'fail'))
    await expect.poll(() => page.evaluate(() => window.__renewal)).toEqual({ status: 'needsLogin' })
    await expect(section(page).getByRole('alert')).toHaveText(EXPIRED)
    await expect(reLoginButton(page)).toBeVisible()
    await expect(signOutButton(page)).toBeVisible()
    // After a reload it is shown, but not as an alert.
    await page.reload()
    await expect(section(page).getByText(EXPIRED, { exact: true })).toBeVisible()
    await expect(section(page).getByRole('alert')).toHaveCount(0)
  })
})
