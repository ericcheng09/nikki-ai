import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DiaryEditor from './DiaryEditor.jsx'
import { saveEntry } from '../storage/connection.js'
import { getLocalDateString } from '../lib/diary.js'

vi.mock('../storage/connection.js', () => ({
  saveEntry: vi.fn(),
}))

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/entry/new']}>
      <Routes>
        <Route path="/" element={<p>主畫面</p>} />
        <Route path="/entry/new" element={<DiaryEditor />} />
      </Routes>
    </MemoryRouter>,
  )
}

const dateInput = () => screen.getByLabelText('日期')
const contentInput = () => screen.getByLabelText('內容')
const saveButton = () => screen.getByRole('button', { name: '儲存' })

afterEach(() => {
  vi.mocked(saveEntry).mockReset()
})

describe('DiaryEditor', () => {
  it('defaults the date picker to today in local time', () => {
    renderEditor()
    expect(dateInput()).toHaveAttribute('type', 'date')
    expect(dateInput()).toHaveValue(getLocalDateString())
  })

  it('saves a new entry with the chosen date and content, then returns home', async () => {
    vi.mocked(saveEntry).mockResolvedValue()
    renderEditor()

    fireEvent.change(dateInput(), { target: { value: '2026-10-01' } })
    fireEvent.change(contentInput(), { target: { value: '  Today I studied.\n' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText('主畫面')).toBeInTheDocument()
    expect(saveEntry).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(saveEntry).mock.calls[0][0]
    expect(saved).toMatchObject({
      date: '2026-10-01',
      // Stored exactly as typed, not trimmed.
      content: '  Today I studied.\n',
      language: 'auto',
      deleted: false,
      isSample: false,
      analysis: null,
    })
    expect(saved.id).toEqual(expect.any(String))
  })

  it.each([
    ['empty', ''],
    ['whitespace only', ' \n\t　 '],
  ])('does not save %s content and shows a hint', (_label, value) => {
    renderEditor()
    fireEvent.change(contentInput(), { target: { value } })
    fireEvent.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('內容不能空白')
    expect(saveEntry).not.toHaveBeenCalled()
    expect(screen.queryByText('主畫面')).not.toBeInTheDocument()
  })

  it('does not save when the date is cleared', () => {
    renderEditor()
    fireEvent.change(dateInput(), { target: { value: '' } })
    fireEvent.change(contentInput(), { target: { value: 'Hello' } })
    fireEvent.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('請選擇日期')
    expect(saveEntry).not.toHaveBeenCalled()
  })

  it('shows a Chinese error and stays on the page when saving fails', async () => {
    vi.mocked(saveEntry).mockRejectedValue(new Error('quota'))
    renderEditor()
    fireEvent.change(contentInput(), { target: { value: 'Hello' } })
    fireEvent.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法儲存日記，請重新整理頁面後再試一次。',
    )
    expect(contentInput()).toHaveValue('Hello')
    expect(saveButton()).toBeEnabled()
  })
})
