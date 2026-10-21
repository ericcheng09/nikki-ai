import {
  test,
  expect,
  HOME_URL,
  WELCOME_URL,
  startApp,
  writeStore,
  settingsIcon,
  guideIcon,
  installGisStub,
  createFakeDrive,
  signedInAuth,
  GOOGLE_TOKEN,
} from './helpers.js'

// E2E for V2: the privacy policy page and its links (decisions.md
// 隱私權政策). privacy.html is a static page in public/, outside the App
// routes: readable without JavaScript, no external resources, Chinese
// first and English after it. Links: the bottom of the welcome (說明)
// page, and the 「Google Drive 同步」 section of the settings page.
// Runs against both the dev server and the production build; the HTTP
// status of the deployed file is checked in deploy.spec.js.

const PRIVACY_URL = /\/nikki-ai\/privacy\.html(#.*)?$/
const ZH_TITLE = '隱私權政策：外語學習日記（nikki-ai）'
const EN_TITLE = 'Privacy Policy — nikki-ai (Foreign Language Diary)'
const ISSUES_URL = 'https://github.com/ericcheng09/nikki-ai/issues'

// The user-approved wording (V2 final text). A string is a list item; an
// array is an item with a heading and sub-items.
const ZH = {
  title: ZH_TITLE,
  updated: '最後更新：2026-10-21',
  items: [
    'App 是什麼：在瀏覽器裡執行的網頁 App，沒有開發者的伺服器，開發者收不到你的任何資料。',
    '資料存在哪裡：日記、語言清單和設定（包括 Gemini API key）存在你的瀏覽器。',
    [
      'Google 登入與 Drive：',
      '登入後，App 只要求 drive.appdata 權限，只能存取你 Google Drive 中這個 App 專屬的隱藏資料夾，看不到你的其他檔案。',
      'App 在那裡存一個同步檔，內容是日記（含 AI 批改結果與刪除記號）、語言清單、Gemini API key 和選擇的模型。',
      'App 不讀取你的姓名、email 或其他 Google 帳號資料。',
      'Google 存取權杖只存在你的瀏覽器，大約 1 小時後失效。',
    ],
    [
      'AI 批改：',
      '你按下「AI 批改」時，App 會把那一篇日記和你的 API key 直接送到 Google Gemini API。',
      '打開設定頁或儲存 API key 時，App 也會用你的 API key 向 Gemini API 查詢可用的模型，不會送出日記內容。',
      '這些資料依你 API key 所屬方案的 Google 條款處理。使用免費方案時，Google 可能把內容用來改善產品。',
    ],
    '不分享、不販售：不把資料分享或賣給任何人，不放廣告，不使用分析或追蹤工具。',
    'Google API 使用：App 使用 Google API 取得的資料，遵守 Google API Services User Data Policy，包括 Limited Use 的要求。',
    '網站主機：網站放在 GitHub Pages，GitHub 可能記錄存取紀錄（例如 IP），依 GitHub 的隱私權聲明處理。打開設定頁時，App 會從 Google 載入登入程式（Google Identity Services），Google 會收到這個請求。',
    [
      '如何刪除資料：',
      '本機資料：清除瀏覽器裡這個網站的資料。',
      '停止同步：在設定頁登出時，App 會嘗試撤銷授權；要確定移除，請到 Google 帳號的「第三方應用程式」頁面移除這個 App。',
      'Drive 上的同步檔：到 Google Drive 的「設定 → 管理應用程式」，刪除這個 App 的隱藏資料。',
    ],
    `聯絡方式：有問題請到 GitHub 開 Issue：${ISSUES_URL}`,
    '變更：內容更新時，修改本頁的「最後更新」日期。',
  ],
}

const EN = {
  title: EN_TITLE,
  updated: 'Last updated: 2026-10-21',
  items: [
    'What the app is: A web app that runs entirely in your browser. There is no developer server, and the developer never receives your data.',
    'Where data is stored: Your diary entries, language list and settings (including your Gemini API key) are stored in your browser.',
    'Google sign-in and Drive: After you sign in, the app requests only the drive.appdata scope. It can access only a hidden folder in your Google Drive that is private to this app, and cannot see any of your other files. The app stores one sync file there containing your diary entries (including AI review results and deletion markers), language list, Gemini API key and selected model. The app does not read your name, email address or any other Google account data. The Google access token is stored only in your browser and expires after about one hour.',
    'AI review: When you press "AI 批改" (AI review), the app sends that entry and your API key directly to the Google Gemini API. When you open the settings page or save your API key, the app also uses your API key to ask the Gemini API which models are available; no diary content is sent. This data is handled under the Google terms that apply to your API key\'s plan; on the free tier, Google may use the content to improve its products.',
    'No sharing or selling: Your data is never shared with or sold to anyone. There are no ads, analytics or tracking tools.',
    'Use of Google APIs: The app\'s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.',
    'Hosting: The site is hosted on GitHub Pages. GitHub may log access information (such as IP addresses) under the GitHub Privacy Statement. When you open the settings page, the app loads Google\'s sign-in library (Google Identity Services) from Google, so Google receives that request.',
    'Deleting your data: Local data: clear this site\'s data in your browser. To stop syncing: sign out in the settings page; the app will try to revoke access. To make sure access is removed, remove the app from the third-party apps page of your Google Account. Sync file on Drive: in Google Drive, go to Settings → Manage apps and delete this app\'s hidden data.',
    `Contact: Please open an issue on GitHub: ${ISSUES_URL}`,
    'Changes: When this policy changes, the "Last updated" date on this page will be updated.',
  ],
}

const syncSection = (page) => page.getByRole('region', { name: 'Google Drive 同步' })
const privacyLinks = (scope) => scope.getByRole('link', { name: '隱私權政策', exact: true })

// Reads a policy section from the DOM in the same shape as ZH / EN, with
// whitespace normalized.
function readSection(page, id) {
  return page.evaluate((sectionId) => {
    const norm = (s) => s.replace(/\s+/g, ' ').trim()
    const section = document.getElementById(sectionId)
    const items = [...section.querySelectorAll(':scope > ol > li')].map((li) => {
      const sub = li.querySelector(':scope > ul')
      if (!sub) return norm(li.textContent)
      const own = [...li.childNodes]
        .filter((n) => n !== sub)
        .map((n) => n.textContent)
        .join('')
      return [norm(own), ...[...sub.querySelectorAll(':scope > li')].map((s) => norm(s.textContent))]
    })
    return {
      title: norm(section.querySelector('h1').textContent),
      updated: norm(section.querySelector('.updated').textContent),
      items,
    }
  }, id)
}

async function expectPolicyPage(page) {
  await expect(page).toHaveURL(PRIVACY_URL)
  await expect(page).toHaveTitle('隱私權政策 - 外語學習日記')
  await expect(page.getByRole('heading', { level: 1, name: ZH_TITLE })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: EN_TITLE })).toBeVisible()
  await expect(page.getByRole('link', { name: '回到 App', exact: true })).toBeVisible()
}

