import { test, expect, startApp, readStore, writeStore, backButton, settingsIcon } from './helpers.js'

// E2E for Phase 3 T3: selecting a calendar day filters the diary list
// (spec 8.3-4; decisions.md Phase 3 日曆). The month and the selected day
// live in the URL (`/?month=YYYY-MM&date=YYYY-MM-DD`), always written with
// replace; 「←」 on entry pages returns to the previous in-app page.
//
// "Today" is pinned to 2026-10-18 local time with Playwright's clock.

const FIXED_NOW = new Date(2026, 9, 18, 10, 0, 0)

const calendar = (page) => page.locator('section.calendar')
const grid = (page) => calendar(page).getByRole('table')
const title = (page) => calendar(page).getByRole('heading', { level: 2 })
const prevButton = (page) => calendar(page).getByRole('button', { name: '上個月', exact: true })
const nextButton = (page) => calendar(page).getByRole('button', { name: '下個月', exact: true })
const todayButton = (page) => calendar(page).getByRole('button', { name: '今天', exact: true })
const day = (page, label) => grid(page).getByRole('button', { name: `${label}，有日記`, exact: true })
const list = (page) => page.locator('section.diary-list')
const listHeading = (page) => list(page).getByRole('heading', { level: 2 })
const showAll = (page) => list(page).getByRole('button', { name: '顯示全部', exact: true })
const previews = (page) => page.locator('ul.entries > li .entry-preview')
const entryLink = (page, text) => page.locator('ul.entries > li', { hasText: text }).getByRole('link')

const homeUrl = (query = '') => new RegExp(`/nikki-ai/${query.replace(/[?]/g, '\\?')}$`)
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const NEW_URL = /\/nikki-ai\/entry\/new$/

function entry(id, date, content, createdAt = `${date}T01:00:00.000Z`) {
  return {
    id,
    date,
    content,
    language: '日文',
    createdAt,
    updatedAt: createdAt,
    deleted: false,
    deletedAt: null,
    analysis: null,
  }
}

const ENTRIES = [
  entry('a1', '2026-10-05', 'Oct 5 morning', '2026-10-05T01:00:00.000Z'),
  entry('a2', '2026-10-05', 'Oct 5 evening', '2026-10-05T12:00:00.000Z'),
  entry('b', '2026-10-12', 'Oct 12 only'),
  entry('c', '2026-10-18', 'Oct 18 today'),
  entry('d', '2026-09-30', 'Sep 30 only'),
]
const FULL_ORDER = ['Oct 18 today', 'Oct 12 only', 'Oct 5 evening', 'Oct 5 morning', 'Sep 30 only']

async function setup(page, entries = ENTRIES) {
  await page.clock.setFixedTime(FIXED_NOW)
  await startApp(page)
  await writeStore(page, 'entries', entries)
  await page.reload()
  await expect(title(page)).toHaveText('2026 年 10 月')
  await expect(previews(page)).toHaveCount(entries.filter((e) => !e.deleted).length)
}

async function expectFullList(page) {
  await expect(listHeading(page)).toHaveText('我的日記')
  await expect(showAll(page)).toHaveCount(0)
  await expect(grid(page).locator('[aria-pressed="true"]')).toHaveCount(0)
}

async function expectFiltered(page, label, items) {
  await expect(listHeading(page)).toHaveText(`${label} 的日記`)
  await expect(showAll(page)).toBeVisible()
  await expect(previews(page)).toHaveText(items)
  await expect(grid(page).locator('[aria-pressed="true"]')).toHaveCount(1)
  await expect(day(page, label)).toHaveAttribute('aria-pressed', 'true')
}

const historyLength = (page) => page.evaluate(() => history.length)

