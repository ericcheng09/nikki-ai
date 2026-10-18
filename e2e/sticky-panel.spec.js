import { test, expect, MOCK_ANALYSIS, startApp, topBar, writeStore } from './helpers.js'

// E2E for Phase 2 F2: sticky AI review panel (decisions.md Phase 2 畫面).
// From 768px the panel sticks just below the top bar, fits in the viewport
// and scrolls its own content (focusable, so the keyboard can scroll it).
// Below 768px it stays a normal block under the form and the page scrolls.
// The top bar never covers focused elements (scroll-padding-top).

const ENTRY_ID = 'sticky-entry'
const VIEWPORT_HEIGHT = 700
const LONG_DIARY = '今日は友達と一緒に新しいカフェに行きました。\n'.repeat(80)
const LONG_TEXT = '今日は友達と一緒に新しいカフェに行きました。'.repeat(40)
const LONG_ANALYSIS = {
  ...MOCK_ANALYSIS,
  grammarErrors: Array.from({ length: 6 }, (_, i) => ({
    original: `${LONG_TEXT}${i}`,
    corrected: `${LONG_TEXT}（修正 ${i}）`,
    explanation: LONG_TEXT,
  })),
  correctedText: `${LONG_TEXT}**${LONG_TEXT}**`,
  translation: '今天和朋友一起去了新的咖啡店。'.repeat(60),
  analyzedAt: '2026-10-01T03:04:00.000Z',
}

const form = (page) => page.locator('form.diary-editor')
const panel = (page) => page.getByRole('region', { name: 'AI 批改結果' })
const textarea = (page) => form(page).locator('textarea')
const dateInput = (page) => form(page).locator('input[type="date"]')

async function seedAndOpen(page, width) {
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT })
  await startApp(page)
  await writeStore(page, 'entries', [
    {
      id: ENTRY_ID,
      date: '2026-10-01',
      content: LONG_DIARY,
      language: '日文',
      createdAt: '2026-10-01T01:00:00.000Z',
      updatedAt: '2026-10-01T03:04:00.000Z',
      deleted: false,
      deletedAt: null,
      analysis: LONG_ANALYSIS,
    },
  ])
  await page.goto(`./entry/${ENTRY_ID}`)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
  await expect(panel(page).getByRole('region', { name: '中文翻譯' })).toBeVisible()
}

// The textarea has a fixed row count, so a long diary alone does not make
// the page taller; resize it (as a user dragging its corner would) so the
// page itself scrolls on the wide layout.
async function makePageLong(page) {
  await textarea(page).evaluate((el) => {
    el.style.height = '2000px'
  })
  await expect.poll(() => pageScroll(page).then((s) => s.max)).toBeGreaterThan(800)
}

async function pageScroll(page) {
  return page.evaluate(() => ({
    y: window.scrollY,
    max: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }))
}

async function barBottom(page) {
  const box = await topBar(page).boundingBox()
  return box.y + box.height
}

async function panelState(page) {
  return panel(page).evaluate((el) => {
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      top: r.top,
      bottom: r.bottom,
      position: style.position,
      overflowY: style.overflowY,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      tabindex: el.getAttribute('tabindex'),
    }
  })
}

async function scrollPageTo(page, y) {
  await page.evaluate((top) => window.scrollTo(0, top), y)
  await expect.poll(() => pageScroll(page).then((s) => Math.round(s.y))).toBe(Math.round(y))
}

// Scrolls the page so the date input sits under the top bar (inside the
// viewport, so without scroll-padding-top the browser would not move it),
// then focuses it by keyboard: it must end up fully below the bar.
async function expectFocusClearsBar(page) {
  const bar = await barBottom(page)
  const { y } = await pageScroll(page)
  const box = await dateInput(page).boundingBox()
  // Put the input's top 10px below the viewport top, i.e. under the bar.
  await scrollPageTo(page, y + box.y - 10)
  expect((await dateInput(page).boundingBox()).y).toBeLessThan(bar)
  // Reach it with Shift+Tab from the next control (language select).
  await form(page).locator('select').first().focus()
  await page.keyboard.press('Shift+Tab')
  await expect(dateInput(page)).toBeFocused()
  await expect.poll(async () => (await dateInput(page).boundingBox()).y).toBeGreaterThanOrEqual(bar)
}

async function expectNoPageOverflow(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
}

