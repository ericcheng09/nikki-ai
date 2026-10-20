import { test, expect, startApp, writeStore } from './helpers.js'

// E2E for the home list grouping (decisions.md 專案完成後的修改 →
// 主畫面列表分組): the full list is split into 今天 / 昨天 / month groups
// (titles with the year), empty groups never appear, every entry still
// shows its full YYYY-MM-DD date, the order is unchanged, and a selected
// calendar day is shown as one plain list without group headings.
//
// "Today" is pinned with Playwright's clock (local time), so the list's
// 今天/昨天 and the calendar's today agree and nothing depends on the date
// the tests run.

const FIXED_NOW = new Date(2026, 9, 18, 10, 0, 0) // 2026-10-18 local

const calendar = (page) => page.locator('section.calendar')
const grid = (page) => calendar(page).getByRole('table')
const calendarTitle = (page) => calendar(page).getByRole('heading', { level: 2 })
const day = (page, label) => grid(page).getByRole('button', { name: `${label}，有日記`, exact: true })
const list = (page) => page.locator('section.diary-list')
const listHeading = (page) => list(page).getByRole('heading', { level: 2 })
const groupTitles = (page) => list(page).getByRole('heading', { level: 3 })
const groups = (page) => list(page).locator('.entry-group')
const showAll = (page) => list(page).getByRole('button', { name: '顯示全部', exact: true })
const previews = (page) => list(page).locator('ul.entries > li .entry-preview')
const dates = (page) => list(page).locator('ul.entries > li time')
const groupList = (page, name) => list(page).getByRole('list', { name, exact: true })

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

// Seeded in shuffled order: the app must sort, not the store.
const ENTRIES = [
  entry('m2', '2026-10-05', 'Oct 5 only'),
  entry('t1', '2026-10-18', 'today morning', '2026-10-17T23:00:00.000Z'),
  entry('y', '2026-10-17', 'yesterday'),
  entry('p', '2026-09-30', 'Sep 30'),
  entry('m1', '2026-10-12', 'Oct 12'),
  entry('t2', '2026-10-18', 'today evening', '2026-10-18T00:30:00.000Z'),
  entry('x', '2025-12-31', 'last year Dec'),
  entry('p2', '2026-09-02', 'Sep 2'),
  // Soft-deleted entries never show and never create a group.
  { ...entry('del', '2026-08-15', 'deleted Aug'), deleted: true, deletedAt: '2026-08-16T00:00:00.000Z' },
]

const EXPECTED = [
  { title: '今天', items: ['today evening', 'today morning'], dates: ['2026-10-18', '2026-10-18'] },
  { title: '昨天', items: ['yesterday'], dates: ['2026-10-17'] },
  { title: '2026 年 10 月', items: ['Oct 12', 'Oct 5 only'], dates: ['2026-10-12', '2026-10-05'] },
  { title: '2026 年 9 月', items: ['Sep 30', 'Sep 2'], dates: ['2026-09-30', '2026-09-02'] },
  { title: '2025 年 12 月', items: ['last year Dec'], dates: ['2025-12-31'] },
]

async function setup(page, entries = ENTRIES, now = FIXED_NOW) {
  await page.clock.setFixedTime(now)
  await startApp(page)
  await writeStore(page, 'entries', entries)
  await page.reload()
  await expect(previews(page)).toHaveCount(entries.filter((e) => !e.deleted).length)
}

async function expectGroups(page, expected) {
  await expect(groupTitles(page)).toHaveText(expected.map((g) => g.title))
  await expect(groups(page)).toHaveCount(expected.length)
  for (const [i, g] of expected.entries()) {
    const group = groups(page).nth(i)
    await expect(group.getByRole('heading', { level: 3 })).toHaveText(g.title)
    await expect(group.locator('.entry-preview')).toHaveText(g.items)
    if (g.dates) await expect(group.locator('time')).toHaveText(g.dates)
  }
  // Overall order is the same as one flat list.
  await expect(previews(page)).toHaveText(expected.flatMap((g) => g.items))
}

