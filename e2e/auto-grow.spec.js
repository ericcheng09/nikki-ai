import { test, expect, MOCK_ANALYSIS, readStore, startApp, writeStore } from './helpers.js'

// E2E for Phase 2 F9: the 「內容」 textarea grows with its content
// (decisions.md Phase 2 畫面). At least 12 rows, never an inner scrollbar,
// shrinks back to 12 rows, refits when the width changes, works in both
// entry layouts, and never makes the page scroll jump.

const ENTRY_ID = 'grow-entry'
const ENTRY_URL = /\/nikki-ai\/entry\/(?!new$)[^/]+$/
const LINE = '今日は友達と一緒に新しいカフェに行きました。'
const LONG_LINES = Array.from({ length: 60 }, (_, i) => `${LINE} ${i + 1}`).join('\n')
// One long paragraph: its height depends on where lines wrap.
const LONG_PARAGRAPH = LINE.repeat(40)

const content = (page) => page.getByLabel('內容')
const saveButton = (page) => page.getByRole('button', { name: '儲存' })
const panel = (page) => page.getByRole('region', { name: 'AI 批改結果' })

async function seedEntry(page, text, analysis = null) {
  await startApp(page)
  await writeStore(page, 'entries', [
    {
      id: ENTRY_ID,
      date: '2026-10-01',
      content: text,
      language: '日文',
      createdAt: '2026-10-01T01:00:00.000Z',
      updatedAt: '2026-10-01T01:00:00.000Z',
      deleted: false,
      deletedAt: null,
      analysis,
    },
  ])
}

async function openNew(page) {
  await page.goto('./entry/new')
  await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
}

async function openEntry(page) {
  await page.goto(`./entry/${ENTRY_ID}`)
  await expect(page.getByRole('heading', { level: 2, name: '編輯日記' })).toBeVisible()
}

// Height, inner scroll and the height of the same box at exactly 12 rows
// (a clone with height auto, measured next to it).
async function box(page) {
  return content(page).evaluate((el) => {
    const clone = el.cloneNode()
    clone.value = ''
    clone.removeAttribute('class')
    clone.style.height = 'auto'
    clone.style.overflow = 'hidden'
    el.parentNode.appendChild(clone)
    const minHeight = clone.offsetHeight
    clone.remove()
    const style = getComputedStyle(el)
    return {
      height: el.offsetHeight,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      minHeight,
      overflowY: style.overflowY,
      resize: style.resize,
      rows: el.rows,
    }
  })
}

async function expectFits(page) {
  const b = await box(page)
  expect(b.scrollHeight).toBeLessThanOrEqual(b.clientHeight + 1)
  expect(b.height).toBeGreaterThanOrEqual(b.minHeight - 1)
  return b
}

async function expectNoPageOverflow(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
}

async function scrollY(page) {
  return page.evaluate(() => window.scrollY)
}

