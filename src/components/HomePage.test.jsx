import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import HomePage from './HomePage.jsx'
import {
  isWelcomeSeenThisSession,
  loadEntries,
  loadSettings,
} from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  loadEntries: vi.fn(),
  loadSettings: vi.fn(),
  isWelcomeSeenThisSession: vi.fn(),
}))

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/welcome" element={<p>說明頁</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(loadEntries).mockResolvedValue([])
  vi.mocked(isWelcomeSeenThisSession).mockReturnValue(false)
})

afterEach(() => {
  vi.mocked(loadEntries).mockReset()
  vi.mocked(loadSettings).mockReset()
})

describe('HomePage', () => {
  it('redirects to /welcome when welcomeSeen is false', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: false })
    renderHome()
    expect(await screen.findByText('說明頁')).toBeInTheDocument()
    expect(screen.queryByText('我的日記')).not.toBeInTheDocument()
  })

  it('shows the diary list when welcomeSeen is true', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: true })
    renderHome()
    expect(await screen.findByText(/還沒有日記/)).toBeInTheDocument()
    // 設定 / 使用說明 live in the app-wide top bar, not on this page.
    expect(screen.queryByRole('button', { name: '選單' })).not.toBeInTheDocument()
    expect(screen.queryByText('說明頁')).not.toBeInTheDocument()
  })

  it('does not redirect when 開始使用 was pressed this session but not saved', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: false })
    vi.mocked(isWelcomeSeenThisSession).mockReturnValue(true)
    renderHome()
    expect(await screen.findByText(/還沒有日記/)).toBeInTheDocument()
    expect(screen.queryByText('說明頁')).not.toBeInTheDocument()
  })

  it('shows the list without redirecting when settings cannot be read', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
    vi.mocked(loadSettings).mockRejectedValue(new Error('boom'))
    renderHome()
    expect(await screen.findByText(/還沒有日記/)).toBeInTheDocument()
    expect(screen.queryByText('說明頁')).not.toBeInTheDocument()
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('shows a loading text while settings are being read', () => {
    vi.mocked(loadSettings).mockReturnValue(new Promise(() => {}))
    renderHome()
    expect(screen.getByText('載入中…')).toBeInTheDocument()
    expect(loadEntries).not.toHaveBeenCalled()
  })

  it('loads the entries once and shares them with the calendar and the list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-18T03:00:00Z'))
    try {
      vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: true })
      vi.mocked(loadEntries).mockResolvedValue([
        {
          id: 'a',
          date: '2026-10-05',
          content: 'hello',
          createdAt: '2026-10-05T01:00:00.000Z',
          updatedAt: '2026-10-05T01:00:00.000Z',
          deleted: false,
          deletedAt: null,
        },
        { id: 'gone', updatedAt: 'x', deleted: true, deletedAt: 'x' },
      ])
      renderHome()
      expect(await screen.findByRole('button', { name: '10月5日，有日記' })).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      expect(loadEntries).toHaveBeenCalledTimes(1)

      // DOM order: calendar, then the list.
      const calendar = screen.getByRole('region', { name: '2026 年 10 月' })
      const listHeading = screen.getByRole('heading', { name: '我的日記' })
      expect(calendar.compareDocumentPosition(listHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(calendar.closest('.home-layout')).toContainElement(listHeading)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the load error in the list and keeps the calendar without marks', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: true })
    vi.mocked(loadEntries).mockRejectedValue(new Error('boom'))
    renderHome()
    expect(await screen.findByRole('alert')).toHaveTextContent('無法存取本機資料，請重新整理頁面。')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /有日記/ })).not.toBeInTheDocument()
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

// --- Calendar selection kept in the URL (decisions.md Phase 3 日曆) -------

function LocationProbe() {
  const location = useLocation()
  const type = useNavigationType()
  return (
    <>
      <p data-testid="search">{location.search}</p>
      <p data-testid="nav-type">{type}</p>
    </>
  )
}

function renderHomeAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <HomePage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

const stored = (id, date, extra = {}) => ({
  id,
  date,
  content: `content ${id}`,
  createdAt: `${date}T01:00:00.000Z`,
  updatedAt: `${date}T01:00:00.000Z`,
  deleted: false,
  deletedAt: null,
  ...extra,
})

const search = () => screen.getByTestId('search').textContent
const navType = () => screen.getByTestId('nav-type').textContent
const listTitle = () => screen.getByRole('heading', { level: 2, name: /的日記$/ })
const monthTitle = () => screen.getByRole('heading', { level: 2, name: /年 .* 月/ })

