import {
  createEntry,
  isBlank,
  updateEntry,
  softDeleteEntry,
  sortEntries,
  filterActiveEntries,
  getLocalDateString,
} from './diary.js'

const NOW = new Date('2026-10-17T03:04:05.678Z')
const LATER = new Date('2026-10-18T09:00:00.000Z')

describe('isBlank', () => {
  it('returns false for text with visible characters', () => {
    expect(isBlank('Hello')).toBe(false)
    expect(isBlank('  今日は晴れ  ')).toBe(false)
  })

  it('treats empty string as blank', () => {
    expect(isBlank('')).toBe(true)
  })

  it('treats whitespace-only text (spaces, newlines, tabs, full-width space) as blank', () => {
    expect(isBlank('   ')).toBe(true)
    expect(isBlank('\n\n\r\n')).toBe(true)
    expect(isBlank('\t \t')).toBe(true)
    expect(isBlank('　　')).toBe(true)
    expect(isBlank(' 　\n\t ')).toBe(true)
  })

  it('treats null and undefined as blank', () => {
    expect(isBlank(null)).toBe(true)
    expect(isBlank(undefined)).toBe(true)
  })
})

describe('createEntry', () => {
  it('creates an entry with all DiaryEntry fields and defaults', () => {
    const entry = createEntry(
      { date: '2026-10-17', content: 'Hello' },
      { now: NOW, generateId: () => 'id-1' },
    )
    expect(entry).toEqual({
      id: 'id-1',
      date: '2026-10-17',
      content: 'Hello',
      language: 'auto',
      createdAt: '2026-10-17T03:04:05.678Z',
      updatedAt: '2026-10-17T03:04:05.678Z',
      deleted: false,
      deletedAt: null,
      analysis: null,
    })
  })

  it('accepts an explicit language', () => {
    const entry = createEntry(
      { date: '2026-10-17', content: 'こんにちは', language: 'ja' },
      { now: NOW, generateId: () => 'id-2' },
    )
    expect(entry.language).toBe('ja')
  })

  it('ignores fields that are not part of a new entry', () => {
    const entry = createEntry(
      { date: '2026-10-17', content: 'x', extraField: true, deleted: true },
      { now: NOW, generateId: () => 'id-3' },
    )
    expect(entry).not.toHaveProperty('extraField')
    expect(entry.deleted).toBe(false)
  })

  it('generates a UUID by default', () => {
    const a = createEntry({ date: '2026-10-17', content: 'a' }, { now: NOW })
    const b = createEntry({ date: '2026-10-17', content: 'b' }, { now: NOW })
    expect(a.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(a.id).not.toBe(b.id)
  })
})

describe('updateEntry', () => {
  const original = createEntry(
    { date: '2026-10-17', content: 'old' },
    { now: NOW, generateId: () => 'id-1' },
  )

  it('returns a new entry with updated content and updatedAt, keeping other fields', () => {
    const updated = updateEntry(original, { content: 'new' }, { now: LATER })
    expect(updated).toEqual({
      ...original,
      content: 'new',
      updatedAt: '2026-10-18T09:00:00.000Z',
    })
    expect(updated.createdAt).toBe(original.createdAt)
    expect(updated.id).toBe('id-1')
  })

  it('does not mutate the original entry', () => {
    const snapshot = { ...original }
    updateEntry(original, { content: 'new', date: '2026-10-01' }, { now: LATER })
    expect(original).toEqual(snapshot)
  })

  it('can change date and language', () => {
    const updated = updateEntry(
      original,
      { date: '2026-10-01', language: 'en' },
      { now: LATER },
    )
    expect(updated.date).toBe('2026-10-01')
    expect(updated.language).toBe('en')
    expect(updated.content).toBe('old')
  })

  it('only refreshes updatedAt when changes is omitted', () => {
    const updated = updateEntry(original, undefined, { now: LATER })
    expect(updated).toEqual({ ...original, updatedAt: '2026-10-18T09:00:00.000Z' })
  })

  it('ignores attempts to change protected fields', () => {
    const updated = updateEntry(
      original,
      { id: 'hacked', createdAt: 'x', deleted: true, analysis: { x: 1 } },
      { now: LATER },
    )
    expect(updated.id).toBe('id-1')
    expect(updated.createdAt).toBe(original.createdAt)
    expect(updated.deleted).toBe(false)
    expect(updated.analysis).toBeNull()
  })
})

describe('softDeleteEntry', () => {
  const entry = {
    ...createEntry(
      { date: '2026-10-17', content: 'secret' },
      { now: NOW, generateId: () => 'id-1' },
    ),
    analysis: { correctedText: 'x' },
  }

  it('keeps only id, updatedAt, deleted and deletedAt', () => {
    const deleted = softDeleteEntry(entry, { now: LATER })
    expect(deleted).toEqual({
      id: 'id-1',
      updatedAt: '2026-10-18T09:00:00.000Z',
      deleted: true,
      deletedAt: '2026-10-18T09:00:00.000Z',
    })
    expect(deleted).not.toHaveProperty('content')
    expect(deleted).not.toHaveProperty('analysis')
  })

  it('does not mutate the original entry', () => {
    softDeleteEntry(entry, { now: LATER })
    expect(entry.content).toBe('secret')
    expect(entry.deleted).toBe(false)
  })
})

describe('sortEntries', () => {
  const make = (id, date, createdAt) => ({ id, date, createdAt })

  it('sorts by date descending (newest date first)', () => {
    const entries = [
      make('a', '2026-10-15', '2026-10-15T01:00:00.000Z'),
      make('b', '2026-10-17', '2026-10-17T01:00:00.000Z'),
      make('c', '2026-09-30', '2026-09-30T01:00:00.000Z'),
    ]
    expect(sortEntries(entries).map((e) => e.id)).toEqual(['b', 'a', 'c'])
  })

  it('sorts entries on the same date by createdAt descending (later first)', () => {
    const entries = [
      make('early', '2026-10-17', '2026-10-17T01:00:00.000Z'),
      make('late', '2026-10-17', '2026-10-17T12:00:00.000Z'),
      make('mid', '2026-10-17', '2026-10-17T06:00:00.000Z'),
    ]
    expect(sortEntries(entries).map((e) => e.id)).toEqual(['late', 'mid', 'early'])
  })

  it('uses the chosen date, not createdAt, as the primary key', () => {
    // Written later but for an earlier diary date: must appear below.
    const entries = [
      make('backfilled', '2026-10-10', '2026-10-17T12:00:00.000Z'),
      make('today', '2026-10-17', '2026-10-17T01:00:00.000Z'),
    ]
    expect(sortEntries(entries).map((e) => e.id)).toEqual(['today', 'backfilled'])
  })

  it('does not mutate the input array', () => {
    const entries = [
      make('a', '2026-10-15', '2026-10-15T01:00:00.000Z'),
      make('b', '2026-10-17', '2026-10-17T01:00:00.000Z'),
    ]
    const copy = [...entries]
    const result = sortEntries(entries)
    expect(entries).toEqual(copy)
    expect(result).not.toBe(entries)
  })

  it('returns an empty array for empty input', () => {
    expect(sortEntries([])).toEqual([])
  })
})

describe('filterActiveEntries', () => {
  it('returns only entries that are not deleted', () => {
    const entries = [
      { id: 'a', deleted: false },
      { id: 'b', deleted: true },
      { id: 'c', deleted: false },
    ]
    expect(filterActiveEntries(entries).map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('returns an empty array when everything is deleted or input is empty', () => {
    expect(filterActiveEntries([{ id: 'a', deleted: true }])).toEqual([])
    expect(filterActiveEntries([])).toEqual([])
  })
})

describe('getLocalDateString', () => {
  it('runs in a non-UTC timezone so UTC-shift bugs are detectable', () => {
    // vite.config.js pins TZ; if that is lost, the midnight test below
    // would silently pass with a toISOString()-based implementation.
    expect(new Date(2026, 9, 17).getTimezoneOffset()).not.toBe(0)
  })

  it('formats a date as YYYY-MM-DD using local time with zero padding', () => {
    // Constructed with local-time components, so the result is timezone-independent.
    expect(getLocalDateString(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05')
  })

  it('uses the local calendar day near midnight (no UTC shift)', () => {
    expect(getLocalDateString(new Date(2026, 9, 17, 0, 0, 1))).toBe('2026-10-17')
    expect(getLocalDateString(new Date(2026, 9, 17, 23, 59, 59))).toBe('2026-10-17')
  })

  it('defaults to the current date', () => {
    expect(getLocalDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
