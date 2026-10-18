import { test, expect, MOCK_ANALYSIS, startApp, writeStore } from './helpers.js'

// E2E for Phase 2 T9: responsive entry page (spec 8.2-6; decisions.md 畫面).
// From 768px the entry form and the AI panel sit side by side; below that
// they stack. Other pages keep the 720px single column. Runs against both
// the dev server and the production build.

const ENTRY_ID = 'layout-entry'
const LONG_CJK = '今日は友達と一緒に新しいカフェに行きました。'.repeat(30)
const LONG_TOKEN = `https://example.com/${'a'.repeat(300)}`
const LONG_ANALYSIS = {
  ...MOCK_ANALYSIS,
  grammarErrors: [
    { original: LONG_CJK, corrected: `${LONG_CJK}（修正）`, explanation: LONG_CJK },
    { original: LONG_TOKEN, corrected: LONG_TOKEN, explanation: LONG_TOKEN },
  ],
  correctedText: `${LONG_CJK}**${LONG_CJK}**${LONG_TOKEN}`,
  translation: `${'今天和朋友一起去了新的咖啡店。'.repeat(30)}${LONG_TOKEN}`,
  analyzedAt: '2026-10-01T03:04:00.000Z',
}

const form = (page) => page.locator('form.diary-editor')
const panel = (page) => page.getByRole('region', { name: 'AI 批改結果' })
const app = (page) => page.locator('.app')

async function seedEntry(page) {
  await startApp(page)
  await writeStore(page, 'entries', [
    {
      id: ENTRY_ID,
      date: '2026-10-01',
      content: LONG_CJK,
      language: '日文',
      createdAt: '2026-10-01T01:00:00.000Z',
      updatedAt: '2026-10-01T03:04:00.000Z',
      deleted: false,
      deletedAt: null,
      analysis: LONG_ANALYSIS,
    },
  ])
}

async function openEntry(page) {
  await page.goto(`./entry/${ENTRY_ID}`)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
  await expect(panel(page).getByRole('region', { name: '中文翻譯' })).toBeVisible()
}

async function boxes(page) {
  return { form: await form(page).boundingBox(), panel: await panel(page).boundingBox() }
}

// No horizontal page scroll.
async function expectNoPageOverflow(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
}

// Every element inside the panel stays within the panel horizontally.
async function expectPanelContentInside(page) {
  const overflow = await panel(page).evaluate((root) => {
    const r = root.getBoundingClientRect()
    const bad = []
    for (const el of root.querySelectorAll('*')) {
      const b = el.getBoundingClientRect()
      if (b.width === 0) continue
      if (b.left < r.left - 1 || b.right > r.right + 1) bad.push(`${el.tagName}.${el.className}`)
    }
    return { bad, scroll: root.scrollWidth - root.clientWidth }
  })
  expect(overflow.bad).toEqual([])
  expect(overflow.scroll).toBeLessThanOrEqual(0)
}

async function expectSideBySide(page) {
  const { form: f, panel: p } = await boxes(page)
  // Form left, panel right, no horizontal overlap.
  expect(f.x + f.width).toBeLessThanOrEqual(p.x)
  // Tops aligned.
  expect(Math.abs(f.y - p.y)).toBeLessThanOrEqual(4)
  // Roughly equal widths.
  expect(Math.abs(f.width - p.width)).toBeLessThanOrEqual(Math.max(f.width, p.width) * 0.05)
}

async function expectStacked(page) {
  const { form: f, panel: p } = await boxes(page)
  expect(p.y).toBeGreaterThanOrEqual(f.y + f.height - 1)
  // Same column: horizontally overlapping and about the same width.
  expect(Math.abs(f.x - p.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(f.width - p.width)).toBeLessThanOrEqual(2)
}

test.describe('entry page layout', () => {
  test('1280px: side by side, container widened (max 1120px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedEntry(page)
    await openEntry(page)
    await expectSideBySide(page)
    const container = await app(page).boundingBox()
    expect(container.width).toBeGreaterThan(720)
    expect(container.width).toBeLessThanOrEqual(1120)
    expect(container.width).toBeGreaterThanOrEqual(1100)
    // Centered.
    expect(Math.abs(container.x - (1280 - container.x - container.width))).toBeLessThanOrEqual(2)
    await expectNoPageOverflow(page)
    await expectPanelContentInside(page)
  })

  test('exactly 768px: side by side', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await seedEntry(page)
    await openEntry(page)
    await expectSideBySide(page)
    await expectNoPageOverflow(page)
    await expectPanelContentInside(page)
  })

  for (const width of [767, 375]) {
    test(`${width}px: stacked, panel below the form, no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await seedEntry(page)
      await openEntry(page)
      await expectStacked(page)
      await expectNoPageOverflow(page)
      await expectPanelContentInside(page)
    })
  }

  test('resizing across 768px switches the layout', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await seedEntry(page)
    await openEntry(page)
    await expectSideBySide(page)
    await page.setViewportSize({ width: 600, height: 900 })
    await expect.poll(async () => (await boxes(page)).panel.y > (await boxes(page)).form.y + 10).toBe(true)
    await expectStacked(page)
    await page.setViewportSize({ width: 900, height: 900 })
    await expect.poll(async () => Math.abs((await boxes(page)).panel.y - (await boxes(page)).form.y) <= 4).toBe(true)
    await expectSideBySide(page)
  })

  test('DOM and tab order stay form, then panel (side by side)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedEntry(page)
    await openEntry(page)
    const formFirst = await page.evaluate(() => {
      const f = document.querySelector('form.diary-editor')
      const p = document.querySelector('section.ai-review')
      return Boolean(f.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(formFirst).toBe(true)
    // The last form control (刪除) is followed by the panel itself (a
    // focusable scroll box from 768px), then its AI 批改 button.
    await form(page).getByRole('button', { name: '刪除' }).focus()
    await page.keyboard.press('Tab')
    await expect(panel(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(panel(page).getByRole('button', { name: 'AI 批改', exact: true })).toBeFocused()
  })

  test('tab order stays form, then panel button (stacked)', async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 900 })
    await seedEntry(page)
    await openEntry(page)
    // No extra tab stop on the panel below 768px.
    await form(page).getByRole('button', { name: '刪除' }).focus()
    await page.keyboard.press('Tab')
    await expect(panel(page).getByRole('button', { name: 'AI 批改', exact: true })).toBeFocused()
  })

  test('other pages keep the 720px single column at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedEntry(page)
    for (const path of ['./', './entry/new', './settings', './welcome']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
      const container = await app(page).boundingBox()
      expect(container.width, path).toBe(720)
      await expect(page.locator('.entry-layout'), path).toHaveCount(0)
      await expectNoPageOverflow(page)
    }
  })
})