test.describe('calendar selection: filtering (8.3-4)', () => {
  test('click a marked day filters the list; again or 顯示全部 shows all', async ({ page }) => {
    await setup(page)
    await expect(previews(page)).toHaveText(FULL_ORDER)
    await expectFullList(page)
    for (const label of ['10月5日', '10月12日', '10月18日']) {
      await expect(day(page, label)).toHaveAttribute('aria-pressed', 'false')
    }

    // Same order as the full list (createdAt desc within a day).
    await day(page, '10月5日').click()
    await expectFiltered(page, '10月5日', ['Oct 5 evening', 'Oct 5 morning'])
    await expect(day(page, '10月12日')).toHaveAttribute('aria-pressed', 'false')
    await expect(page).toHaveURL(homeUrl('?month=2026-10&date=2026-10-05'))

    // Clicking the selected day again shows the full list.
    await day(page, '10月5日').click()
    await expect(previews(page)).toHaveText(FULL_ORDER)
    await expectFullList(page)
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))

    // Switching directly from one day to another.
    await day(page, '10月12日').click()
    await expectFiltered(page, '10月12日', ['Oct 12 only'])
    await day(page, '10月18日').click()
    await expectFiltered(page, '10月18日', ['Oct 18 today'])
    await expect(page).toHaveURL(homeUrl('?month=2026-10&date=2026-10-18'))

    // 顯示全部.
    await showAll(page).click()
    await expect(previews(page)).toHaveText(FULL_ORDER)
    await expectFullList(page)
    // Focus moves to the list heading (the button itself is gone).
    await expect(listHeading(page)).toHaveText('我的日記')
    await expect(listHeading(page)).toBeFocused()
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
  })

  test('the selected day has its own (navy) style', async ({ page }) => {
    await setup(page)
    const bg = (label) => day(page, label).evaluate((el) => getComputedStyle(el).backgroundColor)
    const marked = await bg('10月5日')
    await day(page, '10月5日').click()
    await expect(day(page, '10月5日')).toHaveAttribute('aria-pressed', 'true')
    const selected = await bg('10月5日')
    expect(selected).not.toBe(marked)
    expect(await bg('10月12日')).toBe(marked)
    // Selected today keeps the today mark.
    await day(page, '10月18日').click()
    await expect(day(page, '10月18日')).toHaveAttribute('aria-pressed', 'true')
    await expect(day(page, '10月18日')).toHaveAttribute('aria-current', 'date')
    // The mouse is still over it: hover keeps the selected fill.
    expect(await bg('10月18日')).toBe(selected)
  })

  test('‹ › 今天 change the month and clear the selected day', async ({ page }) => {
    await setup(page)
    await day(page, '10月5日').click()
    await nextButton(page).click()
    await expect(title(page)).toHaveText('2026 年 11 月')
    await expect(page).toHaveURL(homeUrl('?month=2026-11'))
    await expect(previews(page)).toHaveText(FULL_ORDER)
    await expect(listHeading(page)).toHaveText('我的日記')

    await todayButton(page).click()
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
    await day(page, '10月12日').click()
    await prevButton(page).click()
    await expect(title(page)).toHaveText('2026 年 9 月')
    await expect(page).toHaveURL(homeUrl('?month=2026-09'))
    await expectFullList(page)

    // A day in another month; then 今天 clears it.
    await day(page, '9月30日').click()
    await expectFiltered(page, '9月30日', ['Sep 30 only'])
    await expect(page).toHaveURL(homeUrl('?month=2026-09&date=2026-09-30'))
    await todayButton(page).click()
    await expect(title(page)).toHaveText('2026 年 10 月')
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
    await expectFullList(page)
  })

  test('新增日記 keeps today as the default date with a selected day', async ({ page }) => {
    await setup(page)
    await day(page, '10月5日').click()
    await expectFiltered(page, '10月5日', ['Oct 5 evening', 'Oct 5 morning'])
    await list(page).getByRole('link', { name: '新增日記' }).click()
    await expect(page).toHaveURL(NEW_URL)
    await expect(page.getByLabel('日期')).toHaveValue('2026-10-18')
  })
})

