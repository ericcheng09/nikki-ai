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

  it('renders the settings page on /settings without the menu', () => {
    renderAt('/settings')
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    // The menu is only on the home page.
    expect(screen.queryByRole('button', { name: '選單' })).not.toBeInTheDocument()
  })

  it('does not redirect a first-time user who opens /settings directly', () => {
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: false })
    renderAt('/settings')
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    expect(loadSettings).not.toHaveBeenCalled()
  })

  it('opens settings from the home menu and returns home', async () => {
    renderAt('/')
    await screen.findByText(/還沒有日記/)
    fireEvent.click(screen.getByRole('button', { name: '選單' }))
    fireEvent.click(screen.getByRole('link', { name: '設定' }))
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '回主畫面' }))
    expect(await screen.findByText(/還沒有日記/)).toBeInTheDocument()
  })

  it('links the title back to the home route', () => {
    renderAt('/entry/new')
    expect(screen.getByRole('link', { name: '外語學習日記' })).toHaveAttribute('href', '/')
  })
})
