// Pure functions for diary entries (spec sections 3.1 and 4.1).
// No UI or storage concerns here; the clock and id generator are injectable
// so behaviour is testable.
//
// Timestamp convention: every timestamp (createdAt, updatedAt, deletedAt) is
// produced by Date.prototype.toISOString(), i.e. a fixed-width UTC string
// ending in 'Z' (e.g. '2026-10-17T03:04:05.678Z'). Keeping one format lets
// sorting compare createdAt as plain strings. The sync merge (sync.js)
// compares updatedAt and deletedAt as parsed times instead, so records
// written in another format still compare correctly.

// Fields a user edit may change. Everything else (id, createdAt, deleted,
// analysis...) is managed elsewhere and must not be overwritten.
const EDITABLE_FIELDS = ['content', 'date', 'language']

// JavaScript's \s already covers spaces, tabs, newlines and Unicode spaces
// such as the full-width space U+3000, so trimming is enough.
export function isBlank(text) {
  return (text ?? '').trim() === ''
}

export function createEntry(
  { date, content, language = 'auto' },
  { now = new Date(), generateId = () => crypto.randomUUID() } = {},
) {
  const timestamp = now.toISOString()
  return {
    id: generateId(),
    date,
    content,
    language,
    createdAt: timestamp,
    // A new entry has never been modified, so updatedAt equals createdAt.
    updatedAt: timestamp,
    deleted: false,
    deletedAt: null,
    analysis: null,
  }
}

export function updateEntry(entry, changes = {}, { now = new Date() } = {}) {
  const allowed = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in changes) allowed[field] = changes[field]
  }
  return { ...entry, ...allowed, updatedAt: now.toISOString() }
}

// Spec 4.1: on delete, drop content, analysis and every other field
// immediately; only the tombstone fields needed for sync are kept.
export function softDeleteEntry(entry, { now = new Date() } = {}) {
  const timestamp = now.toISOString()
  return {
    id: entry.id,
    updatedAt: timestamp,
    deleted: true,
    deletedAt: timestamp,
  }
}

function compareDesc(a, b) {
  if (a > b) return -1
  if (a < b) return 1
  return 0
}

// Newest diary date first; within the same date, the later-written entry
// first. 'YYYY-MM-DD' and toISOString() values (always UTC, fixed width)
// both sort correctly as plain strings.
export function sortEntries(entries) {
  return [...entries].sort(
    (a, b) => compareDesc(a.date, b.date) || compareDesc(a.createdAt, b.createdAt),
  )
}

export function filterActiveEntries(entries) {
  return entries.filter((entry) => !entry.deleted)
}

// Build the date from local-time getters; toISOString() would use UTC and
// shift the day for users east/west of UTC near midnight.
export function getLocalDateString(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 'YYYY-MM-DD HH:mm' in the user's local timezone for an ISO timestamp
// (e.g. analyzedAt). Anything that is not a parsable string yields '' so
// callers can simply hide the line.
export function formatLocalDateTime(value) {
  if (typeof value !== 'string' || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${getLocalDateString(date)} ${h}:${min}`
}

// True when a 'YYYY-MM-DD' date is later than today in the user's local
// timezone. Fixed-width ISO dates compare correctly as plain strings.
// `now` is evaluated per call so a page left open past midnight still uses
// the current day.
export function isAfterToday(date, now = new Date()) {
  return date > getLocalDateString(now)
}