test.describe('sticky AI review panel (>= 768px)', () => {
  for (const width of [1280, 768]) {
    test(`${width}px: sticks below the top bar, fits the viewport, scrolls itself`, async ({ page }) => {
      await seedAndOpen(page, width)
      const bar = await barBottom(page)
      let s = await panelState(page)
      expect(s.position).toBe('sticky')
      expect(s.tabindex).toBe('0')
      // Just below the top bar (with a small gap), never under it.
      expect(s.top).toBeGreaterThanOrEqual(bar)
      expect(s.top).toBeLessThanOrEqual(bar + 24)
      expect(s.bottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
      // Long analysis: the panel scrolls internally.
      expect(s.scrollHeight).toBeGreaterThan(s.clientHeight)
      const initialTop = s.top

      // The page scrolls (long diary column); the panel stays put.
      await makePageLong(page)
      const { max } = await pageScroll(page)
      for (const y of [300, Math.floor(max / 2), max]) {
        await scrollPageTo(page, y)
        s = await panelState(page)
        expect(Math.abs(s.top - initialTop), `page scrollY ${y}`).toBeLessThanOrEqual(1)
        expect(s.top, `page scrollY ${y}`).toBeGreaterThanOrEqual(await barBottom(page))
        expect(s.bottom, `page scrollY ${y}`).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
      }
      // The panel's own scroll reaches its last section.
      await panel(page).evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      const translation = panel(page).getByRole('region', { name: '中文翻譯' })
      await expect(translation).toBeInViewport()
      await expectNoPageOverflow(page)
    })

    test(`${width}px: focused panel scrolls with PageDown / ArrowDown, not the page`, async ({ page }) => {
      await seedAndOpen(page, width)
      await makePageLong(page)
      await scrollPageTo(page, 200)
      // Reach the panel by keyboard: 刪除 → panel.
      await form(page).getByRole('button', { name: '刪除' }).focus()
      await page.keyboard.press('Tab')
      await expect(panel(page)).toBeFocused()
      const pageY = (await pageScroll(page)).y

      for (const key of ['PageDown', 'ArrowDown']) {
        await panel(page).evaluate((el) => {
          el.scrollTop = 0
        })
        await page.keyboard.press(key)
        await expect.poll(() => panelState(page).then((s) => s.scrollTop), key).toBeGreaterThan(0)
        expect((await pageScroll(page)).y, key).toBe(pageY)
      }
      // The panel stays within the viewport while focused.
      const s = await panelState(page)
      expect(s.top).toBeGreaterThanOrEqual(await barBottom(page))
      expect(s.bottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
    })
  }

  test('focusing an element near the top keeps it below the top bar', async ({ page }) => {
    await seedAndOpen(page, 1280)
    await makePageLong(page)
    await expectFocusClearsBar(page)
  })

  test('resizing across 768px adds and removes the panel tab stop', async ({ page }) => {
    await seedAndOpen(page, 1024)
    expect((await panelState(page)).tabindex).toBe('0')
    await page.setViewportSize({ width: 600, height: VIEWPORT_HEIGHT })
    await expect.poll(() => panelState(page).then((s) => s.tabindex)).toBeNull()
    expect((await panelState(page)).position).toBe('static')
    await page.setViewportSize({ width: 900, height: VIEWPORT_HEIGHT })
    await expect.poll(() => panelState(page).then((s) => s.tabindex)).toBe('0')
    expect((await panelState(page)).position).toBe('sticky')
  })
})

test.describe('AI review panel below 768px', () => {
  for (const width of [767, 375]) {
    test(`${width}px: normal block under the form, the page scrolls`, async ({ page }) => {
      await seedAndOpen(page, width)
      const s = await panelState(page)
      expect(s.position).toBe('static')
      expect(s.tabindex).toBeNull()
      // No internal scrolling: the whole panel is laid out in the page.
      expect(s.scrollHeight).toBeLessThanOrEqual(s.clientHeight)
      // Stacked under the form.
      const f = await form(page).boundingBox()
      const p = await panel(page).boundingBox()
      expect(p.y).toBeGreaterThanOrEqual(f.y + f.height - 1)
      // The page scrolls to the end of the panel.
      const { max } = await pageScroll(page)
      expect(max).toBeGreaterThan(0)
      await scrollPageTo(page, max)
      await expect(panel(page).getByRole('region', { name: '中文翻譯' })).toBeInViewport()
      await expectNoPageOverflow(page)
    })

    test(`${width}px: focusing an element near the top keeps it below the top bar`, async ({ page }) => {
      await seedAndOpen(page, width)
      await expectFocusClearsBar(page)
    })
  }
})
