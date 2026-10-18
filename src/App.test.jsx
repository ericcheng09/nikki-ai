import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App.jsx'
import { loadEntries, loadEntry, loadSettings } from './storage/connection.js'

vi.mock('./storage/connection.js', () => ({
  loadEntries: vi.fn(),
  loadEntry: vi.fn(),
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
  isWelcomeSeenThisSession: vi.fn(() => false),
  markWelcomeSeen: vi.fn(),
  saveEntry: vi.fn(),
  saveEntryAddingLanguage: vi.fn(),
  deleteCustomLanguage: vi.fn(),
  deleteEntry: vi.fn(),
}))

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(loadEntries).mockResolvedValue([])
  // Most tests start as a returning user, so "/" shows the list.
  vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: true })
})

describe('App', () => {
  it('renders the Chinese title and the diary list on the home route', async () => {
    renderAt('/')
    expect(
      screen.getByRole('heading', { level: 1, name: '外語學習日記' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 2, name: '我的日記' }),
    ).toBeInTheDocument()
    await screen.findByText(/還沒有日記/)
  })

  it('renders the editor on /entry/new', () => {
    renderAt('/entry/new')
    expect(screen.getByRole('heading', { level: 2, name: '新增日記' })).toBeInTheDocument()
    expect(screen.getByLabelText('日期')).toBeInTheDocument()
  })

  it('navigates from the list to the editor via the 新增日記 button', async () => {
    renderAt('/')
    await screen.findByText(/還沒有日記/)
    fireEvent.click(screen.getByRole('link', { name: '新增日記' }))
    expect(screen.getByRole('button', { name: '儲存' })).toBeInTheDocument()
  })

  it('renders the entry page on /entry/:id', async () => {
    vi.mocked(loadEntry).mockResolvedValue(undefined)
    renderAt('/entry/some-id')
    expect(await screen.findByText('找不到這篇日記')).toBeInTheDocument()
    expect(loadEntry).toHaveBeenCalledWith('some-id')
  })

  it('sends a first-time user from "/" to the welcome page', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: false })
    renderAt('/')
    expect(
      await screen.findByRole('heading', { name: '歡迎使用外語學習日記' }),
    ).toBeInTheDocument()
  })

  it('renders the welcome page on /welcome', () => {
    renderAt('/welcome')
    expect(screen.getByRole('heading', { name: '歡迎使用外語學習日記' })).toBeInTheDocument()
  })

  it('does not redirect a first-time user who opens an entry URL directly', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: false })
    vi.mocked(loadEntry).mockResolvedValue(undefined)
    renderAt('/entry/some-id')
    expect(await screen.findByText('找不到這篇日記')).toBeInTheDocument()
    expect(loadSettings).not.toHaveBeenCalled()
  })

  it('renders the settings page on /settings with the top bar', async () => {
    renderAt('/settings')
    await screen.findByRole('heading', { level: 3, name: 'Gemini API key' })
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '設定' })).not.toBeInTheDocument()
  })

  it.each([['/'], ['/entry/new'], ['/welcome']])('shows the top bar on %s', (path) => {
    renderAt(path)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '外語學習日記' })).toHaveAttribute('href', '/')
  })

  it('has a back button on the not-found entry page, next to 回主畫面', async () => {
    vi.mocked(loadEntry).mockResolvedValue(undefined)
    renderAt('/entry/missing')
    expect(await screen.findByText('找不到這篇日記')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回主畫面' })).toHaveAttribute('href', '/')
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(await screen.findByText(/還沒有日記/)).toBeInTheDocument()
  })

  it('does not redirect a first-time user who opens /settings directly', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: false, geminiApiKey: '' })
    renderAt('/settings')
    // Settings are read for the API key section, but welcomeSeen is ignored.
    expect(await screen.findByText('尚未設定 API key')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '歡迎使用外語學習日記' }),
    ).not.toBeInTheDocument()
  })

  it('opens settings from the top bar and goes back home', async () => {
    renderAt('/')
    await screen.findByText(/還沒有日記/)
    fireEvent.click(screen.getByRole('link', { name: '設定' }))
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(await screen.findByText(/還沒有日記/)).toBeInTheDocument()
  })

  it('opens the welcome page from the top bar', async () => {
    renderAt('/')
    await screen.findByText(/還沒有日記/)
    fireEvent.click(screen.getByRole('link', { name: '使用說明' }))
    expect(screen.getByRole('heading', { name: '歡迎使用外語學習日記' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '開始使用' })).toBeInTheDocument()
  })

  it('links the title back to the home route', () => {
    renderAt('/entry/new')
    expect(screen.getByRole('link', { name: '外語學習日記' })).toHaveAttribute('href', '/')
  })
})