test.describe('calendar selection: URL state', () => {
  test('selection and month changes replace the URL (no history steps)', async ({ page }) => {
    await setup(page)
    // An in-app page before home, to see where browser Back goes.
    await settingsIcon(page).click()
    await expect(page).toHaveURL(/\/settings$/)
    await backButton(page).click()
    await expect(page).toHaveURL(homeUrl())
    await expect(previews(page)).toHaveCount(5)
    const before = await historyLength(page)

    await day(page, '10月5日').click()
    await day(page, '10月12日').click()
    await prevButton(page).click()
    await day(page, '9月30日').click()
    await nextButton(page).click()
    await nextButton(page).click()
    await todayButton(page).click()
    await day(page, '10月18日').click()
    await showAll(page).click()
    await day(page, '10月5日').click()
    await expect(page).toHaveURL(homeUrl('?month=2026-10&date=2026-10-05'))
    expect(await historyLength(page)).toBe(before)

    // Browser Back leaves the home page instead of stepping through clicks.
    await page.goBack()
    await expect(page).not.toHaveURL(/\/nikki-ai\/(\?.*)?$/)
  })

  test('reload keeps the month and the selected day', async ({ page }) => {
    await setup(page)
    await prevButton(page).click()
    await day(page, '9月30日').click()
    await page.reload()
    await expect(page).toHaveURL(homeUrl('?month=2026-09&date=2026-09-30'))
    await expect(title(page)).toHaveText('2026 年 9 月')
    await expectFiltered(page, '9月30日', ['Sep 30 only'])

    // Month only.
    await nextButton(page).click()
    await nextButton(page).click()
    await page.reload()
    await expect(title(page)).toHaveText('2026 年 11 月')
    await expect(page).toHaveURL(homeUrl('?month=2026-11'))
    await expect(previews(page)).toHaveText(FULL_ORDER)
  })

  test('「←」 and browser Back from an entry return to the filtered view', async ({ page }) => {
    await setup(page)
    await day(page, '10月5日').click()
    const filtered = homeUrl('?month=2026-10&date=2026-10-05')
    await expect(page).toHaveURL(filtered)

    await entryLink(page, 'Oct 5 morning').click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(page.getByLabel('內容')).toHaveValue('Oct 5 morning')
    await backButton(page).click()
    await expect(page).toHaveURL(filtered)
    await expectFiltered(page, '10月5日', ['Oct 5 evening', 'Oct 5 morning'])

    await entryLink(page, 'Oct 5 evening').click()
    await expect(page).toHaveURL(ENTRY_URL)
    await page.goBack()
    await expect(page).toHaveURL(filtered)
    await expectFiltered(page, '10月5日', ['Oct 5 evening', 'Oct 5 morning'])

    // Entry -> settings -> 「←」 -> entry -> 「←」 -> filtered home.
    await entryLink(page, 'Oct 5 evening').click()
    await settingsIcon(page).click()
    await expect(page).toHaveURL(/\/settings$/)
    await backButton(page).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await backButton(page).click()
    await expect(page).toHaveURL(filtered)
    await expectFiltered(page, '10月5日', ['Oct 5 evening', 'Oct 5 morning'])

    // Settings opened from the filtered home returns there too.
    await settingsIcon(page).click()
    await backButton(page).click()
    await expect(page).toHaveURL(filtered)

    // A month-only view (another month) is kept the same way.
    await prevButton(page).click()
    await expect(page).toHaveURL(homeUrl('?month=2026-09'))
    await entryLink(page, 'Oct 12 only').click()
    await backButton(page).click()
    await expect(page).toHaveURL(homeUrl('?month=2026-09'))
    await expect(title(page)).toHaveText('2026 年 9 月')
  })
})

