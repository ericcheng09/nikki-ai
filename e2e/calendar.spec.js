import { test, expect, startApp, readStore, writeStore, HOME_URL } from './helpers.js'

// E2E for Phase 3 T2: the calendar on the home page (spec 3.3, 8.3-1, 2,
// 3, 5, 6; decisions.md Phase 3 日曆). Date selection / list filtering is
// the next task and not covered here.
//
// "Today" is pinned with Playwright's clock (setFixedTime keeps timers
// running, only Date is fixed) to 2026-10-18 local time, so month titles
// and weekday positions are deterministic. One test runs on the real clock
// to check the default month and the today mark without pinning.

const FIXED_NOW = new Date(2026, 9, 18, 10, 0, 0) // 2026-10-18 10:00 local

const calendar = (page) => page.locator('section.calendar')
const list = (page) => page.locator('section.diary-list')
const grid = (page) => calendar(page).getByRole('table')
const title = (page) => calendar(page).getByRole('heading', { level: 2 })
const prevButton = (page) => calendar(page).getByRole('button', { name: '上個月', exact: true })
const nextButton = (page) => calendar(page).getByRole('button', { name: '下個月', exact: true })
const todayButton = (page) => calendar(page).getByRole('button', { name: '今天', exact: true })
const dayButtons = (page) => grid(page).getByRole('button')
const entryItems = (page) => page.locator('ul.entries > li')

function entry(id, date, content, extra = {}) {
  return {
    id,
    date,
    content,
    language: '日文',
    createdAt: `${date}T01:00:00.000Z`,
    updatedAt: `${date}T01:00:00.000Z`,
    deleted: false,
    deletedAt: null,
    analysis: null,
    ...extra,
  }
}

// Pins the clock, passes the welcome page and seeds `entries` (if any).
async function setup(page, entries = []) {
  await page.clock.setFixedTime(FIXED_NOW)
  await startApp(page)
  if (entries.length) {
    await writeStore(page, 'entries', entries)
    await page.reload()
  }
  await expect(title(page)).toHaveText('2026 年 10 月')
}

async function expectNoPageOverflow(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
}

// The grid as rows of cell texts ('' for blank cells).
async function gridTexts(page) {
  return grid(page)
    .locator('tbody tr')
    .evaluateAll((rows) => rows.map((r) => [...r.cells].map((c) => c.textContent.trim())))
}