test.describe('home list grouping', () => {
  test('groups 今天, 昨天, this month, last month and last year in order', async ({ page }) => {
    await setup(page)
    await expect(calendarTitle(page)).toHaveText('2026 年 10 月')
    await expect(listHeading(page)).toHaveText('我的日記')
    await expectGroups(page, EXPECTED)

    // Every entry keeps its full date (also as the machine-readable value).
    await expect(dates(page)).toHaveText(EXPECTED.flatMap((g) => g.dates))
    for (const d of await dates(page).all()) {
      await expect(d).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/)
    }
    await expect(list(page)).not.toContainText('deleted Aug')
    await expect(groupTitles(page).filter({ hasText: '8 月' })).toHaveCount(0)
  })

  test('group titles are h3 headings that name their lists', async ({ page }) => {
    await setup(page)
    for (const g of EXPECTED) {
      const heading = list(page).getByRole('heading', { level: 3, name: g.title, exact: true })
      await expect(heading).toHaveCount(1)
      const named = groupList(page, g.title)
      await expect(named).toHaveCount(1)
      await expect(named.getByRole('listitem')).toHaveCount(g.items.length)
      await expect(named.locator('.entry-preview')).toHaveText(g.items)
      // aria-labelledby points at the group's own heading.
      const id = await heading.getAttribute('id')
      expect(id).toBeTruthy()
      await expect(named).toHaveAttribute('aria-labelledby', id)
    }
    // Heading ids are unique on the page.
    const ids = await groupTitles(page).evaluateAll((els) => els.map((el) => el.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('empty groups do not appear (no entry today)', async ({ page }) => {
    await setup(page, ENTRIES.filter((e) => e.date !== '2026-10-18'))
    await expectGroups(page, EXPECTED.slice(1))
    await expect(list(page).getByRole('heading', { level: 3, name: '今天', exact: true })).toHaveCount(0)
  })

  test('empty groups do not appear (no entry yesterday or earlier this month)', async ({ page }) => {
    const entries = ENTRIES.filter((e) => !['2026-10-17', '2026-10-12', '2026-10-05'].includes(e.date))
    await setup(page, entries)
    await expectGroups(page, [EXPECTED[0], EXPECTED[3], EXPECTED[4]])
  })

  test('a single entry today gives a single 今天 group', async ({ page }) => {
    await setup(page, [entry('only', '2026-10-18', 'just one')])
    await expectGroups(page, [{ title: '今天', items: ['just one'], dates: ['2026-10-18'] }])
  })

  test('across New Year: 昨天 is Dec 31 and December carries the previous year', async ({ page }) => {
    const entries = [
      entry('n', '2027-01-01', 'new year'),
      entry('e', '2026-12-31', 'new year eve'),
      entry('d', '2026-12-20', 'Dec 20'),
      entry('o', '2026-10-18', 'Oct 18'),
    ]
    await setup(page, entries, new Date(2027, 0, 1, 9, 0, 0))
    await expect(calendarTitle(page)).toHaveText('2027 年 1 月')
    await expectGroups(page, [
      { title: '今天', items: ['new year'], dates: ['2027-01-01'] },
      { title: '昨天', items: ['new year eve'], dates: ['2026-12-31'] },
      { title: '2026 年 12 月', items: ['Dec 20'], dates: ['2026-12-20'] },
      { title: '2026 年 10 月', items: ['Oct 18'], dates: ['2026-10-18'] },
    ])
  })

  test('just after local midnight the new day is 今天', async ({ page }) => {
    await setup(
      page,
      [entry('a', '2026-10-18', 'Oct 18'), entry('b', '2026-10-17', 'Oct 17'), entry('c', '2026-10-16', 'Oct 16')],
      new Date(2026, 9, 18, 0, 5, 0),
    )
    await expectGroups(page, [
      { title: '今天', items: ['Oct 18'] },
      { title: '昨天', items: ['Oct 17'] },
      { title: '2026 年 10 月', items: ['Oct 16'] },
    ])
  })

  test('a future entry sorts first under its month (accepted edge case)', async ({ page }) => {
    await setup(page, [
      entry('f', '2026-10-25', 'future Oct 25'),
      entry('t', '2026-10-18', 'today'),
      entry('o', '2026-10-05', 'Oct 5'),
    ])
    await expectGroups(page, [
      { title: '2026 年 10 月', items: ['future Oct 25'], dates: ['2026-10-25'] },
      { title: '今天', items: ['today'] },
      { title: '2026 年 10 月', items: ['Oct 5'] },
    ])
  })

  test('a selected calendar day shows one plain list; 顯示全部 brings groups back', async ({ page }) => {
    await setup(page)
    await expectGroups(page, EXPECTED)

    await day(page, '10月18日').click()
    await expect(listHeading(page)).toHaveText('10月18日 的日記')
    await expect(groupTitles(page)).toHaveCount(0)
    await expect(groups(page)).toHaveCount(0)
    await expect(list(page).locator('ul.entries')).toHaveCount(1)
    await expect(previews(page)).toHaveText(['today evening', 'today morning'])
    await expect(dates(page)).toHaveText(['2026-10-18', '2026-10-18'])

    // Another day of this month: still no month heading.
    await day(page, '10月5日').click()
    await expect(listHeading(page)).toHaveText('10月5日 的日記')
    await expect(groupTitles(page)).toHaveCount(0)
    await expect(previews(page)).toHaveText(['Oct 5 only'])

    await showAll(page).click()
    await expect(listHeading(page)).toHaveText('我的日記')
    await expectGroups(page, EXPECTED)
  })

  test('opening the home page with a date in the URL shows no groups', async ({ page }) => {
    await setup(page)
    await page.goto('./?month=2026-10&date=2026-10-17')
    await expect(listHeading(page)).toHaveText('10月17日 的日記')
    await expect(previews(page)).toHaveText(['yesterday'])
    await expect(groupTitles(page)).toHaveCount(0)
  })

  for (const viewport of [
    { width: 375, height: 740 },
    { width: 1440, height: 900 },
  ]) {
    test(`layout at ${viewport.width}px: group titles visible, no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await setup(page)
      await expectGroups(page, EXPECTED)

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)

      for (let i = 0; i < EXPECTED.length; i += 1) {
        const group = groups(page).nth(i)
        const heading = group.getByRole('heading', { level: 3 })
        await heading.scrollIntoViewIfNeeded()
        await expect(heading).toBeVisible()
        await expect(heading).toBeInViewport()
        const h = await heading.boundingBox()
        const firstItem = await group.locator('ul.entries > li').first().boundingBox()
        const listBox = await list(page).boundingBox()
        // Heading sits above its own first entry, inside the list column.
        expect(h.y + h.height).toBeLessThanOrEqual(firstItem.y + 1)
        expect(h.x).toBeGreaterThanOrEqual(listBox.x - 1)
        expect(h.x + h.width).toBeLessThanOrEqual(listBox.x + listBox.width + 1)
        expect(h.height).toBeGreaterThan(0)
        // Single-line title (no wrapping of short titles like 「2026 年 10 月」).
        const lineHeight = await heading.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height)
        expect(h.height).toBeLessThan(lineHeight * 1.5 + 1)
        if (i > 0) {
          // Starts below the previous group's last entry (no overlap).
          const prevLast = await groups(page).nth(i - 1).locator('ul.entries > li').last().boundingBox()
          expect(h.y).toBeGreaterThanOrEqual(prevLast.y + prevLast.height)
        }
      }
    })
  }
})
