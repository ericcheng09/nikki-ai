import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DiaryList from './DiaryList.jsx'
import { loadEntries, seedSample } from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  loadEntries: vi.fn(),
  seedSample: vi.fn(),
}))

const entry = (id, date, createdAt, content = `content ${id}`) => ({
  id,
  date,
  content,
  createdAt,
  updatedAt: createdAt,
  deleted: false,
  deletedAt: null,
})

function renderList() {
  return render(
    <MemoryRouter>
      <DiaryList />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(seedSample).mockResolvedValue()
})

afterEach(() => {
  vi.mocked(loadEntries).mockReset()
  vi.mocked(seedSample).mockReset()
})

describe('DiaryList', () => {
  it('shows entries newest date first, later-written first within a day', async () => {
    vi.mocked(loadEntries).mockResolvedValue([
      entry('old', '2026-10-15', '2026-10-15T01:00:00.000Z'),
      entry('today-early', '2026-10-17', '2026-10-17T01:00:00.000Z'),
      entry('today-late', '2026-10-17', '2026-10-17T09:00:00.000Z'),
    ])
    renderList()

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
    vi.mocked(loadEntries).mockResolvedValue([
      entry('kept', '2026-10-17', '2026-10-17T01:00:00.000Z'),
      { id: 'gone', updatedAt: '2026-10-17T02:00:00.000Z', deleted: true, deletedAt: '2026-10-17T02:00:00.000Z' },
    ])
    renderList()

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('content kept')
  })

  it('truncates long content into a single-line preview', async () => {
    const long = 'a'.repeat(50) + '\n' + 'b'.repeat(50)
    vi.mocked(loadEntries).mockResolvedValue([
      entry('long', '2026-10-17', '2026-10-17T01:00:00.000Z', long),
    ])
    renderList()

    const item = await screen.findByRole('listitem')
    const text = item.querySelector('.entry-preview').textContent
    expect(text).toBe('a'.repeat(50) + ' ' + 'b'.repeat(29) + '…')
  })

  it('does not cut an emoji in half when truncating', async () => {
    // 79 ASCII chars + 2 emoji (surrogate pairs): the 80th character is the
    // first emoji, which must stay whole.
    const content = 'x'.repeat(79) + '😀😀'
    vi.mocked(loadEntries).mockResolvedValue([
      entry('emoji', '2026-10-17', '2026-10-17T01:00:00.000Z', content),
    ])
    renderList()

    const item = await screen.findByRole('listitem')
    expect(item.querySelector('.entry-preview').textContent).toBe(
      'x'.repeat(79) + '😀…',
    )
  })

  it('links each entry to its entry page', async () => {
    vi.mocked(loadEntries).mockResolvedValue([
      entry('abc', '2026-10-17', '2026-10-17T01:00:00.000Z'),
    ])
    renderList()

    const item = await screen.findByRole('listitem')
    expect(item.querySelector('a')).toHaveAttribute('href', '/entry/abc')
  })

  it('shows an empty state when there are no active entries', async () => {
    vi.mocked(loadEntries).mockResolvedValue([
      { id: 'gone', updatedAt: 'x', deleted: true, deletedAt: 'x' },
    ])
    renderList()

    expect(await screen.findByText(/還沒有日記/)).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('shows a Chinese error message when loading fails', async () => {
    vi.mocked(loadEntries).mockRejectedValue(new Error('boom'))
    renderList()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法存取本機資料，請重新整理頁面。',
    )
  })

  it('seeds the sample before loading the list', async () => {
    const order = []
    vi.mocked(seedSample).mockImplementation(async () => {
      order.push('seed')
    })
    vi.mocked(loadEntries).mockImplementation(async () => {
      order.push('load')
      return []
    })
    renderList()

    await screen.findByText(/還沒有日記/)
    expect(order.slice(0, 2)).toEqual(['seed', 'load'])
  })

  it('shows the 範例 badge only on the sample entry', async () => {
    vi.mocked(loadEntries).mockResolvedValue([
      { ...entry('sample', '2026-10-17', '2026-10-17T01:00:00.000Z'), isSample: true },
      entry('mine', '2026-10-16', '2026-10-16T01:00:00.000Z'),
    ])
    renderList()

    const [sampleItem, mineItem] = await screen.findAllByRole('listitem')
    expect(sampleItem).toHaveTextContent('範例')
    expect(mineItem).not.toHaveTextContent('範例')
  })

  it('shows the error message when seeding fails', async () => {
    vi.mocked(seedSample).mockRejectedValue(new Error('boom'))
    renderList()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法存取本機資料，請重新整理頁面。',
    )
    expect(loadEntries).not.toHaveBeenCalled()
  })

  it('links to the new entry page', async () => {
    vi.mocked(loadEntries).mockResolvedValue([])
    renderList()

    expect(screen.getByRole('link', { name: '新增日記' })).toHaveAttribute(
      'href',
      '/entry/new',
    )
    await screen.findByText(/還沒有日記/)
  })
})
