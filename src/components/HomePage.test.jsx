import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
