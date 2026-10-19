// Pure calendar helpers for the home page calendar (spec 3.3, decisions.md
// Phase 3 日曆). Months are 'YYYY-MM' and days 'YYYY-MM-DD' strings in the
// user's local calendar, the same format as entry.date.
//
// Grid math is plain integer arithmetic on year/month/day instead of Date
// objects, so no timezone or DST can shift a day, and years below 100 are
// not reinterpreted as 19xx the way `new Date(y, m, d)` does.
import { getLocalDateString } from './diary.js'

// Column headers, Sunday first (decisions.md: weeks start on Sunday).
export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
// Four-digit years only; year 0000 does not exist in the Gregorian calendar.
const MIN_YEAR = 1
const MAX_YEAR = 9999

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

// Day of week (0 = Sunday) by Sakamoto's method for the proleptic
// Gregorian calendar.
function dayOfWeek(year, month, day) {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  const y = month < 3 ? year - 1 : year
  return (
    (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offsets[month - 1] + day) % 7
  )
}

const pad2 = (n) => String(n).padStart(2, '0')
const pad4 = (n) => String(n).padStart(4, '0')

// { year, month } for a valid 'YYYY-MM', otherwise null.
function splitMonth(value) {
  if (typeof value !== 'string') return null
  const match = MONTH_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < MIN_YEAR || month < 1 || month > 12) return null
  return { year, month }
}

// { year, month, day } for a real 'YYYY-MM-DD' date, otherwise null.
function splitDate(value) {
  if (typeof value !== 'string') return null
  const match = DATE_PATTERN.exec(value)
  if (!match) return null
  const parts = splitMonth(`${match[1]}-${match[2]}`)
  if (!parts) return null
  const day = Number(match[3])
  if (day < 1 || day > daysInMonth(parts.year, parts.month)) return null
  return { ...parts, day }
}

// Strict check for the `month` URL parameter: returns the value when it
// is a real 'YYYY-MM' month, otherwise null (missing, malformed, 2026-13).
export function parseMonthParam(value) {
  return splitMonth(value) ? value : null
}

// Strict check for the `date` URL parameter: returns the value only for a
// real calendar date (rejects 2026-02-30, 2026-10-1, ...), otherwise null.
export function parseDateParam(value) {
  return splitDate(value) ? value : null
}

// The month containing a 'YYYY-MM-DD' date, or null for an invalid date.
export function monthOfDate(date) {
  return splitDate(date) ? date.slice(0, 7) : null
}

// This month in the user's local timezone (not UTC).
export function currentMonth(now = new Date()) {
  return getLocalDateString(now).slice(0, 7)
}

// `month` moved by `n` months (negative = earlier), across years. Returns
// null for an invalid month, a non-integer step, or a result outside the
// four-digit year range.
export function addMonths(month, n) {
  const parts = splitMonth(month)
  if (!parts || !Number.isInteger(n)) return null
  // Count months from year 0 so a single division handles any step.
  const index = parts.year * 12 + (parts.month - 1) + n
  const year = Math.floor(index / 12)
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  return `${pad4(year)}-${pad2((index % 12) + 1)}`
}

// Weeks of `month` (arrays of 7 cells, Sunday first). Cells are the
// 'YYYY-MM-DD' days of that month; days before the 1st and after the last
// day are null (decisions.md: other months' days are not shown). Only as
// many weeks as needed: 4 to 6. Throws RangeError for an invalid month,
// since callers are expected to validate (parseMonthParam) first.
export function monthGrid(month) {
  const parts = splitMonth(month)
  if (!parts) throw new RangeError(`Invalid month: ${month}`)
  const { year, month: m } = parts
  const total = daysInMonth(year, m)
  const cells = Array(dayOfWeek(year, m, 1)).fill(null)
  for (let day = 1; day <= total; day += 1) cells.push(`${month}-${pad2(day)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// Dates that get the "has diary" mark: every valid date of a non-deleted
// entry (spec 3.3: deleted entries are not counted). Tombstones (no date)
// and malformed items are skipped instead of throwing, so one bad record
// cannot break the whole calendar.
export function entryDates(entries) {
  const dates = new Set()
  if (!Array.isArray(entries)) return dates
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || entry.deleted) continue
    if (parseDateParam(entry.date)) dates.add(entry.date)
  }
  return dates
}

// '2026-10' -> 「2026 年 10 月」 (no leading zero on the month); '' if invalid.
export function formatMonthTitle(month) {
  const parts = splitMonth(month)
  return parts ? `${parts.year} 年 ${parts.month} 月` : ''
}

// '2026-10-18' -> 「10月18日」 (no leading zeros); '' if invalid.
export function formatDayTitle(date) {
  const parts = splitDate(date)
  return parts ? `${parts.month}月${parts.day}日` : ''
}