test.describe('home calendar: layout (8.3-1)', () => {
  test('from 768px: 1120px page, 320px calendar column on the left', async ({ page }) => {
    await setup(page, [entry('a', '2026-10-05', 'Layout entry')])
    await expect(entryItems(page)).toHaveCount(1)
    for (const width of [1280, 768]) {
      await page.setViewportSize({ width, height: 900 })
      const app = await page.locator('.app').boundingBox()
      expect(app.width, `${width}`).toBe(Math.min(1120, width))
      const cal = await calendar(page).boundingBox()
      const lst = await list(page).boundingBox()
      expect(cal.width, `${width}`).toBe(320)
      expect(cal.x + cal.width, `${width}`).toBeLessThanOrEqual(lst.x)
      // Side by side: tops aligned.
      expect(Math.abs(cal.y - lst.y), `${width}`).toBeLessThanOrEqual(1)
      await expectNoPageOverflow(page)
    }
  })

  for (const width of [767, 375, 320]) {
    test(`below 768px (${width}): calendar above the list, no overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await setup(page, [entry('a', '2026-10-05', 'Layout entry')])
      await expect(entryItems(page)).toHaveCount(1)
      const cal = await calendar(page).boundingBox()
      const lst = await list(page).boundingBox()
      expect(cal.y + cal.height).toBeLessThanOrEqual(lst.y)
      expect(Math.abs(cal.x - lst.x)).toBeLessThanOrEqual(1)
      expect(cal.x).toBeGreaterThanOrEqual(0)
      expect(cal.x + cal.width).toBeLessThanOrEqual(width)
      // Every calendar element stays inside the viewport horizontally.
      const outside = await calendar(page).evaluate((root, w) => {
        const bad = []
        for (const el of root.querySelectorAll('*')) {
          const b = el.getBoundingClientRect()
          if (b.width && (b.left < 0 || b.right > w)) bad.push(el.tagName)
        }
        return bad
      }, width)
      expect(outside).toEqual([])
      await expectNoPageOverflow(page)
    })
  }

  test('DOM order is calendar, then list', async ({ page }) => {
    await setup(page)
    const calendarFirst = await page.evaluate(() => {
      const c = document.querySelector('section.calendar')
      const l = document.querySelector('section.diary-list')
      return Boolean(c.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(calendarFirst).toBe(true)
  })
})

test.describe('home calendar: header and month switching (8.3-3)', () => {
  test('starts at the current month; ‹ › 今天 switch months', async ({ page }) => {
    await setup(page)
    await expect(prevButton(page)).toHaveText('‹')
    await expect(nextButton(page)).toHaveText('›')
    await prevButton(page).click()
    await expect(title(page)).toHaveText('2026 年 9 月')
    await nextButton(page).click()
    await nextButton(page).click()
    await expect(title(page)).toHaveText('2026 年 11 月')
    await todayButton(page).click()
    await expect(title(page)).toHaveText('2026 年 10 月')
    // 今天 on the current month is a no-op.
    await todayButton(page).click()
    await expect(title(page)).toHaveText('2026 年 10 月')
    // The shown month is kept in the URL (P3-T3).
    await expect(page).toHaveURL(/\/nikki-ai\/\?month=2026-10$/)
  })

  test('switching across years: Dec -> Jan and Jan -> Dec', async ({ page }) => {
    await setup(page)
    await nextButton(page).click()
    await nextButton(page).click()
    await expect(title(page)).toHaveText('2026 年 12 月')
    await nextButton(page).click()
    await expect(title(page)).toHaveText('2027 年 1 月')
    await prevButton(page).click()
    await expect(title(page)).toHaveText('2026 年 12 月')

    await todayButton(page).click()
    for (let i = 0; i < 9; i++) await prevButton(page).click()
    await expect(title(page)).toHaveText('2026 年 1 月')
    await prevButton(page).click()
    await expect(title(page)).toHaveText('2025 年 12 月')
    await nextButton(page).click()
    await expect(title(page)).toHaveText('2026 年 1 月')
    // 今天 from another year.
    await prevButton(page).click()
    await todayButton(page).click()
    await expect(title(page)).toHaveText('2026 年 10 月')
  })
})

test.describe('home calendar: grid', () => {
  test('semantic table, Sunday first, blanks outside the month', async ({ page }) => {
    await setup(page)
    await expect(grid(page).getByRole('columnheader')).toHaveText(['日', '一', '二', '三', '四', '五', '六'])
    // October 2026 starts on Thursday and has 31 days.
    expect(await gridTexts(page)).toEqual([
      ['', '', '', '', '1', '2', '3'],
      ['4', '5', '6', '7', '8', '9', '10'],
      ['11', '12', '13', '14', '15', '16', '17'],
      ['18', '19', '20', '21', '22', '23', '24'],
      ['25', '26', '27', '28', '29', '30', '31'],
    ])
    // February 2026: starts on Sunday, exactly four rows.
    for (let i = 0; i < 8; i++) await prevButton(page).click()
    await expect(title(page)).toHaveText('2026 年 2 月')
    expect(await gridTexts(page)).toEqual([
      ['1', '2', '3', '4', '5', '6', '7'],
      ['8', '9', '10', '11', '12', '13', '14'],
      ['15', '16', '17', '18', '19', '20', '21'],
      ['22', '23', '24', '25', '26', '27', '28'],
    ])
  })

  test('each day sits under its weekday for several months', async ({ page }) => {
    await setup(page)
    // Check 2025-11 .. 2027-02 against the browser's own Date weekday.
    for (let i = 0; i < 11; i++) await prevButton(page).click()
    await expect(title(page)).toHaveText('2025 年 11 月')
    for (let step = 0; step < 16; step++) {
      const y = 2025 + Math.floor((10 + step) / 12)
      const m = ((10 + step) % 12) + 1
      const heading = `${y} 年 ${m} 月`
      // Wait for the re-render before reading the grid.
      await expect(title(page)).toHaveText(heading)
      const rows = await gridTexts(page)
      const days = []
      for (const row of rows) {
        row.forEach((text, col) => {
          if (text) days.push([Number(text), col])
        })
      }
      const lastDay = new Date(y, m, 0).getDate()
      expect(days.map(([d]) => d), heading).toEqual(Array.from({ length: lastDay }, (_, i) => i + 1))
      for (const [d, col] of days) expect(col, `${heading} ${d}`).toBe(new Date(y, m - 1, d).getDay())
      await nextButton(page).click()
    }
  })
})

test.describe('home calendar: entry marks (8.3-2, 5, 6)', () => {
  test('days with entries are marked buttons; others are plain text', async ({ page }) => {
    await setup(page, [
      entry('a', '2026-10-05', 'First'),
      entry('b', '2026-10-05', 'Second same day'),
      entry('c', '2026-10-18', 'Today entry'),
      entry('d', '2026-09-30', 'September'),
    ])
    await expect(dayButtons(page)).toHaveCount(2)
    const oct5 = grid(page).getByRole('button', { name: '10月5日，有日記', exact: true })
    await expect(oct5).toHaveText('5')
    await expect(grid(page).getByRole('button', { name: '10月18日，有日記', exact: true })).toBeVisible()
    // Filled circle: a non-transparent background, round shape.
    const style = await oct5.evaluate((el) => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, radius: s.borderRadius }
    })
    expect(style.bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(style.radius).toBe('50%')
    // A plain day has no fill and is not a button.
    const plain = grid(page).locator('td', { hasText: /^6$/ })
    await expect(plain.getByRole('button')).toHaveCount(0)
    const plainBg = await plain.locator('.calendar-day').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(plainBg).toBe('rgba(0, 0, 0, 0)')
    // No count is shown (decisions.md): the button only shows the day.
    await expect(oct5).not.toContainText('2')

    await prevButton(page).click()
    await expect(dayButtons(page)).toHaveCount(1)
    await expect(grid(page).getByRole('button', { name: '9月30日，有日記', exact: true })).toBeVisible()
    await nextButton(page).click()
    await nextButton(page).click()
    await expect(dayButtons(page)).toHaveCount(0)
  })

  test('days without entries are skipped by Tab and do nothing on click', async ({ page }) => {
    await setup(page, [entry('a', '2026-10-05', 'Only entry')])
    await todayButton(page).focus()
    await page.keyboard.press('Tab')
    await expect(grid(page).getByRole('button', { name: '10月5日，有日記' })).toBeFocused()
    await page.keyboard.press('Tab')
    // Next focus stop is outside the calendar table.
    const inGrid = await page.evaluate(() => Boolean(document.activeElement.closest('table')))
    expect(inGrid).toBe(false)

    // No plain day is focusable.
    const focusable = await grid(page)
      .locator('td')
      .evaluateAll((cells) =>
        cells
          .filter((c) => !c.querySelector('button'))
          .flatMap((c) => [c, ...c.querySelectorAll('*')])
          .filter((el) => el.tabIndex >= 0 || el.hasAttribute('tabindex')).length,
      )
    expect(focusable).toBe(0)

    for (const day of ['1', '6', '17', '18', '31']) {
      await grid(page).locator('td', { hasText: new RegExp(`^${day}$`) }).click()
      await grid(page).locator('td', { hasText: new RegExp(`^${day}$`) }).dblclick()
    }
    await expect(page).toHaveURL(HOME_URL)
    await expect(page.getByRole('heading', { level: 2, name: '我的日記' })).toBeVisible()
    await expect(entryItems(page)).toHaveCount(1)
    expect(await readStore(page, 'entries')).toHaveLength(1)
  })

  test('soft-deleted entries do not mark their date (seeded)', async ({ page }) => {
    await setup(page, [
      entry('live', '2026-10-05', 'Live entry'),
      // Real tombstone shape: no date at all.
      { id: 'tomb', deleted: true, deletedAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' },
      // Defensive: a deleted record that still carries a date.
      entry('dated-tomb', '2026-10-07', 'Deleted', {
        deleted: true,
        deletedAt: '2026-10-10T00:00:00.000Z',
        updatedAt: '2026-10-10T00:00:00.000Z',
      }),
    ])
    await expect(dayButtons(page)).toHaveCount(1)
    await expect(grid(page).getByRole('button', { name: '10月5日，有日記' })).toBeVisible()
    await expect(grid(page).locator('td', { hasText: /^7$/ }).getByRole('button')).toHaveCount(0)
    await expect(entryItems(page)).toHaveCount(1)
  })

  test('deleting through the UI removes the mark once the day has no entries', async ({ page }) => {
    await setup(page, [
      entry('x1', '2026-10-12', 'Twelfth one'),
      entry('x2', '2026-10-12', 'Twelfth two'),
      entry('y', '2026-10-13', 'Thirteenth'),
    ])
    const oct12 = grid(page).getByRole('button', { name: '10月12日，有日記' })
    const oct13 = grid(page).getByRole('button', { name: '10月13日，有日記' })
    await expect(dayButtons(page)).toHaveCount(2)

    async function deleteEntry(text) {
      await entryItems(page).filter({ hasText: text }).getByRole('link').click()
      page.once('dialog', (dialog) => dialog.accept())
      await page.getByRole('button', { name: '刪除' }).click()
      await expect(page).toHaveURL(HOME_URL)
      await expect(entryItems(page).filter({ hasText: text })).toHaveCount(0)
    }

    await deleteEntry('Twelfth one')
    await expect(oct12).toBeVisible()
    await expect(dayButtons(page)).toHaveCount(2)

    await deleteEntry('Twelfth two')
    await expect(oct12).toHaveCount(0)
    await expect(oct13).toBeVisible()
    await expect(grid(page).locator('td', { hasText: /^12$/ }).getByRole('button')).toHaveCount(0)

    await page.reload()
    await expect(entryItems(page)).toHaveCount(1)
    await expect(dayButtons(page)).toHaveCount(1)
    await expect(oct13).toBeVisible()
  })
})

test.describe('home calendar: today', () => {
  test('today has aria-current="date" (plain and marked day)', async ({ page }) => {
    await setup(page)
    const current = grid(page).locator('[aria-current]')
    await expect(current).toHaveCount(1)
    await expect(current).toHaveAttribute('aria-current', 'date')
    await expect(current).toHaveText('18')
    // Not on another month's same day.
    await nextButton(page).click()
    await expect(grid(page).locator('[aria-current]')).toHaveCount(0)

    await writeStore(page, 'entries', [entry('t', '2026-10-18', 'Today')])
    // The month is in the URL since P3-T3: go back to October first.
    await todayButton(page).click()
    await page.reload()
    await expect(title(page)).toHaveText('2026 年 10 月')
    const marked = grid(page).getByRole('button', { name: '10月18日，有日記' })
    await expect(marked).toHaveAttribute('aria-current', 'date')
    await expect(grid(page).locator('[aria-current]')).toHaveCount(1)
  })

  test('real clock: shows the current month and marks today', async ({ page }) => {
    await startApp(page)
    const now = await page.evaluate(() => {
      const d = new Date()
      return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
    })
    await expect(title(page)).toHaveText(`${now.y} 年 ${now.m} 月`)
    const current = grid(page).locator('[aria-current="date"]')
    await expect(current).toHaveCount(1)
    await expect(current).toHaveText(String(now.d))
  })
})

test.describe('home calendar: list unchanged', () => {
  test('empty list message and sorted list still work next to the calendar', async ({ page }) => {
    await setup(page)
    await expect(page.getByText(/還沒有日記/)).toBeVisible()
    await writeStore(page, 'entries', [
      entry('old', '2026-10-01', 'Older'),
      entry('new', '2026-10-15', 'Newer'),
      entry('mid', '2026-10-08', 'Middle'),
    ])
    await page.reload()
    await expect(entryItems(page).locator('.entry-preview')).toHaveText(['Newer', 'Middle', 'Older'])
    await expect(dayButtons(page)).toHaveCount(3)
  })
})