describe('HomePage calendar selection', () => {
  beforeEach(() => {
    // 18 Oct 2026, 11:00 in Taipei.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-18T03:00:00Z'))
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: true })
    vi.mocked(loadEntries).mockResolvedValue([
      stored('a', '2026-10-18'),
      stored('b', '2026-10-05'),
      stored('c', '2026-09-03'),
      stored('d', '2026-10-09', { deleted: true, deletedAt: '2026-10-10T00:00:00.000Z' }),
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('selecting a marked day filters the list and writes month/date with replace', async () => {
    renderHomeAt('/')
    fireEvent.click(await screen.findByRole('button', { name: '10月5日，有日記' }))
    expect(search()).toBe('?month=2026-10&date=2026-10-05')
    expect(navType()).toBe('REPLACE')
    expect(listTitle()).toHaveTextContent('10月5日 的日記')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '10月5日，有日記' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking the selected day again shows the full list', async () => {
    renderHomeAt('/?month=2026-10&date=2026-10-05')
    fireEvent.click(await screen.findByRole('button', { name: '10月5日，有日記' }))
    expect(search()).toBe('?month=2026-10')
    expect(listTitle()).toHaveTextContent('我的日記')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('顯示全部 clears the selection and keeps the month', async () => {
    renderHomeAt('/?month=2026-09&date=2026-09-03')
    fireEvent.click(await screen.findByRole('button', { name: '顯示全部' }))
    expect(search()).toBe('?month=2026-09')
    expect(monthTitle()).toHaveTextContent('2026 年 9 月')
    expect(screen.queryByRole('button', { name: '顯示全部' })).not.toBeInTheDocument()
  })

  it('focuses the 我的日記 heading after 顯示全部 removes itself', async () => {
    renderHomeAt('/?month=2026-10&date=2026-10-05')
    fireEvent.click(await screen.findByRole('button', { name: '顯示全部' }))
    expect(listTitle()).toHaveTextContent('我的日記')
    expect(listTitle()).toHaveFocus()
  })

  it('changing the month clears the selected day', async () => {
    renderHomeAt('/?month=2026-10&date=2026-10-18')
    await screen.findByRole('button', { name: '顯示全部' })
    fireEvent.click(screen.getByRole('button', { name: '上個月' }))
    expect(search()).toBe('?month=2026-09')
    expect(navType()).toBe('REPLACE')
    expect(listTitle()).toHaveTextContent('我的日記')

    fireEvent.click(screen.getByRole('button', { name: '9月3日，有日記' }))
    fireEvent.click(screen.getByRole('button', { name: '今天' }))
    expect(search()).toBe('?month=2026-10')
  })

  it('restores month and selection from the URL', async () => {
    renderHomeAt('/?month=2026-09&date=2026-09-03')
    expect(await screen.findByRole('button', { name: '9月3日，有日記' })).toHaveAttribute('aria-pressed', 'true')
    expect(monthTitle()).toHaveTextContent('2026 年 9 月')
    expect(listTitle()).toHaveTextContent('9月3日 的日記')
    expect(search()).toBe('?month=2026-09&date=2026-09-03')
  })

  it('drops an invalid month (current month shown)', async () => {
    renderHomeAt('/?month=2026-13')
    await screen.findAllByRole('listitem')
    await waitFor(() => expect(search()).toBe(''))
    expect(navType()).toBe('REPLACE')
    expect(monthTitle()).toHaveTextContent('2026 年 10 月')
  })

  it('drops an invalid date and keeps a valid month', async () => {
    renderHomeAt('/?month=2026-09&date=2026-02-30')
    await waitFor(() => expect(search()).toBe('?month=2026-09'))
    expect(monthTitle()).toHaveTextContent('2026 年 9 月')
    expect(listTitle()).toHaveTextContent('我的日記')
  })

  it('drops a date whose entries are all deleted, once entries are loaded', async () => {
    renderHomeAt('/?month=2026-10&date=2026-10-09')
    await screen.findAllByRole('listitem')
    await waitFor(() => expect(search()).toBe('?month=2026-10'))
    expect(listTitle()).toHaveTextContent('我的日記')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('sets the month from the date when it is missing or different', async () => {
    renderHomeAt('/?date=2026-09-03')
    await waitFor(() => expect(search()).toBe('?month=2026-09&date=2026-09-03'))
    expect(monthTitle()).toHaveTextContent('2026 年 9 月')
  })

  it('replaces a different month with the month of the date', async () => {
    renderHomeAt('/?month=2025-01&date=2026-10-05')
    await waitFor(() => expect(search()).toBe('?month=2026-10&date=2026-10-05'))
    expect(screen.getByRole('button', { name: '10月5日，有日記' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the given month when the date has no entries', async () => {
    renderHomeAt('/?month=2026-09&date=2026-10-06')
    await screen.findAllByRole('listitem')
    await waitFor(() => expect(search()).toBe('?month=2026-09'))
    expect(monthTitle()).toHaveTextContent('2026 年 9 月')
    expect(listTitle()).toHaveTextContent('我的日記')
  })

  it('drops a date without entries and no month to the bare home URL', async () => {
    renderHomeAt('/?date=2026-10-06')
    await screen.findAllByRole('listitem')
    await waitFor(() => expect(search()).toBe(''))
    expect(monthTitle()).toHaveTextContent('2026 年 10 月')
  })

  it('does not rewrite the URL while entries are loading', async () => {
    vi.mocked(loadEntries).mockReturnValue(new Promise(() => {}))
    renderHomeAt('/?month=2026-09&date=2026-10-06')
    await screen.findByRole('table')
    expect(search()).toBe('?month=2026-09&date=2026-10-06')
    expect(navType()).toBe('POP')
  })

  it('keeps a valid date in the URL while entries are loading', async () => {
    vi.mocked(loadEntries).mockReturnValue(new Promise(() => {}))
    renderHomeAt('/?month=2026-10&date=2026-10-07')
    // The calendar is shown once the welcome check is done; the list is
    // still loading.
    await screen.findByRole('table')
    expect(screen.getByText('載入中…')).toBeInTheDocument()
    expect(loadEntries).toHaveBeenCalled()
    expect(search()).toBe('?month=2026-10&date=2026-10-07')
  })

  it('leaves a valid date alone when entries cannot be loaded', async () => {
    vi.mocked(loadEntries).mockRejectedValue(new Error('boom'))
    renderHomeAt('/?month=2026-10&date=2026-10-07')
    await screen.findByRole('alert')
    expect(search()).toBe('?month=2026-10&date=2026-10-07')
  })
})

