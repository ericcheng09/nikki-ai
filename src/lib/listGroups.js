// Groups for the full home list (decisions.md 專案完成後的修改 主畫面列表分組):
// 今天, 昨天, then one group per month titled like the calendar
// (「2026 年 10 月」). Dates are 'YYYY-MM-DD' strings in the user's local
// calendar; all date math is integer/string based so no timezone or DST
// can shift a day.
import { daysInMonth, formatMonthTitle, parseDateParam } from './calendar.js'

const pad2 = (n) => String(n).padStart(2, '0')
const pad4 = (n) => String(n).padStart(4, '0')

// The day before a 'YYYY-MM-DD' date, across months, years and leap
// years. null for an invalid date or 0001-01-01 (no four-digit year
// before it).
export function previousDay(date) {
  if (!parseDateParam(date)) return null
  let year = Number(date.slice(0, 4))
  let month = Number(date.slice(5, 7))
  let day = Number(date.slice(8, 10)) - 1
  if (day === 0) {
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
      if (year < 1) return null
    }
    day = daysInMonth(year, month)
  }
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`
}

// Key and title of the group one entry belongs to.
function groupOf(date, today, yesterday) {
  if (date === today) return { key: 'today', title: '今天' }
  if (yesterday && date === yesterday) return { key: 'yesterday', title: '昨天' }
  // Malformed dates (should not occur) still get a group of their own
  // rather than breaking the list; the title falls back to the raw value.
  const month = typeof date === 'string' ? date.slice(0, 7) : ''
  // A future entry in this very month sorts above 今天 while the month's
  // past entries come after 昨天, so the two runs need distinct keys.
  // Fixed-width ISO dates compare correctly as plain strings.
  const future = month === today.slice(0, 7) && date > today
  return {
    key: `${future ? 'future' : 'month'}-${month}`,
    title: formatMonthTitle(month) || month,
  }
}

// Splits an already sorted entry list (sortEntries: newest date first) into
// consecutive groups: [{ key, title, entries }]. The input order is kept
// as is, both between and inside groups, so the list reads exactly as
// before with headings inserted; groups without entries never appear.
// `today` is the local 'YYYY-MM-DD' date decided by the caller.
export function groupEntries(sortedEntries, today) {
  const yesterday = previousDay(today)
  const groups = []
  const usedKeys = new Set()
  for (const entry of sortedEntries) {
    const { key, title } = groupOf(entry?.date, today, yesterday)
    const last = groups[groups.length - 1]
    if (last && last.baseKey === key) {
      last.entries.push(entry)
      continue
    }
    // Unsorted input could repeat a group further down; keep React keys
    // unique anyway.
    let uniqueKey = key
    for (let n = 2; usedKeys.has(uniqueKey); n += 1) uniqueKey = `${key}-${n}`
    usedKeys.add(uniqueKey)
    groups.push({ baseKey: key, key: uniqueKey, title, entries: [entry] })
  }
  return groups.map(({ key, title, entries }) => ({ key, title, entries }))
}
