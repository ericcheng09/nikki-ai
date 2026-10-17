import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import DiaryEditor from './DiaryEditor.jsx'
import { deleteEntry, saveEntry } from '../storage/connection.js'
import { getLocalDateString } from '../lib/diary.js'

vi.mock('../storage/connection.js', () => ({
  saveEntry: vi.fn(),
  deleteEntry: vi.fn(),
}))

function EntryStub() {
  const { id } = useParams()
  return <p>日記頁 {id}</p>
}

function renderEditor(entry) {
  const path = entry ? `/entry/${entry.id}` : '/entry/new'
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>主畫面</p>} />
        <Route path="/entry/new" element={<DiaryEditor />} />
        <Route
          path="/entry/:id"
          element={entry ? <DiaryEditor entry={entry} /> : <EntryStub />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

const existing = {
  id: 'entry-1',
  date: '2026-10-15',
  content: 'Original text',
  language: 'auto',
  createdAt: '2026-10-15T01:00:00.000Z',
  updatedAt: '2026-10-15T01:00:00.000Z',
  deleted: false,
  deletedAt: null,
  isSample: false,
  analysis: null,
}

const dateInput = () => screen.getByLabelText('日期')
const contentInput = () => screen.getByLabelText('內容')
const saveButton = () => screen.getByRole('button', { name: '儲存' })
const deleteButton = () => screen.getByRole('button', { name: '刪除' })

// A promise the test resolves by hand, to keep an operation "in flight".
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.mocked(saveEntry).mockReset()
  vi.mocked(deleteEntry).mockReset()
  vi.restoreAllMocks()
})

describe('DiaryEditor (new entry)', () => {
  it('defaults the date picker to today in local time', () => {
    renderEditor()
    expect(screen.getByRole('heading', { name: '新增日記' })).toBeInTheDocument()
    expect(dateInput()).toHaveAttribute('type', 'date')
    expect(dateInput()).toHaveValue(getLocalDateString())
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument()
  })

  it('saves a new entry, then goes to that entry page', async () => {
    vi.mocked(saveEntry).mockResolvedValue()
    renderEditor()

    fireEvent.change(dateInput(), { target: { value: '2026-10-01' } })
    fireEvent.change(contentInput(), { target: { value: '  Today I studied.\n' } })
    fireEvent.click(saveButton())

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
    expect(await screen.findByText(`日記頁 ${saved.id}`)).toBeInTheDocument()
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
  })

  it('clears the error message when the user edits the content', () => {
    renderEditor()
    fireEvent.click(saveButton())
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(contentInput(), { target: { value: 'H' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not save when the date is cleared', () => {
    renderEditor()
    fireEvent.change(dateInput(), { target: { value: '' } })
    fireEvent.change(contentInput(), { target: { value: 'Hello' } })
    fireEvent.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('請選擇日期')
    expect(saveEntry).not.toHaveBeenCalled()
  })

  it('saves only once when submitted twice before the first save finishes', async () => {
    const pending = deferred()
    vi.mocked(saveEntry).mockReturnValue(pending.promise)
    renderEditor()
    fireEvent.change(contentInput(), { target: { value: 'Hello' } })

    // Both submits run inside one act(), so React cannot re-render between
    // them: the second handler call still sees the stale `busy` state and
    // only the synchronous ref lock can stop it.
    const form = saveButton().closest('form')
    act(() => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })
    expect(saveEntry).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve())
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

describe('DiaryEditor (edit entry)', () => {
  it('shows the stored date and content in an edit form', () => {
    renderEditor(existing)
    expect(screen.getByRole('heading', { name: '編輯日記' })).toBeInTheDocument()
    expect(dateInput()).toHaveValue('2026-10-15')
    expect(contentInput()).toHaveValue('Original text')
    expect(deleteButton()).toBeInTheDocument()
  })

  it('saves edits with a newer updatedAt, stays on the page and shows 已儲存', async () => {
    vi.mocked(saveEntry).mockResolvedValue()
    renderEditor(existing)

    fireEvent.change(dateInput(), { target: { value: '2026-10-16' } })
    fireEvent.change(contentInput(), { target: { value: 'Edited text' } })
    fireEvent.click(saveButton())

    expect(await screen.findByRole('status')).toHaveTextContent('已儲存')
    const saved = vi.mocked(saveEntry).mock.calls[0][0]
    expect(saved).toMatchObject({
      id: 'entry-1',
      createdAt: existing.createdAt,
      date: '2026-10-16',
      content: 'Edited text',
    })
    expect(saved.updatedAt > existing.updatedAt).toBe(true)
    expect(screen.queryByText('主畫面')).not.toBeInTheDocument()
    expect(contentInput()).toHaveValue('Edited text')
  })

  it('builds the second save on top of the first one', async () => {
    vi.mocked(saveEntry).mockResolvedValue()
    renderEditor(existing)

    fireEvent.change(contentInput(), { target: { value: 'First edit' } })
    fireEvent.click(saveButton())
    await screen.findByRole('status')
    fireEvent.change(dateInput(), { target: { value: '2026-10-20' } })
    fireEvent.click(saveButton())
    await screen.findByRole('status')

    const second = vi.mocked(saveEntry).mock.calls[1][0]
    expect(second).toMatchObject({ content: 'First edit', date: '2026-10-20' })
  })

  it('hides 已儲存 once the user changes the content again', async () => {
    vi.mocked(saveEntry).mockResolvedValue()
    renderEditor(existing)
    fireEvent.click(saveButton())
    await screen.findByRole('status')
    fireEvent.change(contentInput(), { target: { value: 'More' } })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not save when the content is changed to blank', () => {
    renderEditor(existing)
    fireEvent.change(contentInput(), { target: { value: '  \n ' } })
    fireEvent.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('內容不能空白')
    expect(saveEntry).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('soft-deletes after confirmation and returns home', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(deleteEntry).mockResolvedValue()
    renderEditor(existing)

    fireEvent.click(deleteButton())

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(deleteEntry).toHaveBeenCalledWith(existing)
    expect(await screen.findByText('主畫面')).toBeInTheDocument()
  })

  it('deletes the latest saved version after an edit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(saveEntry).mockResolvedValue()
    vi.mocked(deleteEntry).mockResolvedValue()
    renderEditor(existing)

    fireEvent.change(contentInput(), { target: { value: 'Edited' } })
    fireEvent.click(saveButton())
    await screen.findByRole('status')
    fireEvent.click(deleteButton())

    await screen.findByText('主畫面')
    expect(vi.mocked(deleteEntry).mock.calls[0][0]).toMatchObject({
      id: 'entry-1',
      content: 'Edited',
    })
  })

  it('does nothing when the deletion is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderEditor(existing)

    fireEvent.click(deleteButton())

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(deleteEntry).not.toHaveBeenCalled()
    expect(contentInput()).toHaveValue('Original text')
    expect(screen.queryByText('主畫面')).not.toBeInTheDocument()
  })

  it('shows a Chinese error and stays when deleting fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(deleteEntry).mockRejectedValue(new Error('io'))
    renderEditor(existing)

    fireEvent.click(deleteButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法刪除日記，請重新整理頁面後再試一次。',
    )
    expect(deleteButton()).toBeEnabled()
  })

  it('deletes only once when clicked twice before the first delete finishes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const pending = deferred()
    vi.mocked(deleteEntry).mockReturnValue(pending.promise)
    renderEditor(existing)

    // See the submit test above: one act() prevents a re-render in between.
    act(() => {
      fireEvent.click(deleteButton())
      fireEvent.click(deleteButton())
    })
    expect(deleteEntry).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve())
  })
})