test.describe('內容 auto-grow', () => {
  test('empty box is 12 rows, no drag handle, no inner scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await startApp(page)
    await openNew(page)
    const b = await box(page)
    expect(b.rows).toBe(12)
    expect(Math.abs(b.height - b.minHeight)).toBeLessThanOrEqual(1)
    expect(b.overflowY).toBe('hidden')
    expect(b.resize).toBe('none')
  })

  test('grows while typing and pasting; shrinks back to 12 rows, not below', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await startApp(page)
    await openNew(page)
    const min = (await box(page)).minHeight

    // Typing line by line: at most 12 rows stays at the minimum, then grows.
    await content(page).click()
    let last = min
    for (let i = 1; i <= 20; i++) {
      await page.keyboard.type(`line ${i}`)
      if (i < 20) await page.keyboard.press('Enter')
      const b = await expectFits(page)
      // After line i and Enter there are i + 1 lines.
      if (i <= 11) expect(Math.abs(b.height - min), `line ${i}`).toBeLessThanOrEqual(1)
      else if (i < 20) expect(b.height, `line ${i}`).toBeGreaterThan(last)
      last = b.height
    }

    // Pasting a long block (inserted like a paste) grows it at once.
    await page.keyboard.press('Enter')
    await page.keyboard.insertText(LONG_LINES)
    const pasted = await expectFits(page)
    expect(pasted.height).toBeGreaterThan(last + 500)

    // Deleting the text shrinks it back to exactly 12 rows.
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await expect(content(page)).toHaveValue('')
    let b = await expectFits(page)
    expect(Math.abs(b.height - min)).toBeLessThanOrEqual(1)
    await page.keyboard.type('a')
    b = await expectFits(page)
    expect(Math.abs(b.height - min)).toBeLessThanOrEqual(1)
    await expectNoPageOverflow(page)
  })

  test('an existing long entry opens at full height, without a 12-row flash', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await seedEntry(page, LONG_LINES)
    // Record the textarea height on every frame from its first appearance.
    await page.addInitScript(() => {
      window.__heights = []
      const tick = () => {
        const el = document.querySelector('textarea')
        if (el && el.value) window.__heights.push(el.offsetHeight)
        if (window.__heights.length < 30) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await openEntry(page)
    await expect(content(page)).toHaveValue(LONG_LINES)
    await expect.poll(() => page.evaluate(() => window.__heights.length)).toBeGreaterThan(5)
    const b = await expectFits(page)
    expect(b.height).toBeGreaterThan(b.minHeight * 3)
    const heights = await page.evaluate(() => window.__heights)
    // Every frame with the text in it already had (about) the final height.
    for (const h of heights) expect(Math.abs(h - b.height)).toBeLessThanOrEqual(2)
  })

  test('refits when the window width changes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await seedEntry(page, LONG_PARAGRAPH)
    await openEntry(page)
    const wide = await expectFits(page)
    await page.setViewportSize({ width: 375, height: 800 })
    // Narrower: more wrapping, so taller; still no inner scroll.
    await expect.poll(async () => (await box(page)).height).toBeGreaterThan(wide.height + 100)
    await expectFits(page)
    await expectNoPageOverflow(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(async () => Math.abs((await box(page)).height - wide.height)).toBeLessThanOrEqual(1)
    await expectFits(page)
  })

  test('resizing the window raises no error events (e.g. ResizeObserver loop)', async ({ page }) => {
    await page.addInitScript(() => {
      window.__errors = []
      window.addEventListener('error', (event) => window.__errors.push(String(event.message)))
    })
    await page.setViewportSize({ width: 1280, height: 800 })
    await seedEntry(page, LONG_PARAGRAPH)
    await openEntry(page)
    const wide = await expectFits(page)
    for (const width of [375, 1280, 768, 767, 1024]) {
      await page.setViewportSize({ width, height: 800 })
      await expect.poll(async () => (await box(page)).scrollHeight - (await box(page)).clientHeight).toBeLessThanOrEqual(1)
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(async () => Math.abs((await box(page)).height - wide.height)).toBeLessThanOrEqual(1)
    // Let pending observer callbacks run.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    expect(await page.evaluate(() => window.__errors)).toEqual([])
  })

  test('wide two-column layout: the page scrolls, the review panel stays in view', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 700 })
    await seedEntry(page, LONG_LINES, { ...MOCK_ANALYSIS, analyzedAt: '2026-10-01T03:04:00.000Z' })
    await openEntry(page)
    await expect(panel(page).getByRole('region', { name: '中文翻譯' })).toBeVisible()
    await expectFits(page)
    const max = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    )
    // The long diary alone makes the page scroll.
    expect(max).toBeGreaterThan(800)
    const bar = await page.getByRole('banner').boundingBox()
    const top0 = (await panel(page).boundingBox()).y
    for (const y of [Math.floor(max / 2), max]) {
      await page.evaluate((top) => window.scrollTo(0, top), y)
      await expect.poll(() => scrollY(page)).toBe(y)
      const p = await panel(page).boundingBox()
      expect(Math.abs(p.y - top0)).toBeLessThanOrEqual(1)
      expect(p.y).toBeGreaterThanOrEqual(bar.y + bar.height)
      expect(p.y + p.height).toBeLessThanOrEqual(700)
    }
    await expectNoPageOverflow(page)
  })

  test('stacked 375px layout: grows, page scrolls, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await seedEntry(page, LONG_LINES, { ...MOCK_ANALYSIS, analyzedAt: '2026-10-01T03:04:00.000Z' })
    await openEntry(page)
    const b = await expectFits(page)
    expect(b.height).toBeGreaterThan(b.minHeight * 3)
    const form = await page.locator('form.diary-editor').boundingBox()
    const p = await panel(page).boundingBox()
    expect(p.y).toBeGreaterThanOrEqual(form.y + form.height - 1)
    await expectNoPageOverflow(page)
  })

  for (const width of [1280, 375]) {
    test(`${width}px: typing at the end of a long entry does not jump the page`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 })
      await seedEntry(page, LONG_LINES)
      await openEntry(page)
      // Caret at the end, page scrolled so the end of the box is in view.
      await content(page).evaluate((el) => {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
      await content(page).evaluate((el) => {
        const r = el.getBoundingClientRect()
        window.scrollTo(0, window.scrollY + r.bottom - window.innerHeight + 40)
      })
      const before = await scrollY(page)
      expect(before).toBeGreaterThan(500)

      // Typing on the last line: no scroll change at all.
      await page.keyboard.type('またね')
      expect(Math.abs((await scrollY(page)) - before)).toBeLessThanOrEqual(1)
      // A new line grows the box by one line; the page moves at most that
      // much (to keep the caret in view), never back to the top.
      const lineHeight = await content(page).evaluate((el) => {
        const lh = parseFloat(getComputedStyle(el).lineHeight)
        return Number.isFinite(lh) ? lh : parseFloat(getComputedStyle(el).fontSize) * 1.5
      })
      for (let i = 0; i < 3; i++) {
        const y0 = await scrollY(page)
        await page.keyboard.press('Enter')
        await page.keyboard.type(`追加 ${i}`)
        const y1 = await scrollY(page)
        expect(y1).toBeGreaterThanOrEqual(y0 - 1)
        expect(y1 - y0).toBeLessThanOrEqual(lineHeight * 2)
        await expectFits(page)
      }
      // Deleting lines near the bottom does not jump to the top either.
      const y0 = await scrollY(page)
      for (let i = 0; i < 10; i++) await page.keyboard.press('Backspace')
      expect(await scrollY(page)).toBeGreaterThan(y0 - lineHeight * 3)
      // The caret stays visible.
      const r = await content(page).boundingBox()
      expect(r.y + r.height).toBeGreaterThan(0)
    })
  }

  test('content is saved exactly as typed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await startApp(page)
    await openNew(page)
    const text = `  先頭の空白\n\n${LONG_LINES}\n\t末尾のタブと改行\n\n`
    await content(page).click()
    await page.keyboard.insertText(text)
    await expectFits(page)
    await saveButton(page).click()
    await expect(page).toHaveURL(ENTRY_URL)
    const [entry] = await readStore(page, 'entries')
    expect(entry.content).toBe(text)
    await page.reload()
    await expect(content(page)).toHaveValue(text)
    await expectFits(page)
  })
})
