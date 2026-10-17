import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App.jsx'
import { loadEntries, loadEntry } from './storage/connection.js'

vi.mock('./storage/connection.js', () => ({
  loadEntries: vi.fn(),
  loadEntry: vi.fn(),
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
})

describe('App', () => {
  it('renders the Chinese title and the diary list on the home route', async () => {
    renderAt('/')
    expect(
      screen.getByRole('heading', { level: 1, name: '外語學習日記' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '我的日記' })).toBeInTheDocument()
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

  it('links the title back to the home route', () => {
    renderAt('/entry/new')
    expect(screen.getByRole('link', { name: '外語學習日記' })).toHaveAttribute('href', '/')
  })
})
