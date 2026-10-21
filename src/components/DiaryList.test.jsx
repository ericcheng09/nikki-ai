import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DiaryList from './DiaryList.jsx'

const entry = (id, date, createdAt, content = `content ${id}`) => ({
  id,
  date,
  content,
  createdAt,
  updatedAt: createdAt,
  deleted: false,
  deletedAt: null,
})

function renderList(entries = [], status = 'ready') {
  return render(
    <MemoryRouter>
      <DiaryList status={status} entries={entries} />
    </MemoryRouter>,
  )
}

describe('DiaryList', () => {
  it('shows entries newest date first, later-written first within a day', async () => {
    renderList([
      entry('old', '2026-10-15', '2026-10-15T01:00:00.000Z'),
      entry('today-early', '2026-10-17', '2026-10-17T01:00:00.000Z'),
      entry('today-late', '2026-10-17', '2026-10-17T09:00:00.000Z'),
    ])

    const items = await screen.findAllByRole('listitem')
    expect(items.map((li) => li.querySelector('.entry-preview').textContent)).toEqual([
      'content today-late',
      'content today-early',
      'content old',
    ])
    expect(items[0]).toHaveTextContent('2026-10-17')
    expect(items[2]).toHaveTextContent('2026-10-15')
  })

  it('does not show soft-deleted entries', async () => {
    renderList([
      entry('kept', '2026-10-17', '2026-10-17T01:00:00.000Z'),
      { id: 'gone', updatedAt: '2026-10-17T02:00:00.000Z', deleted: true, deletedAt: '2026-10-17T02:00:00.000Z' },
    ])

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('content kept')
  })

  it('truncates long content into a single-line preview', async () => {
    const long = 'a'.repeat(50) + '\n' + 'b'.repeat(50)
    renderList([
      entry('long', '2026-10-17', '2026-10-17T01:00:00.000Z', long),
    ])

    const item = await screen.findByRole('listitem')
    const text = item.querySelector('.entry-preview').textContent
    expect(text).toBe('a'.repeat(50) + ' ' + 'b'.repeat(29) + '…')
  })

  it('does not cut an emoji in half when truncating', async () => {
    // 79 ASCII chars + 2 emoji (surrogate pairs): the 80th character is the
    // first emoji, which must stay whole.
    const content = 'x'.repeat(79) + '😀😀'
    renderList([
      entry('emoji', '2026-10-17', '2026-10-17T01:00:00.000Z', content),
    ])

    const item = await screen.findByRole('listitem')
    expect(item.querySelector('.entry-preview').textContent).toBe(
      'x'.repeat(79) + '😀…',
    )
  })

  it('links each entry to its entry page', async () => {
    renderList([
      entry('abc', '2026-10-17', '2026-10-17T01:00:00.000Z'),
    ])

    const item = await screen.findByRole('listitem')
    expect(item.querySelector('a')).toHaveAttribute('href', '/entry/abc')
  })

  it('shows an empty state when there are no active entries', async () => {
    renderList([
      { id: 'gone', updatedAt: 'x', deleted: true, deletedAt: 'x' },
    ])

    expect(await screen.findByText(/還沒有日記/)).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('shows a Chinese error message when loading fails', async () => {
    renderList([], 'error')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法存取本機資料，請重新整理頁面。',
    )
  })

  it('links to the new entry page', async () => {
    renderList([])

    expect(screen.getByRole('link', { name: '新增日記' })).toHaveAttribute(
      'href',
      '/entry/new',
    )
    await screen.findByText(/還沒有日記/)
  })
})

describe('DiaryList (status)', () => {
  it('shows only a loading text while loading, even if entries are passed', () => {
    renderList([entry('a', '2026-10-17', '2026-10-17T01:00:00.000Z')], 'loading')
    expect(screen.getByText('載入中…')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.queryByText(/還沒有日記/)).not.toBeInTheDocument()
  })

  it('treats missing entries as an empty list', () => {
    renderList(undefined)
    expect(screen.getByText(/還沒有日記/)).toBeInTheDocument()
  })
})

describe('DiaryList (selected day)', () => {
  const all = [
    entry('a', '2026-10-18', '2026-10-18T01:00:00.000Z'),
    entry('b', '2026-10-17', '2026-10-17T01:00:00.000Z'),
    entry('c', '2026-10-18', '2026-10-18T09:00:00.000Z'),
    { id: 'gone', updatedAt: 'x', deleted: true, deletedAt: 'x' },
  ]

  function renderSelected(selectedDate, onShowAll = vi.fn()) {
    render(
      <MemoryRouter>
        <DiaryList status="ready" entries={all} selectedDate={selectedDate} onShowAll={onShowAll} />
      </MemoryRouter>,
    )
    return onShowAll
  }

  it('lists only that day, newest written first, under 「M月D日 的日記」', () => {
    renderSelected('2026-10-18')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('10月18日 的日記')
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.querySelector('.entry-preview').textContent)).toEqual([
      'content c',
      'content a',
    ])
  })

  it('calls onShowAll from 顯示全部', () => {
    const onShowAll = renderSelected('2026-10-18')
    fireEvent.click(screen.getByRole('button', { name: '顯示全部' }))
    expect(onShowAll).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the heading once the selection is cleared, reading 我的日記', () => {
    // The parent clears the selection in a later render, like the URL update.
    function Parent() {
      const [date, setDate] = useState('2026-10-18')
      return (
        <MemoryRouter>
          <DiaryList status="ready" entries={all} selectedDate={date} onShowAll={() => setDate(null)} />
        </MemoryRouter>
      )
    }
    // Record the heading text at the moment focus is moved.
    const focused = []
    const original = HTMLElement.prototype.focus
    const tracked = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function focus(...args) {
      focused.push(this.textContent)
      return original.apply(this, args)
    })
    try {
      render(<Parent />)
      fireEvent.click(screen.getByRole('button', { name: '顯示全部' }))
      const heading = screen.getByRole('heading', { level: 2 })
      expect(heading).toHaveTextContent('我的日記')
      expect(heading).toHaveFocus()
      // Focus happened only after the title had changed.
      expect(focused).toEqual(['我的日記'])
      // Focusable from script only, not a tab stop.
      expect(heading).toHaveAttribute('tabindex', '-1')
    } finally {
      tracked.mockRestore()
    }
  })

  it('does not move focus while the selection is still set', () => {
    const onShowAll = renderSelected('2026-10-18')
    fireEvent.click(screen.getByRole('button', { name: '顯示全部' }))
    expect(onShowAll).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveFocus()
  })

  it('drops the focus request when the selection moves to another day instead', () => {
    // The parent ignores 顯示全部 and picks another day; a later clear that
    // 顯示全部 did not ask for must not move focus either.
    function Parent() {
      const [date, setDate] = useState('2026-10-18')
      return (
        <MemoryRouter>
          <button type="button" onClick={() => setDate(null)}>
            外部清除
          </button>
          <DiaryList status="ready" entries={all} selectedDate={date} onShowAll={() => setDate('2026-10-05')} />
        </MemoryRouter>
      )
    }
    render(<Parent />)
    fireEvent.click(screen.getByRole('button', { name: '顯示全部' }))
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).not.toHaveTextContent('我的日記')
    expect(heading).not.toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '外部清除' }))
    expect(heading).toHaveTextContent('我的日記')
    expect(heading).not.toHaveFocus()
  })

  it('has no 顯示全部 and the normal title without a selection', () => {
    renderSelected(null)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('我的日記')
    expect(screen.queryByRole('button', { name: '顯示全部' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('keeps 新增日記 linking to a plain new entry while a day is selected', () => {
    renderSelected('2026-10-18')
    expect(screen.getByRole('link', { name: '新增日記' })).toHaveAttribute('href', '/entry/new')
  })
})

describe('DiaryList (groups)', () => {
  beforeEach(() => {
    // 2026-10-20 local noon, so the day does not depend on the test timezone.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 20, 12))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const all = [
    entry('old', '2026-09-30', '2026-09-30T01:00:00.000Z'),
    entry('month', '2026-10-05', '2026-10-05T01:00:00.000Z'),
    entry('today-early', '2026-10-20', '2026-10-20T01:00:00.000Z'),
    entry('yesterday', '2026-10-19', '2026-10-19T01:00:00.000Z'),
    entry('future', '2026-11-02', '2026-10-20T02:00:00.000Z'),
    entry('today-late', '2026-10-20', '2026-10-20T09:00:00.000Z'),
    { id: 'gone', updatedAt: 'x', deleted: true, deletedAt: 'x' },
  ]

  // [group title, [previews]] in document order.
  const groupsOnScreen = () =>
    screen.getAllByRole('list').map((list) => [
      document.getElementById(list.getAttribute('aria-labelledby')).textContent,
      Array.from(list.querySelectorAll('.entry-preview'), (p) => p.textContent),
    ])

  it('groups the full list into 今天, 昨天 and months, order unchanged', () => {
    renderList(all)
    expect(groupsOnScreen()).toEqual([
      ['2026 年 11 月', ['content future']],
      ['今天', ['content today-late', 'content today-early']],
      ['昨天', ['content yesterday']],
      ['2026 年 10 月', ['content month']],
      ['2026 年 9 月', ['content old']],
    ])
    // Group titles are h3 under the h2 我的日記 and name their list; no
    // landmark is added (it would clash with the calendar's month name).
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('我的日記')
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(5)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    // Each entry still shows its full date.
    expect(screen.getByRole('list', { name: '今天' }).querySelector('time')).toHaveTextContent('2026-10-20')
  })

  it('omits groups without entries', () => {
    renderList([entry('old', '2026-09-30', '2026-09-30T01:00:00.000Z')])
    expect(groupsOnScreen()).toEqual([['2026 年 9 月', ['content old']]])
    expect(screen.queryByRole('heading', { name: '今天' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '昨天' })).not.toBeInTheDocument()
  })

  it('does not group a selected day', () => {
    render(
      <MemoryRouter>
        <DiaryList status="ready" entries={all} selectedDate="2026-10-20" onShowAll={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
    expect(screen.getAllByRole('list')).toHaveLength(1)
    expect(screen.getByRole('list')).not.toHaveAttribute('aria-labelledby')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows no groups while loading or when empty', () => {
    renderList(all, 'loading')
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
    cleanup()
    renderList([])
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })
})
