import { render, screen } from '@testing-library/react'
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
