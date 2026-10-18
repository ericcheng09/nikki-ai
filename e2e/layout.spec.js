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
    // The 內容 box refits to the new width one frame after a resize (F9),
    // so the form height can still change between two measurements: retry
    // until the layout has settled.
    await page.setViewportSize({ width: 600, height: 900 })
    await expect(() => expectStacked(page)).toPass({ timeout: 5000 })
    await page.setViewportSize({ width: 900, height: 900 })
    await expect(() => expectSideBySide(page)).toPass({ timeout: 5000 })
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

// --- Phase 2 F4: 日期 and 語言 on one row (decisions.md 畫面) ---------------
// Both fields grow from a 162px basis, so they only stack when the form is
// narrower than 340px. 語言名稱 + 加入 always take a full row of their own.

const dateField = (page) => form(page).locator('label.field', { has: page.locator('input[type="date"]') })
const languageField = (page) => form(page).locator('.field', { has: page.getByLabel('語言', { exact: true }) })
const nameField = (page) => form(page).locator('.field-full')
const nameInput = (page) => page.getByLabel('語言名稱', { exact: true })
const addLanguageButton = (page) => page.getByRole('button', { name: '加入', exact: true })
const contentField = (page) => form(page).locator('label.field', { has: page.locator('textarea') })
const rowContainer = (page) => form(page).locator('.date-language')

async function openNewEntry(page) {
  await page.goto('./entry/new')
  await expect(page.getByRole('heading', { level: 2, name: '新增日記' })).toBeVisible()
}

async function fieldBoxes(page) {
  return {
    date: await dateField(page).boundingBox(),
    language: await languageField(page).boundingBox(),
    content: await contentField(page).boundingBox(),
    row: await rowContainer(page).boundingBox(),
  }
}

async function expectDateLanguageOneRow(page) {
  const b = await fieldBoxes(page)
  // Same top, 日期 left of 語言, roughly equal widths, filling the row.
  expect(Math.abs(b.date.y - b.language.y)).toBeLessThanOrEqual(1)
  expect(b.date.x + b.date.width).toBeLessThanOrEqual(b.language.x)
  expect(Math.abs(b.date.width - b.language.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(b.date.x - b.row.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(b.language.x + b.language.width - (b.row.x + b.row.width))).toBeLessThanOrEqual(1)
  // Same height, so the select lines up with the date input.
  const dateInputBox = await form(page).locator('input[type="date"]').boundingBox()
  const selectBox = await page.getByLabel('語言', { exact: true }).boundingBox()
  expect(Math.abs(dateInputBox.y - selectBox.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(dateInputBox.height - selectBox.height)).toBeLessThanOrEqual(1)
  // Both above 內容.
  expect(Math.max(b.date.y + b.date.height, b.language.y + b.language.height)).toBeLessThan(b.content.y)
}

async function expectDateLanguageStacked(page) {
  const b = await fieldBoxes(page)
  expect(b.language.y).toBeGreaterThanOrEqual(b.date.y + b.date.height)
  // Each full width.
  for (const box of [b.date, b.language]) {
    expect(Math.abs(box.x - b.row.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(box.width - b.row.width)).toBeLessThanOrEqual(1)
  }
  expect(b.language.y + b.language.height).toBeLessThan(b.content.y)
}

// With 其他: 語言名稱 + 加入 on the next row, full width, above 內容.
async function expectNameRow(page) {
  await page.getByLabel('語言', { exact: true }).selectOption({ label: '其他' })
  await expect(nameInput(page)).toBeVisible()
  const b = await fieldBoxes(page)
  const name = await nameField(page).boundingBox()
  const input = await nameInput(page).boundingBox()
  const button = await addLanguageButton(page).boundingBox()
  expect(name.y).toBeGreaterThanOrEqual(Math.max(b.date.y + b.date.height, b.language.y + b.language.height))
  expect(Math.abs(name.x - b.row.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(name.width - b.row.width)).toBeLessThanOrEqual(1)
  expect(name.y + name.height).toBeLessThan(b.content.y)
  // Input and 加入 on one line inside the row, 加入 at its right end.
  expect(Math.abs(input.x - name.x)).toBeLessThanOrEqual(1)
  expect(button.x).toBeGreaterThanOrEqual(input.x + input.width - 1)
  expect(Math.abs(button.x + button.width - (name.x + name.width))).toBeLessThanOrEqual(1)
  expect(Math.abs(button.y + button.height / 2 - (input.y + input.height / 2))).toBeLessThanOrEqual(4)
}

test.describe('editor 日期 / 語言 row', () => {
  for (const width of [375, 768, 1280]) {
    for (const mode of ['new', 'edit']) {
      test(`${width}px ${mode}: 日期 and 語言 share a row; 語言名稱 + 加入 below`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await seedEntry(page)
        if (mode === 'new') await openNewEntry(page)
        else await openEntry(page)
        await expectDateLanguageOneRow(page)
        await expectNoPageOverflow(page)
        await expectNameRow(page)
        await expectDateLanguageOneRow(page)
        await expectNoPageOverflow(page)
      })
    }
  }

  for (const width of [355, 320]) {
    for (const mode of ['new', 'edit']) {
      test(`${width}px ${mode}: 日期 and 語言 stack, no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await seedEntry(page)
        if (mode === 'new') await openNewEntry(page)
        else await openEntry(page)
        await expectDateLanguageStacked(page)
        await expectNoPageOverflow(page)
        await expectNameRow(page)
        await expectDateLanguageStacked(page)
        await expectNoPageOverflow(page)
      })
    }
  }

  test('DOM and tab order: 日期 → 語言 → 語言名稱 → 加入 → 內容', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await startApp(page)
    await openNewEntry(page)
    const select = page.getByLabel('語言', { exact: true })
    await select.selectOption({ label: '其他' })
    const order = await form(page)
      .locator('input, select, textarea, button')
      .evaluateAll((els) =>
        els.slice(0, 5).map((el) => `${el.tagName.toLowerCase()}:${el.type}:${el.textContent.trim()}`),
      )
    expect(order).toEqual(['input:date:', 'select:select-one:' + (await select.textContent()).trim(), 'input:text:', 'button:button:加入', 'textarea:textarea:'])
    // No positive tabindex reorders them.
    expect(await form(page).locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').count()).toBe(0)
    // Keyboard: forward from 語言, and back from 內容 to 日期.
    await select.focus()
    await page.keyboard.press('Tab')
    await expect(nameInput(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(addLanguageButton(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('內容')).toBeFocused()
    for (const target of [addLanguageButton(page), nameInput(page), select]) {
      await page.keyboard.press('Shift+Tab')
      await expect(target).toBeFocused()
    }
    await page.keyboard.press('Shift+Tab')
    await expect(form(page).locator('input[type="date"]')).toBeFocused()
  })
})