// Signed-in browser with a GIS stub and a fake Drive (sync starts on
// app start); nothing reaches Google.
async function signIn(page, auth = signedInAuth()) {
  await installGisStub(page)
  const drive = createFakeDrive({ validTokens: [GOOGLE_TOKEN] })
  await drive.attach(page.context())
  await startApp(page)
  await writeStore(page, 'settings', { googleAuth: auth })
  await page.reload()
  await expect(page).toHaveURL(HOME_URL)
}

async function openSettings(page) {
  await settingsIcon(page).click()
  await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
}

test.describe('privacy policy links', () => {
  test('welcome (說明) page: link at the bottom opens the policy; 回到 App returns to the app', async ({
    page,
  }) => {
    await startApp(page)
    await guideIcon(page).click()
    await expect(page).toHaveURL(WELCOME_URL)
    const link = privacyLinks(page)
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('href', '/nikki-ai/privacy.html')
    await expect(link).not.toHaveAttribute('target')
    // Bottom of the page: the last thing in the welcome article.
    expect(
      await link.evaluate((a) => a.closest('article').lastElementChild.contains(a)),
    ).toBe(true)

    await link.click()
    await expectPolicyPage(page)
    await page.getByRole('link', { name: '回到 App', exact: true }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
  })

  test('first visit: 回到 App goes to the app, which shows the welcome page', async ({ page }) => {
    await page.goto('./privacy.html')
    await expectPolicyPage(page)
    await page.getByRole('link', { name: '回到 App', exact: true }).click()
    await expect(page).toHaveURL(WELCOME_URL)
  })

  test('settings, signed out: link at the end of the sync intro', async ({ page }) => {
    await startApp(page)
    await openSettings(page)
    const section = syncSection(page)
    await expect(section.getByRole('button', { name: '登入 Google', exact: true })).toBeVisible()
    const link = privacyLinks(section)
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('href', '/nikki-ai/privacy.html')
    await expect(link.locator('xpath=..')).toHaveText(
      '登入 Google 後，日記、語言清單、API key 與模型會同步到你 Google Drive 中只有這個 App 看得到的資料夾。詳見隱私權政策。',
    )
    // The only privacy link on the settings page.
    await expect(privacyLinks(page)).toHaveCount(1)

    await link.click()
    await expectPolicyPage(page)
    await page.getByRole('link', { name: '回到 App', exact: true }).click()
    await expect(page).toHaveURL(HOME_URL)
  })

  test('settings, signed in: link on its own line at the bottom of the section', async ({ page }) => {
    await signIn(page)
    await openSettings(page)
    const section = syncSection(page)
    await expect(section.getByText('已登入', { exact: true })).toBeVisible()
    const link = privacyLinks(section)
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('href', '/nikki-ai/privacy.html')
    await expect(link.locator('xpath=..')).toHaveText('隱私權政策')
    expect(await link.evaluate((a) => a.closest('section').lastElementChild.contains(a))).toBe(true)

    await link.click()
    await expectPolicyPage(page)
    await page.getByRole('link', { name: '回到 App', exact: true }).click()
    await expect(page).toHaveURL(HOME_URL)
  })

  test('settings, login expired: link at the bottom of the section', async ({ page }) => {
    await installGisStub(page, { mode: 'closed' })
    const drive = createFakeDrive({ validTokens: [GOOGLE_TOKEN] })
    await drive.attach(page.context())
    await startApp(page)
    await writeStore(page, 'settings', {
      googleAuth: { enabled: true, accessToken: '', expiresAt: 0, needsLogin: true },
    })
    await page.reload()
    await openSettings(page)
    const section = syncSection(page)
    await expect(section.getByRole('button', { name: '重新登入', exact: true })).toBeVisible()
    const link = privacyLinks(section)
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('href', '/nikki-ai/privacy.html')
    expect(await link.evaluate((a) => a.closest('section').lastElementChild.contains(a))).toBe(true)
  })

  test('settings cannot be read: no privacy link in the sync section', async ({ page }) => {
    await page.addInitScript(() => {
      IDBFactory.prototype.open = function open() {
        throw new DOMException('blocked for test', 'UnknownError')
      }
    })
    await page.goto('./settings')
    await expect(page.getByRole('heading', { level: 2, name: '設定' })).toBeVisible()
    const section = syncSection(page)
    await expect(section.getByRole('alert')).toBeVisible()
    await expect(privacyLinks(section)).toHaveCount(0)
  })
})

test.describe('privacy policy page', () => {
  test('content matches the approved text, Chinese first, English after', async ({ page }) => {
    await page.goto('./privacy.html')
    await expectPolicyPage(page)
    expect(await readSection(page, 'zh')).toEqual(ZH)
    expect(await readSection(page, 'en')).toEqual(EN)

    // Order and languages.
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('main > section')].map((s) => s.id),
    )
    expect(order).toEqual(['zh', 'en'])
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant')
    await expect(page.locator('section#en')).toHaveAttribute('lang', 'en')

    // Contact links point to GitHub Issues, one per language.
    await expect(page.locator(`a[href="${ISSUES_URL}"]`)).toHaveCount(2)
  })

  test('makes no request other than the page itself; loads no scripts', async ({ page }) => {
    const requests = []
    page.on('request', (request) => requests.push(request.url()))
    await page.goto('./privacy.html')
    await expectPolicyPage(page)
    await page.waitForLoadState('networkidle')
    // The browser may ask for /favicon.ico on its own; everything else is the page.
    const others = requests.filter((url) => !url.endsWith('/favicon.ico'))
    expect(others).toEqual([new URL('./privacy.html', page.url()).href.replace(/#.*$/, '')])
    expect(await page.locator('script, link[rel="stylesheet"], img, iframe').count()).toBe(0)
  })

  test('readable with JavaScript disabled', async ({ newContext, baseURL }) => {
    const context = await newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    const response = await page.goto(new URL('privacy.html', baseURL).href)
    expect(response.ok()).toBe(true)
    await expectPolicyPage(page)
    await expect(page.locator('section#zh > ol > li')).toHaveCount(10)
    await expect(page.locator('section#en > ol > li')).toHaveCount(10)
    await expect(page.locator('section#zh')).toContainText('不使用分析或追蹤工具')
    await expect(page.locator('section#en')).toContainText('There are no ads, analytics or tracking tools.')
    await context.close()
  })

  test('English link jumps to the English section', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('./privacy.html')
    const en = page.getByRole('heading', { level: 1, name: EN_TITLE })
    await expect(en).not.toBeInViewport()
    const english = page.getByRole('link', { name: 'English', exact: true })
    await expect(english).toHaveAttribute('href', '#en')
    await english.click()
    await expect(page).toHaveURL(/\/nikki-ai\/privacy\.html#en$/)
    await expect(en).toBeInViewport()

    // Opening the anchor directly works too.
    await page.goto('./privacy.html#en')
    await expect(en).toBeInViewport()
  })

  test('375px wide: no horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('./privacy.html')
    await expectPolicyPage(page)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
})