test.describe('calendar selection: URL fixing', () => {
  const cases = [
    ['?month=2026-13', '', '2026 年 10 月'],
    ['?month=abc', '', '2026 年 10 月'],
    ['?month=2026-9', '', '2026 年 10 月'],
    ['?month=2026-08', '?month=2026-08', '2026 年 8 月'],
    ['?month=2026-09&date=2026-02-30', '?month=2026-09', '2026 年 9 月'],
    ['?month=2026-09&date=2026-9-30', '?month=2026-09', '2026 年 9 月'],
    ['?month=bad&date=bad', '', '2026 年 10 月'],
    // Valid date without an entry: dropped.
    ['?date=2026-10-06', '', '2026 年 10 月'],
    // Date without month: month added; a mismatching month follows the date.
    ['?date=2026-10-05', '?month=2026-10&date=2026-10-05', '2026 年 10 月'],
    ['?month=2026-01&date=2026-09-30', '?month=2026-09&date=2026-09-30', '2026 年 9 月'],
    ['?month=2026-13&date=2026-09-30', '?month=2026-09&date=2026-09-30', '2026 年 9 月'],
  ]

  test('invalid or entry-less values are dropped, a missing month is added', async ({ page }) => {
    await setup(page)
    for (const [query, expected, heading] of cases) {
      await page.goto(`./${query}`)
      await expect(page, query).toHaveURL(homeUrl(expected))
      await expect(title(page), query).toHaveText(heading)
      if (expected.includes('date=')) {
        await expect(listHeading(page), query).not.toHaveText('我的日記')
      } else {
        await expect(previews(page), query).toHaveText(FULL_ORDER)
        await expectFullList(page)
      }
    }
  })

  // Separate case: the month given with an entry-less date should stay
  // (resolveHomeQuery keeps it once the entries are known).
  test('a valid date without entries is dropped and the given month kept', async ({ page }) => {
    await setup(page)
    await page.goto('./?month=2026-09&date=2026-10-06')
    await expect(page).toHaveURL(homeUrl('?month=2026-09'))
    await expect(title(page)).toHaveText('2026 年 9 月')
    await expectFullList(page)
  })

  test('a selected day whose only entry is deleted is dropped', async ({ page }) => {
    await setup(page, [
      ...ENTRIES,
      // A day with only a tombstone (dated, defensive) is not selectable.
      {
        ...entry('t', '2026-10-07', 'Deleted'),
        deleted: true,
        deletedAt: '2026-10-08T00:00:00.000Z',
        updatedAt: '2026-10-08T00:00:00.000Z',
      },
    ])
    await page.goto('./?month=2026-10&date=2026-10-07')
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
    await expectFullList(page)

    // Delete the only entry of the selected day through the UI: the app
    // goes back to the filtered home URL, where the day is now dropped.
    await day(page, '10月12日').click()
    await expect(page).toHaveURL(homeUrl('?month=2026-10&date=2026-10-12'))
    await entryLink(page, 'Oct 12 only').click()
    await expect(page).toHaveURL(ENTRY_URL)
    const lengthBefore = await historyLength(page)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '刪除' }).click()
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
    await expect(previews(page)).toHaveCount(4)
    await expectFullList(page)
    await expect(grid(page).locator('td', { hasText: /^12$/ }).getByRole('button')).toHaveCount(0)
    // No extra history entry.
    expect(await historyLength(page)).toBe(lengthBefore)

    // Back leaves this home URL normally (to the page opened before it).
    await page.goBack()
    await expect(page).toHaveURL(homeUrl())
    await expect(page.getByText('找不到這篇日記')).toHaveCount(0)
    // The deleted entry is only reachable via Forward.
    await page.goForward()
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
    await page.goForward()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(page.getByText('找不到這篇日記')).toBeVisible()
    // Opening it directly does the same.
    await page.goto('./?month=2026-10&date=2026-10-12')
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
    await expectFullList(page)
    expect((await readStore(page, 'entries')).find((e) => e.id === 'b').deleted).toBe(true)
  })
})

