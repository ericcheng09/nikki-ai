import { test, expect } from '@playwright/test'
import { SAMPLE_CONFIRM_MESSAGE, readStore } from './helpers.js'

// E2E for T6: the sample diary entry (spec 3.5, 4.1, 4.3).
// Each test runs in a fresh browser context, i.e. a "first launch".

const SAMPLE_CONTENT =
  '今日は友達と一緒に新しいカフェを行きました。店の中はとても静かで、コーヒーもおいしいでした。私はケーキを二つ食べましたから、お腹がいっぱいになりました。そのあと、公園を散歩しました。明日も早く起きるつもりです、でも少し疲れました。'

// Fragments that only appear in the stored AI analysis, never in the diary.
const ANALYSIS_ONLY_TEXT = ['カフェに行きました', 'おいしかったです', '今天和朋友', '早起きする']

const HOME_URL = /\/nikki-ai\/$/
const entryItems = (page) => page.locator('ul.entries > li')
const sampleItems = (page) =>
  entryItems(page).filter({ has: page.locator('.badge', { hasText: '範例' }) })

async function browserLocalDate(page) {
  return page.evaluate(() => {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
}

async function openHome(page) {
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
  // Wait until loading has finished (either entries or the empty message).
  await expect(page.locator('ul.entries, p.muted').first()).toBeVisible()
  await expect(page.getByText('載入中…')).toHaveCount(0)
}

async function openSample(page) {
  await sampleItems(page).getByRole('link').click()
  await expect(page.getByRole('heading', { level: 2, name: /範例日記/ })).toBeVisible()
}

// Clicks 刪除 on the sample page and answers the confirm dialog.
async function deleteSample(page, accept) {
  const messages = []
  page.once('dialog', (dialog) => {
    messages.push(`${dialog.type()}:${dialog.message()}`)
    if (accept) dialog.accept()
    else dialog.dismiss()
  })
  await page.getByRole('button', { name: '刪除' }).click()
  await expect.poll(() => messages).toEqual([`confirm:${SAMPLE_CONFIRM_MESSAGE}`])
}

async function expectSampleGone(page) {
  await expect(page.getByText(/還沒有日記/)).toBeVisible()
  await expect(entryItems(page)).toHaveCount(0)
  await expect(page.getByText('範例', { exact: true })).toHaveCount(0)
}

test.describe('sample entry', () => {
  test('first launch shows one sample entry labelled 範例, dated today', async ({ page }) => {
    await openHome(page)
    const today = await browserLocalDate(page)

    await expect(entryItems(page)).toHaveCount(1)
    const item = sampleItems(page)
    await expect(item).toHaveCount(1)
    await expect(item.locator('.badge')).toHaveText('範例')
    await expect(item.locator('time')).toHaveText(today)
    // The list shows an 80-character preview of the sample text.
    await expect(item.locator('.entry-preview')).toHaveText(
      `${Array.from(SAMPLE_CONTENT).slice(0, 80).join('')}…`,
    )

    // Stored record: a regular entry flagged as the sample.
    const entries = await readStore(page, 'entries')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      date: today,
      content: SAMPLE_CONTENT,
      language: 'auto',
      isSample: true,
      deleted: false,
      deletedAt: null,
    })
    expect(entries[0].analysis).not.toBeNull()
  })

  // At any instant at least one of these zones is on a different calendar
  // day than UTC, so a UTC-based sample date would fail in one of them.
  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    test.describe(`in timezone ${timezoneId}`, () => {
      test.use({ timezoneId })

      test('the sample is dated on the local calendar day', async ({ page }) => {
        await openHome(page)
        const before = await browserLocalDate(page)
        const shown = await sampleItems(page).locator('time').textContent()
        const after = await browserLocalDate(page)
        // Tolerate the (rare) case where the test straddles local midnight.
        expect([before, after]).toContain(shown)
      })
    })
  }

  test('the sample page is read-only and does not show the analysis', async ({ page }) => {
    await openHome(page)
    const today = await browserLocalDate(page)
    await openSample(page)

    await expect(page.locator('h2 .badge')).toHaveText('範例')
    await expect(page.getByText('這是一篇範例，只能閱讀或刪除，無法編輯。')).toBeVisible()
    await expect(page.locator('time')).toHaveText(today)
    await expect(page.getByText(SAMPLE_CONTENT)).toBeVisible()

    // No editing controls at all.
    await expect(page.locator('textarea')).toHaveCount(0)
    await expect(page.locator('input')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '儲存' })).toHaveCount(0)
    await expect(page.getByRole('button')).toHaveText(['刪除'])
    await expect(page.getByRole('link', { name: '返回列表' })).toBeVisible()

    // The stored AI analysis is not rendered (Phase 2 will add that view).
    const body = await page.locator('main').innerText()
    for (const text of ANALYSIS_ONLY_TEXT) expect(body).not.toContain(text)

    await page.getByRole('link', { name: '返回列表' }).click()
    await expect(page).toHaveURL(HOME_URL)
    await expect(sampleItems(page)).toHaveCount(1)
  })

  test('cancelling the delete confirmation keeps the sample', async ({ page }) => {
    await openHome(page)
    await openSample(page)
    await deleteSample(page, false)

    await expect(page.getByRole('heading', { level: 2, name: /範例日記/ })).toBeVisible()
    await expect(page.getByText(SAMPLE_CONTENT)).toBeVisible()
    const entries = await readStore(page, 'entries')
    expect(entries.filter((e) => e.isSample)).toHaveLength(1)
    expect((await readStore(page, 'settings')).sampleDismissed).not.toBe(true)

    await openHome(page)
    await expect(sampleItems(page)).toHaveCount(1)
  })

  test('deleting the sample removes it for good, with no tombstone left', async ({
    page,
    context,
  }) => {
    await openHome(page)
    const [{ id: sampleId }] = await readStore(page, 'entries')
    await openSample(page)
    await deleteSample(page, true)

    await expect(page).toHaveURL(HOME_URL)
    await expectSampleGone(page)

    // IndexedDB: no record at all for the sample id; sampleDismissed is set.
    expect(await readStore(page, 'entries')).toEqual([])
    expect(await readStore(page, 'settings')).toEqual({ sampleDismissed: true })

    // Reload: the sample is not seeded again.
    await page.reload()
    await expectSampleGone(page)

    // New tab in the same profile.
    const other = await context.newPage()
    await openHome(other)
    await expectSampleGone(other)

    // Opening its URL directly shows "not found".
    await other.goto(`./entry/${sampleId}`)
    await expect(other.getByText('找不到這篇日記')).toBeVisible()
    expect(await readStore(other, 'entries')).toEqual([])
  })

  test('the sample stays deleted after closing and reopening the browser', async ({ browser }) => {
    const first = await browser.newContext()
    const page = await first.newPage()
    await openHome(page)
    await openSample(page)
    await deleteSample(page, true)
    await expect(page).toHaveURL(HOME_URL)
    await expectSampleGone(page)
    const state = await first.storageState({ indexedDB: true })
    await first.close()

    const second = await browser.newContext({ storageState: state })
    const page2 = await second.newPage()
    await openHome(page2)
    await expectSampleGone(page2)
    expect(await readStore(page2, 'entries')).toEqual([])
    expect(await readStore(page2, 'settings')).toEqual({ sampleDismissed: true })
    await second.close()
  })

  test('opening the app in two tabs at once seeds only one sample', async ({ context }) => {
    const [a, b] = await Promise.all([context.newPage(), context.newPage()])
    await Promise.all([openHome(a), openHome(b)])
    await expect(sampleItems(a)).toHaveCount(1)
    await expect(sampleItems(b)).toHaveCount(1)
    await expect(entryItems(a)).toHaveCount(1)
    await expect(entryItems(b)).toHaveCount(1)

    await Promise.all([a.reload(), b.reload()])
    await expect(entryItems(a)).toHaveCount(1)
    await expect(entryItems(b)).toHaveCount(1)
    expect(await readStore(a, 'entries')).toHaveLength(1)
  })

  test('a new regular entry and the sample are both listed, later-written on top', async ({
    page,
  }) => {
    await openHome(page)
    const today = await browserLocalDate(page)

    await page.getByRole('link', { name: '新增日記' }).click()
    await page.getByLabel('內容').fill('My own first entry')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(HOME_URL)

    // Same date (today): the entry written after the sample comes first.
    await expect(entryItems(page)).toHaveCount(2)
    await expect(entryItems(page).locator('time')).toHaveText([today, today])
    await expect(entryItems(page).locator('.entry-preview').first()).toHaveText(
      'My own first entry',
    )
    await expect(entryItems(page).nth(0).locator('.badge')).toHaveCount(0)
    await expect(entryItems(page).nth(1).locator('.badge')).toHaveText('範例')

    // Deleting the sample leaves the regular entry untouched.
    await openSample(page)
    await deleteSample(page, true)
    await expect(page).toHaveURL(HOME_URL)
    await expect(entryItems(page)).toHaveCount(1)
    await expect(entryItems(page).locator('.entry-preview')).toHaveText('My own first entry')
    const entries = await readStore(page, 'entries')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ content: 'My own first entry', isSample: false, deleted: false })
  })

  test('no console output during the sample flow', async ({ page }) => {
    const messages = []
    page.on('console', (msg) => messages.push(msg.text()))
    await openHome(page)
    await openSample(page)
    await deleteSample(page, true)
    await expect(page).toHaveURL(HOME_URL)
    expect(messages.filter((m) => m.includes('カフェ') || m.includes('今天'))).toEqual([])
  })
})
