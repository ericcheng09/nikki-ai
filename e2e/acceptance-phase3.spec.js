import { test, expect, startApp, readStore, backButton } from './helpers.js'

// Phase 3 acceptance (spec 8.3): one end-to-end path through the UI on a
// desktop and a mobile width. Entries are written through the editor; the
// calendar marks them, filters the list, keeps its state in the URL, and
// drops marks of deleted entries. No AI calls are involved.
//
// "Today" is pinned to 2026-10-18 local time so dates are deterministic.

const FIXED_NOW = new Date(2026, 9, 18, 10, 0, 0)
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const NEW_URL = /\/nikki-ai\/entry\/new$/
const homeUrl = (query = '') => new RegExp(`/nikki-ai/${query.replace(/[?]/g, '\\?')}$`)

const calendar = (page) => page.locator('section.calendar')
const list = (page) => page.locator('section.diary-list')
const grid = (page) => calendar(page).getByRole('table')
const title = (page) => calendar(page).getByRole('heading', { level: 2 })
const prevButton = (page) => calendar(page).getByRole('button', { name: '上個月', exact: true })
const todayButton = (page) => calendar(page).getByRole('button', { name: '今天', exact: true })
const day = (page, label) => grid(page).getByRole('button', { name: `${label}，有日記`, exact: true })
const dayButtons = (page) => grid(page).getByRole('button')
const plainDay = (page, n) => grid(page).locator('td', { hasText: new RegExp(`^${n}$`) })
const listHeading = (page) => list(page).getByRole('heading', { level: 2 })
const showAll = (page) => list(page).getByRole('button', { name: '顯示全部', exact: true })
const previews = (page) => page.locator('ul.entries > li .entry-preview')
const entryLink = (page, text) => page.locator('ul.entries > li', { hasText: text }).getByRole('link')

// Writes an entry through the editor and returns to the home page with 「←」.
// The fixed clock moves one minute per entry so createdAt values differ
// (same-day entries are ordered by createdAt).
let minutes = 0
async function writeEntry(page, date, content) {
  minutes += 1
  await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + minutes * 60_000))
  await list(page).getByRole('link', { name: '新增日記' }).click()
  await expect(page).toHaveURL(NEW_URL)
  await expect(page.getByLabel('日期')).toHaveValue('2026-10-18')
  await page.getByLabel('日期').fill(date)
  await page.getByLabel('內容').fill(content)
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page).toHaveURL(ENTRY_URL)
  await backButton(page).click()
}

async function deleteOpenEntry(page) {
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '刪除' }).click()
}

