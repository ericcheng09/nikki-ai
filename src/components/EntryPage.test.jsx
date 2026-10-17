import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import EntryPage from './EntryPage.jsx'
import { loadEntry } from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  loadEntry: vi.fn(),
  loadSettings: vi.fn(() => Promise.resolve({ customLanguages: [] })),
  saveEntry: vi.fn(),
  saveEntryAddingLanguage: vi.fn(),
  deleteEntry: vi.fn(),
}))

function renderAt(id) {
  return render(
    <MemoryRouter initialEntries={[`/entry/${id}`]}>
      <Routes>
        <Route path="/" element={<p>主畫面</p>} />
        <Route path="/entry/:id" element={<EntryPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.mocked(loadEntry).mockReset()
})

describe('EntryPage', () => {
  it('loads the entry by id and shows the edit form', async () => {
    vi.mocked(loadEntry).mockResolvedValue({
      id: 'abc',
      date: '2026-10-17',
      content: 'Hello',
      createdAt: '2026-10-17T01:00:00.000Z',
      updatedAt: '2026-10-17T01:00:00.000Z',
      deleted: false,
      deletedAt: null,
    })
    renderAt('abc')

    expect(await screen.findByRole('heading', { name: '編輯日記' })).toBeInTheDocument()
    expect(loadEntry).toHaveBeenCalledWith('abc')
    expect(screen.getByLabelText('內容')).toHaveValue('Hello')
  })

  it('shows 找不到這篇日記 for an unknown id, without a form', async () => {
    vi.mocked(loadEntry).mockResolvedValue(undefined)
    renderAt('missing')

    expect(await screen.findByText('找不到這篇日記')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回主畫面' })).toHaveAttribute('href', '/')
    expect(screen.queryByLabelText('內容')).not.toBeInTheDocument()
  })

  it('treats a soft-deleted entry as not found', async () => {
    vi.mocked(loadEntry).mockResolvedValue({
      id: 'gone',
      updatedAt: '2026-10-17T02:00:00.000Z',
      deleted: true,
      deletedAt: '2026-10-17T02:00:00.000Z',
    })
    renderAt('gone')

    expect(await screen.findByText('找不到這篇日記')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument()
  })

  it('shows a Chinese error when loading fails', async () => {
    vi.mocked(loadEntry).mockRejectedValue(new Error('boom'))
    renderAt('abc')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法存取本機資料，請重新整理頁面。',
    )
  })
})
