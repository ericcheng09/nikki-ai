import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SampleEntryView from './SampleEntryView.jsx'
import { deleteEntry, deleteSampleEntry } from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  deleteEntry: vi.fn(),
  deleteSampleEntry: vi.fn(),
}))

const sample = {
  id: 'sample-id',
  date: '2026-10-17',
  content: '一行目\n二行目',
  language: 'auto',
  createdAt: '2026-10-17T01:00:00.000Z',
  updatedAt: '2026-10-17T01:00:00.000Z',
  deleted: false,
  deletedAt: null,
  isSample: true,
  analysis: { correctedText: 'ANALYSIS-SHOULD-NOT-SHOW' },
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/entry/sample-id']}>
      <Routes>
        <Route path="/" element={<p>主畫面</p>} />
        <Route path="/entry/:id" element={<SampleEntryView entry={sample} />} />
      </Routes>
    </MemoryRouter>,
  )
}

const deleteButton = () => screen.getByRole('button', { name: '刪除' })

afterEach(() => {
  vi.mocked(deleteSampleEntry).mockReset()
  vi.mocked(deleteEntry).mockReset()
  vi.restoreAllMocks()
})

describe('SampleEntryView', () => {
  it('shows the date, the content with line breaks and the 範例 label, read-only', () => {
    renderView()

    expect(screen.getByRole('heading', { name: /範例日記/ })).toHaveTextContent('範例')
    expect(screen.getByText('2026-10-17')).toBeInTheDocument()
    const content = screen.getByText(/一行目/)
    // textContent keeps the newline; CSS (pre-wrap) displays it.
    expect(content.textContent).toBe('一行目\n二行目')
    expect(content).toHaveClass('sample-content')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '儲存' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回列表' })).toHaveAttribute('href', '/')
  })

  it('does not show the stored analysis in Phase 1', () => {
    renderView()
    expect(screen.queryByText(/ANALYSIS-SHOULD-NOT-SHOW/)).not.toBeInTheDocument()
  })

  it('deletes the sample after confirmation and returns home', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(deleteSampleEntry).mockResolvedValue()
    renderView()

    fireEvent.click(deleteButton())

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(deleteSampleEntry).toHaveBeenCalledWith(sample)
    // Never the soft-delete path, which would leave a tombstone.
    expect(deleteEntry).not.toHaveBeenCalled()
    expect(await screen.findByText('主畫面')).toBeInTheDocument()
  })

  it('does nothing when the deletion is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderView()

    fireEvent.click(deleteButton())

    expect(deleteSampleEntry).not.toHaveBeenCalled()
    expect(screen.queryByText('主畫面')).not.toBeInTheDocument()
  })

  it('shows a Chinese error and stays when deleting fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(deleteSampleEntry).mockRejectedValue(new Error('io'))
    renderView()

    fireEvent.click(deleteButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法刪除日記，請重新整理頁面後再試一次。',
    )
    expect(deleteButton()).toBeEnabled()
  })

  it('deletes only once when clicked twice before the first delete finishes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolve
    vi.mocked(deleteSampleEntry).mockReturnValue(new Promise((r) => (resolve = r)))
    renderView()

    // One act() so React cannot re-render between the clicks.
    act(() => {
      fireEvent.click(deleteButton())
      fireEvent.click(deleteButton())
    })
    expect(deleteSampleEntry).toHaveBeenCalledTimes(1)

    await act(async () => resolve())
  })
})