async function expectLayout(page, width) {
  const cal = await calendar(page).boundingBox()
  const lst = await list(page).boundingBox()
  if (width >= 768) {
    // Beside the list (left).
    expect(cal.x + cal.width).toBeLessThanOrEqual(lst.x)
    expect(Math.abs(cal.y - lst.y)).toBeLessThanOrEqual(1)
  } else {
    // Above the list.
    expect(cal.y + cal.height).toBeLessThanOrEqual(lst.y)
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

for (const width of [1280, 375]) {
  test(`Phase 3 acceptance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.clock.setFixedTime(FIXED_NOW)
    await startApp(page)

    // 8.3-1: the calendar is on the home page, beside or above the list.
    await expect(title(page)).toHaveText('2026 年 10 月')
    await expectLayout(page, width)
    await expect(dayButtons(page)).toHaveCount(0)

    // Write entries on two days (two on the 12th) and one last month.
    await writeEntry(page, '2026-10-05', 'Fifth of October')
    await writeEntry(page, '2026-10-12', 'Twelfth first')
    await writeEntry(page, '2026-10-12', 'Twelfth second')
    await writeEntry(page, '2026-09-20', 'September entry')
    await expect(page).toHaveURL(homeUrl())
    await expect(previews(page)).toHaveText([
      'Twelfth second',
      'Twelfth first',
      'Fifth of October',
      'September entry',
    ])

    // 8.3-2: marked days.
    await expect(dayButtons(page)).toHaveCount(2)
    await expect(day(page, '10月5日')).toBeVisible()
    await expect(day(page, '10月12日')).toBeVisible()
    await expectLayout(page, width)

    // 8.3-5: a day without entries does nothing.
    await plainDay(page, 6).click()
    await expect(page).toHaveURL(homeUrl())
    await expect(listHeading(page)).toHaveText('我的日記')
    await expect(previews(page)).toHaveCount(4)

    // 8.3-4: select a day, open an entry, 「←」 back to the filtered view.
    await day(page, '10月12日').click()
    const filtered = homeUrl('?month=2026-10&date=2026-10-12')
    await expect(page).toHaveURL(filtered)
    await expect(listHeading(page)).toHaveText('10月12日 的日記')
    await expect(previews(page)).toHaveText(['Twelfth second', 'Twelfth first'])
    await expect(day(page, '10月12日')).toHaveAttribute('aria-pressed', 'true')
    await entryLink(page, 'Twelfth first').click()
    await expect(page).toHaveURL(ENTRY_URL)
    await expect(page.getByLabel('內容')).toHaveValue('Twelfth first')
    await backButton(page).click()
    await expect(page).toHaveURL(filtered)
    await expect(previews(page)).toHaveText(['Twelfth second', 'Twelfth first'])

    // 8.3-6: deleting keeps the mark while the day has entries, then drops it.
    await entryLink(page, 'Twelfth first').click()
    await deleteOpenEntry(page)
    await expect(page).toHaveURL(filtered)
    await expect(previews(page)).toHaveText(['Twelfth second'])
    await expect(day(page, '10月12日')).toBeVisible()
    await entryLink(page, 'Twelfth second').click()
    await deleteOpenEntry(page)
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
    await expect(listHeading(page)).toHaveText('我的日記')
    await expect(day(page, '10月12日')).toHaveCount(0)
    await expect(plainDay(page, 12).getByRole('button')).toHaveCount(0)
    await expect(dayButtons(page)).toHaveCount(1)
    await expect(previews(page)).toHaveText(['Fifth of October', 'September entry'])
    const stored = await readStore(page, 'entries')
    expect(stored.filter((e) => e.deleted)).toHaveLength(2)
    expect(JSON.stringify(stored)).not.toContain('Twelfth')

    // 8.3-3: switch months; a day of last month can be selected and opened.
    await prevButton(page).click()
    await expect(title(page)).toHaveText('2026 年 9 月')
    await expect(page).toHaveURL(homeUrl('?month=2026-09'))
    await day(page, '9月20日').click()
    await expect(previews(page)).toHaveText(['September entry'])
    await entryLink(page, 'September entry').click()
    await expect(page.getByLabel('內容')).toHaveValue('September entry')
    await page.goBack()
    await expect(page).toHaveURL(homeUrl('?month=2026-09&date=2026-09-20'))

    // Reload keeps the month and the selected day.
    await page.reload()
    await expect(title(page)).toHaveText('2026 年 9 月')
    await expect(listHeading(page)).toHaveText('9月20日 的日記')
    await expect(previews(page)).toHaveText(['September entry'])
    await expect(day(page, '9月20日')).toHaveAttribute('aria-pressed', 'true')
    await expectLayout(page, width)

    // 顯示全部, then 今天 back to the current month; reload keeps it.
    await showAll(page).click()
    await expect(previews(page)).toHaveCount(2)
    await todayButton(page).click()
    await expect(title(page)).toHaveText('2026 年 10 月')
    await page.reload()
    await expect(page).toHaveURL(homeUrl('?month=2026-10'))
    await expect(title(page)).toHaveText('2026 年 10 月')
    await expect(dayButtons(page)).toHaveCount(1)
    await expect(day(page, '10月5日')).toBeVisible()
  })
}
