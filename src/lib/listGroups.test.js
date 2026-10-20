import { groupEntries, previousDay } from './listGroups.js'

const e = (id, date) => ({ id, date })
// Compact view of the result: [key, title, [ids]].
const summary = (groups) => groups.map((g) => [g.key, g.title, g.entries.map((x) => x.id)])

describe('previousDay', () => {
  it('steps back one day within a month', () => {
    expect(previousDay('2026-10-20')).toBe('2026-10-19')
    expect(previousDay('2026-10-10')).toBe('2026-10-09')
  })

  it('crosses into the previous month on the 1st', () => {
    expect(previousDay('2026-11-01')).toBe('2026-10-31')
    expect(previousDay('2026-10-01')).toBe('2026-09-30')
  })

  it('crosses into the previous year on January 1st', () => {
    expect(previousDay('2027-01-01')).toBe('2026-12-31')
  })

  it('handles February in leap and common years', () => {
    expect(previousDay('2024-03-01')).toBe('2024-02-29')
    expect(previousDay('2026-03-01')).toBe('2026-02-28')
    // Century rules: 2000 is a leap year, 2100 is not.
    expect(previousDay('2000-03-01')).toBe('2000-02-29')
    expect(previousDay('2100-03-01')).toBe('2100-02-28')
  })

  it('returns null for an invalid date or the first representable day', () => {
    expect(previousDay('2026-02-30')).toBeNull()
    expect(previousDay('2026-10-1')).toBeNull()
    expect(previousDay(undefined)).toBeNull()
    expect(previousDay('0001-01-01')).toBeNull()
  })
})

describe('groupEntries', () => {
  const today = '2026-10-20'

  it('puts today, yesterday and the rest of this month in separate groups', () => {
    const groups = groupEntries(
      [e('t', '2026-10-20'), e('y', '2026-10-19'), e('m1', '2026-10-18'), e('m2', '2026-10-01')],
      today,
    )
    expect(summary(groups)).toEqual([
      ['today', '今天', ['t']],
      ['yesterday', '昨天', ['y']],
      ['month-2026-10', '2026 年 10 月', ['m1', 'm2']],
    ])
  })

  it('groups older entries by month, across years', () => {
    const groups = groupEntries(
      [e('a', '2026-09-30'), e('b', '2026-09-01'), e('c', '2026-01-05'), e('d', '2025-12-31'), e('f', '2025-12-01')],
      today,
    )
    expect(summary(groups)).toEqual([
      ['month-2026-09', '2026 年 9 月', ['a', 'b']],
      ['month-2026-01', '2026 年 1 月', ['c']],
      ['month-2025-12', '2025 年 12 月', ['d', 'f']],
    ])
  })

  it('omits groups without entries', () => {
    // No entry today; nothing in October besides yesterday.
    expect(summary(groupEntries([e('y', '2026-10-19'), e('s', '2026-09-15')], today))).toEqual([
      ['yesterday', '昨天', ['y']],
      ['month-2026-09', '2026 年 9 月', ['s']],
    ])
    expect(groupEntries([], today)).toEqual([])
  })

  it('treats December 31st as yesterday on January 1st', () => {
    const groups = groupEntries(
      [e('t', '2027-01-01'), e('y', '2026-12-31'), e('m', '2026-12-30')],
      '2027-01-01',
    )
    expect(summary(groups)).toEqual([
      ['today', '今天', ['t']],
      ['yesterday', '昨天', ['y']],
      ['month-2026-12', '2026 年 12 月', ['m']],
    ])
  })

  it('treats the last day of the previous month as yesterday on the 1st (leap year)', () => {
    const groups = groupEntries(
      [e('t', '2024-03-01'), e('y', '2024-02-29'), e('m', '2024-02-28')],
      '2024-03-01',
    )
    expect(summary(groups)).toEqual([
      ['today', '今天', ['t']],
      ['yesterday', '昨天', ['y']],
      ['month-2024-02', '2024 年 2 月', ['m']],
    ])
  })

  it('puts future dates in their month group, ahead of today', () => {
    const groups = groupEntries(
      [e('next', '2026-11-02'), e('later', '2026-10-25'), e('t', '2026-10-20'), e('m', '2026-10-05')],
      today,
    )
    // Input order is kept, so this month's future entries form their own
    // run above 今天, separate from the past entries of the same month.
    expect(summary(groups)).toEqual([
      ['month-2026-11', '2026 年 11 月', ['next']],
      ['future-2026-10', '2026 年 10 月', ['later']],
      ['today', '今天', ['t']],
      ['month-2026-10', '2026 年 10 月', ['m']],
    ])
    // Keys stay unique for React.
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length)
  })

  it('keeps the input order inside each group', () => {
    const groups = groupEntries(
      [e('t2', '2026-10-20'), e('t1', '2026-10-20'), e('m3', '2026-10-17'), e('m2', '2026-10-17'), e('m1', '2026-10-02')],
      today,
    )
    expect(summary(groups)).toEqual([
      ['today', '今天', ['t2', 't1']],
      ['month-2026-10', '2026 年 10 月', ['m3', 'm2', 'm1']],
    ])
  })

  it('keeps the same entry objects', () => {
    const entry = e('t', '2026-10-20')
    expect(groupEntries([entry], today)[0].entries[0]).toBe(entry)
  })

  it('does not throw on an entry with a malformed date', () => {
    const groups = groupEntries([e('t', '2026-10-20'), e('bad', 'oops'), e('none', undefined)], today)
    expect(groups.flatMap((g) => g.entries.map((x) => x.id))).toEqual(['t', 'bad', 'none'])
  })
})
