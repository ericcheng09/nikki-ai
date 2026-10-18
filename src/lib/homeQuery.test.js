import { homeSearchParams, resolveHomeQuery } from './homeQuery.js'

const marked = new Set(['2026-10-18', '2026-09-03'])

describe('resolveHomeQuery', () => {
  it('keeps a valid month and a date that has entries', () => {
    expect(resolveHomeQuery({ month: '2026-10', date: '2026-10-18' }, marked)).toEqual({
      month: '2026-10',
      date: '2026-10-18',
    })
  })

  it('returns nulls for missing parameters', () => {
    expect(resolveHomeQuery({ month: null, date: null }, marked)).toEqual({ month: null, date: null })
    expect(resolveHomeQuery({}, null)).toEqual({ month: null, date: null })
  })

  it('drops an invalid month', () => {
    for (const month of ['2026-13', '2026-1', '10', 'x', '']) {
      expect(resolveHomeQuery({ month, date: null }, marked)).toEqual({ month: null, date: null })
    }
  })

  it('drops an invalid date and keeps a valid month', () => {
    for (const date of ['2026-02-30', '2026-10-1', 'today', '']) {
      expect(resolveHomeQuery({ month: '2026-08', date }, marked)).toEqual({ month: '2026-08', date: null })
    }
  })

  it('drops a valid date without non-deleted entries once entries are known', () => {
    expect(resolveHomeQuery({ month: '2026-10', date: '2026-10-05' }, marked)).toEqual({
      month: '2026-10',
      date: null,
    })
    expect(resolveHomeQuery({ month: '2026-10', date: '2026-10-18' }, new Set())).toEqual({
      month: '2026-10',
      date: null,
    })
  })

  it('keeps the given month when a date without entries is dropped', () => {
    expect(resolveHomeQuery({ month: '2026-09', date: '2026-10-06' }, marked)).toEqual({
      month: '2026-09',
      date: null,
    })
    expect(resolveHomeQuery({ month: null, date: '2026-10-06' }, marked)).toEqual({
      month: null,
      date: null,
    })
  })

  it('keeps a valid date while entries are still unknown', () => {
    expect(resolveHomeQuery({ month: '2026-10', date: '2026-10-05' }, null)).toEqual({
      month: '2026-10',
      date: '2026-10-05',
    })
  })

  it('takes the month from the date when the month is missing, invalid or different', () => {
    for (const month of [null, '2026-13', '2026-10']) {
      expect(resolveHomeQuery({ month, date: '2026-09-03' }, marked)).toEqual({
        month: '2026-09',
        date: '2026-09-03',
      })
    }
  })
})

describe('homeSearchParams', () => {
  it('writes month and date', () => {
    const next = homeSearchParams(new URLSearchParams(), { month: '2026-10', date: '2026-10-18' })
    expect(next.toString()).toBe('month=2026-10&date=2026-10-18')
  })

  it('removes unset values and keeps other parameters', () => {
    const next = homeSearchParams(new URLSearchParams('month=2026-13&date=x&other=1'), {
      month: null,
      date: null,
    })
    expect(next.toString()).toBe('other=1')
  })

  it('does not modify the given params', () => {
    const current = new URLSearchParams('month=2026-10')
    homeSearchParams(current, { month: '2026-11', date: null })
    expect(current.toString()).toBe('month=2026-10')
  })
})