test.describe('「←」 on /entry/new', () => {
  test('opened inside the app: returns to the previous page', async ({ page }) => {
    await setup(page)
    await day(page, '10月5日').click()
    const filtered = homeUrl('?month=2026-10&date=2026-10-05')
    await list(page).getByRole('link', { name: '新增日記' }).click()
    await expect(page).toHaveURL(NEW_URL)
    await backButton(page).click()
    await expect(page).toHaveURL(filtered)
    await expectFiltered(page, '10月5日', ['Oct 5 evening', 'Oct 5 morning'])

    // Saved inside the app (replaced by /entry/:id): still back to home.
    await list(page).getByRole('link', { name: '新增日記' }).click()
    await page.getByLabel('內容').fill('Written from filtered view')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await backButton(page).click()
    await expect(page).toHaveURL(filtered)
    await expectFiltered(page, '10月5日', ['Oct 5 evening', 'Oct 5 morning'])
    await showAll(page).click()
    await expect(previews(page)).toHaveCount(6)
  })

  test('opened directly: 「←」 goes home, also after saving', async ({ page }) => {
    await setup(page)
    await page.goto('./entry/new')
    await expect(page).toHaveURL(NEW_URL)
    await backButton(page).click()
    await expect(page).toHaveURL(homeUrl())
    await expect(listHeading(page)).toHaveText('我的日記')

    await page.goto('./entry/new')
    await page.getByLabel('內容').fill('Saved after direct open')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page).toHaveURL(ENTRY_URL)
    await backButton(page).click()
    // Stays in the app.
    await expect(page).toHaveURL(homeUrl())
    await expect(listHeading(page)).toHaveText('我的日記')
    await expect(previews(page)).toHaveCount(6)

    // Same for an entry page opened directly.
    await page.goto('./entry/b')
    await expect(page.getByLabel('內容')).toHaveValue('Oct 12 only')
    await backButton(page).click()
    await expect(page).toHaveURL(homeUrl())
  })
})

test.describe('deleting from the calendar views', () => {
  test('delete from a filtered view: day still has entries, view kept', async ({ page }) => {
    await setup(page)
    await day(page, '10月5日').click()
    const filtered = homeUrl('?month=2026-10&date=2026-10-05')
    await expect(page).toHaveURL(filtered)
    await entryLink(page, 'Oct 5 morning').click()
    await expect(page).toHaveURL(ENTRY_URL)
    const lengthBefore = await historyLength(page)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '刪除' }).click()
    await expect(page).toHaveURL(filtered)
    await expectFiltered(page, '10月5日', ['Oct 5 evening'])
    expect(await historyLength(page)).toBe(lengthBefore)
  })

  test('delete of an entry opened directly: home, Back skips the deleted entry', async ({ page }) => {
    await setup(page)
    await page.goto('./entry/b')
    await expect(page.getByLabel('內容')).toHaveValue('Oct 12 only')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '刪除' }).click()
    await expect(page).toHaveURL(homeUrl())
    await expect(listHeading(page)).toHaveText('我的日記')
    await expect(previews(page)).toHaveText(FULL_ORDER.filter((t) => t !== 'Oct 12 only'))

    await page.goBack()
    await expect(page).not.toHaveURL(/\/entry\//)
    await expect(page.getByText('找不到這篇日記')).toHaveCount(0)
  })
})

test.describe('顯示全部 pressed right as the page opens', () => {
  // Regression for the early-click focus bug: 顯示全部 pressed in the same
  // task that first renders the list (before React's mount effects run)
  // used to lose the focus request. A MutationObserver clicks the button
  // synchronously the moment it is inserted, which reproduces that timing
  // deterministically.
  test('focus still moves to the 我的日記 heading', async ({ page }) => {
    await setup(page)
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('e2e-early-click')) return
      sessionStorage.removeItem('e2e-early-click')
      const observer = new MutationObserver(() => {
        const button = [...document.querySelectorAll('section.diary-list button')].find(
          (b) => b.textContent.trim() === '顯示全部',
        )
        if (!button) return
        observer.disconnect()
        window.__earlyClick = { listItems: document.querySelectorAll('ul.entries > li').length }
        button.click()
      })
      observer.observe(document, { childList: true, subtree: true })
    })
    await page.evaluate(() => sessionStorage.setItem('e2e-early-click', '1'))
    await page.goto('./?month=2026-10&date=2026-10-12')

    // The click happened before the entries were even shown.
    await expect.poll(() => page.evaluate(() => window.__earlyClick)).toEqual({ listItems: 0 })
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
    await expect(previews(page)).toHaveText(FULL_ORDER)
    await expectFullList(page)
    await expect(listHeading(page)).toBeFocused()
  })
})
