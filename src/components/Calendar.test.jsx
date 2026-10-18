import { fireEvent, render, screen, within } from '@testing-library/react'
import Calendar from './Calendar.jsx'

const entry = (date, extra = {}) => ({
  id: `id-${date}-${extra.id ?? ''}`,
  date,
  content: 'x',
  createdAt: `${date}T01:00:00.000Z`,
  updatedAt: `${date}T01:00:00.000Z`,
  deleted: false,
  deletedAt: null,
  ...extra,
})

const title = () => screen.getByRole('heading', { level: 2 })
const prev = () => screen.getByRole('button', { name: '上個月' })
const next = () => screen.getByRole('button', { name: '下個月' })
const todayButton = () => screen.getByRole('button', { name: '今天' })
const grid = () => screen.getByRole('table')

// "Now" is 18 Oct 2026, 11:00 in Taipei (the test timezone).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-18T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Calendar', () => {
  it('shows the current month with Sunday-first weekday headers', () => {
    render(<Calendar entries={[]} />)
    expect(title()).toHaveTextContent('2026 年 10 月')
    const headers = within(grid()).getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent)).toEqual(['日', '一', '二', '三', '四', '五', '六'])
    expect(headers[0]).toHaveAttribute('abbr', '星期日')
    // The table and the section are named by the month title.
    expect(grid()).toHaveAccessibleName('2026 年 10 月')
    expect(screen.getByRole('region', { name: '2026 年 10 月' })).toBeInTheDocument()
  })

  it('leaves cells of other months blank', () => {
    render(<Calendar entries={[]} />)
    const rows = within(grid()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(5)
    // 1 Oct 2026 is a Thursday: four blank cells first.
    const firstWeek = within(rows[0]).getAllByRole('cell')
    expect(firstWeek.map((td) => td.textContent)).toEqual(['', '', '', '', '1', '2', '3'])
    const lastWeek = within(rows[4]).getAllByRole('cell')
    expect(lastWeek.map((td) => td.textContent)).toEqual(['25', '26', '27', '28', '29', '30', '31'])
  })

  it('marks only days with non-deleted entries, as buttons named 「M月D日，有日記」', () => {
    render(
      <Calendar
        entries={[
          entry('2026-10-05'),
          entry('2026-10-05', { id: 'second' }),
          entry('2026-10-09', { deleted: true, deletedAt: '2026-10-10T00:00:00.000Z' }),
          { id: 'tomb', updatedAt: 'x', deleted: true, deletedAt: 'x' },
          entry('2026-11-02'),
        ]}
      />,
    )
    const buttons = within(grid()).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['10月5日，有日記'])
    expect(buttons[0]).toHaveClass('has-entry')
    expect(buttons[0]).toHaveTextContent('5')
  })

  it('renders days without entries as plain, unfocusable text', () => {
    const onSelectDate = vi.fn()
    render(<Calendar entries={[entry('2026-10-05')]} onSelectDate={onSelectDate} />)
    const plain = within(grid()).getByText('9')
    expect(plain.tagName).toBe('SPAN')
    expect(plain).not.toHaveAttribute('tabindex')
    expect(plain).not.toHaveClass('has-entry')
    fireEvent.click(plain)
    expect(onSelectDate).not.toHaveBeenCalled()
  })

  it('calls onSelectDate with the date of a marked day', () => {
    const onSelectDate = vi.fn()
    render(<Calendar entries={[entry('2026-10-05')]} onSelectDate={onSelectDate} />)
    fireEvent.click(screen.getByRole('button', { name: '10月5日，有日記' }))
    expect(onSelectDate).toHaveBeenCalledWith('2026-10-05')
  })

  it('does nothing on a marked day without onSelectDate', () => {
    render(<Calendar entries={[entry('2026-10-05')]} />)
    expect(() => fireEvent.click(screen.getByRole('button', { name: '10月5日，有日記' }))).not.toThrow()
  })

  it('outlines today with aria-current="date", with or without an entry', () => {
    const { rerender } = render(<Calendar entries={[]} />)
    const today = within(grid()).getByText('18')
    expect(today).toHaveAttribute('aria-current', 'date')
    expect(today).toHaveClass('is-today')
    expect(within(grid()).getByText('17')).not.toHaveAttribute('aria-current')

    rerender(<Calendar entries={[entry('2026-10-18')]} />)
    const button = screen.getByRole('button', { name: '10月18日，有日記' })
    expect(button).toHaveAttribute('aria-current', 'date')
    expect(button).toHaveClass('is-today', 'has-entry')
  })

  it('does not outline the same day number in another month', () => {
    render(<Calendar entries={[]} />)
    fireEvent.click(next())
    expect(within(grid()).getByText('18')).not.toHaveAttribute('aria-current')
  })

  it('switches months with ‹ and ›, across years, and 今天 returns', () => {
    render(<Calendar entries={[entry('2026-11-02'), entry('2027-01-15')]} />)
    fireEvent.click(next())
    expect(title()).toHaveTextContent('2026 年 11 月')
    expect(screen.getByRole('button', { name: '11月2日，有日記' })).toBeInTheDocument()
    fireEvent.click(next())
    fireEvent.click(next())
    expect(title()).toHaveTextContent('2027 年 1 月')
    expect(screen.getByRole('button', { name: '1月15日，有日記' })).toBeInTheDocument()

    fireEvent.click(todayButton())
    expect(title()).toHaveTextContent('2026 年 10 月')
    for (let i = 0; i < 10; i += 1) fireEvent.click(prev())
    expect(title()).toHaveTextContent('2025 年 12 月')
  })

  it('announces the month title politely', () => {
    render(<Calendar entries={[]} />)
    expect(title()).toHaveAttribute('aria-live', 'polite')
  })

  it('reports month changes when controlled and shows the given month', () => {
    const onMonthChange = vi.fn()
    render(<Calendar entries={[]} month="2026-12" onMonthChange={onMonthChange} />)
    expect(title()).toHaveTextContent('2026 年 12 月')
    fireEvent.click(next())
    expect(onMonthChange).toHaveBeenCalledWith('2027-01')
    // Controlled: the shown month only changes with the prop.
    expect(title()).toHaveTextContent('2026 年 12 月')
    fireEvent.click(todayButton())
    expect(onMonthChange).toHaveBeenLastCalledWith('2026-10')
  })

  it('does not report 今天 when already on the current month', () => {
    const onMonthChange = vi.fn()
    render(<Calendar entries={[]} month="2026-10" onMonthChange={onMonthChange} />)
    fireEvent.click(todayButton())
    expect(onMonthChange).not.toHaveBeenCalled()
  })

  it('falls back to the current month for an invalid controlled month', () => {
    for (const month of ['2026-13', 'bad', null, '2026-1']) {
      const { unmount } = render(<Calendar entries={[]} month={month} />)
      expect(title()).toHaveTextContent('2026 年 10 月')
      unmount()
    }
  })

  it('disables ‹ at 0001-01 and › at 9999-12 instead of crashing', () => {
    const onMonthChange = vi.fn()
    const { rerender } = render(<Calendar entries={[]} month="0001-01" onMonthChange={onMonthChange} />)
    expect(title()).toHaveTextContent('1 年 1 月')
    expect(prev()).toBeDisabled()
    expect(next()).toBeEnabled()
    fireEvent.click(prev())
    expect(onMonthChange).not.toHaveBeenCalled()

    rerender(<Calendar entries={[]} month="9999-12" onMonthChange={onMonthChange} />)
    expect(title()).toHaveTextContent('9999 年 12 月')
    expect(next()).toBeDisabled()
    expect(prev()).toBeEnabled()
    fireEvent.click(next())
    expect(onMonthChange).not.toHaveBeenCalled()
    fireEvent.click(prev())
    expect(onMonthChange).toHaveBeenCalledWith('9999-11')
  })

  it('treats a missing entries prop as no marks', () => {
    render(<Calendar />)
    expect(within(grid()).queryByRole('button')).not.toBeInTheDocument()
  })
})
