import {
  WEEKDAY_LABELS,
  addMonths,
  currentMonth,
  entryDates,
  formatDayTitle,
  formatMonthTitle,
  monthGrid,
  monthOfDate,
  parseDateParam,
  parseMonthParam,
} from './calendar.js'

// Days of `month` in grid order, ignoring blanks.
const daysIn = (grid) => grid.flat().filter(Boolean)

describe('WEEKDAY_LABELS', () => {
  it('starts on Sunday', () => {
    expect(WEEKDAY_LABELS).toEqual(['日', '一', '二', '三', '四', '五', '六'])
  })
})

describe('monthGrid', () => {
  it('lays out October 2026 (starts on Thursday) in 5 weeks, Sunday first', () => {
    const grid = monthGrid('2026-10')
    expect(grid).toHaveLength(5)
    grid.forEach((week) => expect(week).toHaveLength(7))
    expect(grid[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03'])
    expect(grid[2][0]).toBe('2026-10-11')
    expect(grid[4]).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
  })

  it('has every day of the month exactly once, in order', () => {
    const days = daysIn(monthGrid('2026-10'))
    expect(days).toHaveLength(31)
    expect(days[0]).toBe('2026-10-01')
    expect(days[30]).toBe('2026-10-31')
    expect([...days].sort()).toEqual(days)
  })

  it('needs only 4 weeks for a 28-day February starting on Sunday', () => {
    // 1 Feb 2015 was a Sunday.
    const grid = monthGrid('2015-02')
    expect(grid).toHaveLength(4)
    expect(grid[0][0]).toBe('2015-02-01')
    expect(grid[3][6]).toBe('2015-02-28')
    expect(grid.flat()).not.toContain(null)
  })

  it('needs 6 weeks for a 31-day month starting on Saturday', () => {
    // 1 Aug 2026 is a Saturday.
    const grid = monthGrid('2026-08')
    expect(grid).toHaveLength(6)
    expect(grid[0]).toEqual([null, null, null, null, null, null, '2026-08-01'])
    expect(grid[5]).toEqual(['2026-08-30', '2026-08-31', null, null, null, null, null])
  })

  it('handles leap years (29 days in February 2024 and 2000, 28 in 2026 and 1900)', () => {
    expect(daysIn(monthGrid('2024-02'))).toHaveLength(29)
    expect(daysIn(monthGrid('2000-02'))).toHaveLength(29)
    expect(daysIn(monthGrid('2026-02'))).toHaveLength(28)
    expect(daysIn(monthGrid('1900-02'))).toHaveLength(28)
    // 1 Feb 2024 was a Thursday.
    expect(monthGrid('2024-02')[0][4]).toBe('2024-02-01')
  })

  it('treats 2100 as a common year (divisible by 100, not by 400)', () => {
    expect(daysIn(monthGrid('2100-02'))).toHaveLength(28)
    expect(parseDateParam('2100-02-29')).toBeNull()
  })

  it('places weekdays correctly for a year below 100 (not read as 19xx)', () => {
    monthGrid('0099-02').forEach((week) =>
      week.forEach((cell, weekday) => {
        if (cell === null) return
        const [y, m, d] = cell.split('-').map(Number)
        // new Date(99, ...) would mean 1999, so set the full year explicitly.
        const date = new Date(2000, 0, 1)
        date.setFullYear(y, m - 1, d)
        expect(date.getDay()).toBe(weekday)
      }),
    )
  })

  it('puts each day under its real weekday (checked against Date for a range of months)', () => {
    for (let year = 2023; year <= 2028; year += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const month = `${year}-${String(m).padStart(2, '0')}`
        monthGrid(month).forEach((week) =>
          week.forEach((cell, weekday) => {
            if (cell === null) return
            const [y, mm, d] = cell.split('-').map(Number)
            expect(new Date(y, mm - 1, d).getDay()).toBe(weekday)
          }),
        )
      }
    }
  })

  it('has no fully blank weeks', () => {
    for (const month of ['2026-01', '2026-05', '2026-08', '2015-02', '2024-02']) {
      monthGrid(month).forEach((week) => expect(week.some(Boolean)).toBe(true))
    }
  })

  it('throws for an invalid month', () => {
    expect(() => monthGrid('2026-13')).toThrow(RangeError)
    expect(() => monthGrid('2026-1')).toThrow(RangeError)
    expect(() => monthGrid(undefined)).toThrow(RangeError)
  })
})

describe('entryDates', () => {
  const entry = (date, extra = {}) => ({ id: date, date, deleted: false, ...extra })

  it('collects the dates of non-deleted entries, once per date', () => {
    const dates = entryDates([
      entry('2026-10-18'),
      entry('2026-10-18', { id: 'second' }),
      entry('2026-10-01'),
    ])
    expect(dates).toBeInstanceOf(Set)
    expect([...dates].sort()).toEqual(['2026-10-01', '2026-10-18'])
  })

  it('ignores deleted entries and tombstones', () => {
    const dates = entryDates([
      entry('2026-10-05', { deleted: true, deletedAt: '2026-10-06T00:00:00.000Z' }),
      // A tombstone only keeps id, updatedAt, deleted, deletedAt.
      { id: 't', updatedAt: '2026-10-06T00:00:00.000Z', deleted: true, deletedAt: '2026-10-06T00:00:00.000Z' },
      entry('2026-10-07'),
    ])
    expect([...dates]).toEqual(['2026-10-07'])
  })

  it('a date with only deleted entries is not marked, even if another entry was there', () => {
    const dates = entryDates([
      entry('2026-10-05', { deleted: true }),
      entry('2026-10-05', { id: 'b', deleted: true }),
    ])
    expect(dates.has('2026-10-05')).toBe(false)
  })

  it('ignores malformed items and invalid dates', () => {
    const dates = entryDates([
      null,
      undefined,
      '2026-10-01',
      42,
      {},
      { date: '' },
      { date: 20261001 },
      { date: '2026-02-30' },
      { date: '2026-10-1' },
      { date: '2026-10-01T00:00:00Z' },
      entry('2026-10-09'),
    ])
    expect([...dates]).toEqual(['2026-10-09'])
  })

  it('returns an empty set for an empty or non-array input', () => {
    expect(entryDates([]).size).toBe(0)
    expect(entryDates(undefined).size).toBe(0)
    expect(entryDates(null).size).toBe(0)
  })
})

describe('currentMonth', () => {
  it('uses the local date (Asia/Taipei in tests), not UTC', () => {
    // 2026-09-30T16:30Z is already 1 Oct 00:30 in Taipei.
    expect(currentMonth(new Date('2026-09-30T16:30:00Z'))).toBe('2026-10')
    // 2026-10-31T15:59Z is still 31 Oct 23:59 in Taipei.
    expect(currentMonth(new Date('2026-10-31T15:59:00Z'))).toBe('2026-10')
  })

  it('crosses the year boundary in local time', () => {
    // 15:59Z is 31 Dec 23:59 in Taipei, one minute before the new year.
    expect(currentMonth(new Date('2026-12-31T15:59:00Z'))).toBe('2026-12')
    expect(currentMonth(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01')
  })

  it('defaults to now', () => {
    const before = currentMonth(new Date())
    const value = currentMonth()
    expect(value).toMatch(/^\d{4}-\d{2}$/)
    expect([before, currentMonth(new Date())]).toContain(value)
  })
})

describe('addMonths', () => {
  it('moves forward and back within a year', () => {
    expect(addMonths('2026-10', 1)).toBe('2026-11')
    expect(addMonths('2026-10', -1)).toBe('2026-09')
    expect(addMonths('2026-10', 0)).toBe('2026-10')
  })

  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-10', 15)).toBe('2028-01')
    expect(addMonths('2026-10', -22)).toBe('2024-12')
    expect(addMonths('2026-10', -12)).toBe('2025-10')
  })

  it('returns null for an invalid month or step', () => {
    expect(addMonths('2026-13', 1)).toBeNull()
    expect(addMonths('bad', 1)).toBeNull()
    expect(addMonths('2026-10', 1.5)).toBeNull()
    expect(addMonths('2026-10', Number.NaN)).toBeNull()
    expect(addMonths('2026-10', '1')).toBeNull()
  })

  it('returns null when the result leaves the 4-digit year range', () => {
    expect(addMonths('9999-12', 1)).toBeNull()
    expect(addMonths('0001-01', -1)).toBeNull()
    expect(addMonths('0001-02', -1)).toBe('0001-01')
  })
})

describe('monthOfDate', () => {
  it('returns the month of a valid date', () => {
    expect(monthOfDate('2026-10-18')).toBe('2026-10')
    expect(monthOfDate('2024-02-29')).toBe('2024-02')
  })

  it('returns null for an invalid date', () => {
    expect(monthOfDate('2026-02-30')).toBeNull()
    expect(monthOfDate('2026-10')).toBeNull()
    expect(monthOfDate(null)).toBeNull()
  })
})

describe('parseMonthParam', () => {
  it('accepts YYYY-MM with a real month', () => {
    expect(parseMonthParam('2026-10')).toBe('2026-10')
    expect(parseMonthParam('2026-01')).toBe('2026-01')
    expect(parseMonthParam('2026-12')).toBe('2026-12')
  })

  it('rejects malformed or out-of-range values', () => {
    for (const value of [
      '2026-13',
      '2026-00',
      '2026-1',
      '10',
      '2026',
      '26-10',
      '0000-10',
      '2026-10-01',
      ' 2026-10',
      '2026-10 ',
      '２０２６-10',
      '2026/10',
      '',
    ]) {
      expect(parseMonthParam(value)).toBeNull()
    }
  })

  it('rejects non-strings (e.g. a missing URL parameter)', () => {
    expect(parseMonthParam(null)).toBeNull()
    expect(parseMonthParam(undefined)).toBeNull()
    expect(parseMonthParam(202610)).toBeNull()
  })
})

describe('parseDateParam', () => {
  it('accepts real calendar dates', () => {
    expect(parseDateParam('2026-10-18')).toBe('2026-10-18')
    expect(parseDateParam('2026-01-31')).toBe('2026-01-31')
    expect(parseDateParam('2024-02-29')).toBe('2024-02-29')
    expect(parseDateParam('2000-02-29')).toBe('2000-02-29')
  })

  it('rejects dates that do not exist', () => {
    expect(parseDateParam('2026-02-29')).toBeNull()
    expect(parseDateParam('1900-02-29')).toBeNull()
    expect(parseDateParam('2026-02-30')).toBeNull()
    expect(parseDateParam('2026-04-31')).toBeNull()
    expect(parseDateParam('2026-10-32')).toBeNull()
    expect(parseDateParam('2026-10-00')).toBeNull()
    expect(parseDateParam('2026-13-01')).toBeNull()
  })

  it('rejects malformed values', () => {
    for (const value of ['2026-10-1', '2026-1-18', '2026-10', '10', '2026-10-18T00:00', '2026/10/18', '', null, undefined, 20261018]) {
      expect(parseDateParam(value)).toBeNull()
    }
  })
})

describe('formatMonthTitle', () => {
  it('formats as 「YYYY 年 M 月」 without a leading zero', () => {
    expect(formatMonthTitle('2026-10')).toBe('2026 年 10 月')
    expect(formatMonthTitle('2027-01')).toBe('2027 年 1 月')
  })

  it('returns an empty string for an invalid month', () => {
    expect(formatMonthTitle('2026-13')).toBe('')
    expect(formatMonthTitle(undefined)).toBe('')
  })
})

describe('formatDayTitle', () => {
  it('formats as 「M月D日」 without leading zeros', () => {
    expect(formatDayTitle('2026-10-18')).toBe('10月18日')
    expect(formatDayTitle('2026-01-05')).toBe('1月5日')
  })

  it('returns an empty string for an invalid date', () => {
    expect(formatDayTitle('2026-02-30')).toBe('')
    expect(formatDayTitle(null)).toBe('')
  })
})
