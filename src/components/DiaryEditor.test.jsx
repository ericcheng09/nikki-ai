import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import DiaryEditor from './DiaryEditor.jsx'
import {
  deleteEntry,
  loadSettings,
  saveEntry,
  saveEntryAddingLanguage,
  saveEntryEdit,
} from '../storage/connection.js'
import { getLocalDateString, updateEntry } from '../lib/diary.js'

vi.mock('../storage/connection.js', () => ({
  loadSettings: vi.fn(),
  saveEntry: vi.fn(),
  saveEntryAddingLanguage: vi.fn(),
  saveEntryEdit: vi.fn(),
  saveEntryAnalysis: vi.fn(),
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

// "Today" is fixed so date-limit checks are deterministic. Only Date is
// faked; real timers keep Testing Library's async helpers working.
const TODAY = '2026-10-25'
// Records written by edit-mode saves (saveEntryEdit), in call order. The
// mock merges the changes like the real storage would on an unchanged
// stored record.
let editWrites
beforeEach(() => {
  editWrites = []
  vi.mocked(saveEntryEdit).mockImplementation(async (base, changes) => {
    const record = updateEntry(base, changes)
    editWrites.push(record)
    return record
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 0))
  vi.mocked(loadSettings).mockResolvedValue({ customLanguages: [] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(saveEntry).mockReset()
  vi.mocked(deleteEntry).mockReset()
  vi.mocked(loadSettings).mockReset()
  vi.mocked(saveEntryAddingLanguage).mockReset()
  vi.mocked(saveEntryEdit).mockReset()
  vi.restoreAllMocks()
})

describe('DiaryEditor (new entry)', () => {
  it('defaults the date picker to today in local time', () => {
    renderEditor()
    expect(dateInput()).toHaveValue(TODAY)
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
    // The status live region exists from the start, empty.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
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

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('已儲存'),
    )
    const saved = editWrites[0]
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
    await screen.findByText('已儲存')
    fireEvent.change(dateInput(), { target: { value: '2026-10-20' } })
    fireEvent.click(saveButton())
    await screen.findByText('已儲存')

    const second = editWrites[1]
    expect(second).toMatchObject({ content: 'First edit', date: '2026-10-20' })
  })

  it('hides 已儲存 once the user changes the content again', async () => {
    vi.mocked(saveEntry).mockResolvedValue()
    renderEditor(existing)
    fireEvent.click(saveButton())
    await screen.findByText('已儲存')
    fireEvent.change(contentInput(), { target: { value: 'More' } })
    // The live region stays in the DOM; only its text is cleared.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('does not save when the content is changed to blank', () => {
    renderEditor(existing)
    fireEvent.change(contentInput(), { target: { value: '  \n ' } })
    fireEvent.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('內容不能空白')
    expect(saveEntryEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
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
    await screen.findByText('已儲存')
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

  it('does not save over an entry deleted meanwhile and keeps the typed text', async () => {
    vi.mocked(saveEntryEdit).mockResolvedValue(null)
    renderEditor(existing)
    fireEvent.change(contentInput(), { target: { value: 'Typed after delete' } })
    fireEvent.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('這篇日記已被刪除，無法儲存。')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(contentInput()).toHaveValue('Typed after delete')
    expect(saveButton()).toBeEnabled()
  })

  it('does not add a typed language when the entry was deleted meanwhile', async () => {
    vi.mocked(saveEntryEdit).mockResolvedValue(null)
    renderEditor(existing)
    await waitFor(() => expect(loadSettings).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('語言'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('語言名稱'), { target: { value: '韓文' } })
    fireEvent.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('這篇日記已被刪除，無法儲存。')
    // The option list is not extended and 其他 keeps the typed name.
    const labels = Array.from(screen.getByLabelText('語言').options).map((o) => o.textContent)
    expect(labels).not.toContain('韓文')
    expect(screen.getByLabelText('語言名稱')).toHaveValue('韓文')
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

describe('DiaryEditor (date limit)', () => {
  it.each([
    ['new', undefined],
    ['edit', existing],
  ])('limits the date picker to today (%s)', (_mode, entry) => {
    renderEditor(entry)
    expect(dateInput()).toHaveAttribute('max', TODAY)
  })

  it('does not save a new entry dated after today and keeps the input', () => {
    renderEditor()
    fireEvent.change(dateInput(), { target: { value: '2026-10-26' } })
    fireEvent.change(contentInput(), { target: { value: 'Tomorrow' } })
    fireEvent.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('日期不能晚於今天')
    expect(saveEntry).not.toHaveBeenCalled()
    expect(contentInput()).toHaveValue('Tomorrow')
    expect(dateInput()).toHaveValue('2026-10-26')
  })

  it('does not save an edit that moves the date after today', () => {
    renderEditor(existing)
    fireEvent.change(dateInput(), { target: { value: '2027-01-01' } })
    fireEvent.change(contentInput(), { target: { value: 'Edited' } })
    fireEvent.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('日期不能晚於今天')
    expect(saveEntryEdit).not.toHaveBeenCalled()
    expect(contentInput()).toHaveValue('Edited')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('blocks saving an existing entry that is already dated in the future', () => {
    renderEditor({ ...existing, date: '2026-12-31' })
    expect(dateInput()).toHaveValue('2026-12-31')
    fireEvent.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('日期不能晚於今天')
    expect(saveEntryEdit).not.toHaveBeenCalled()
  })

  it('saves an entry dated today', async () => {
    vi.mocked(saveEntry).mockResolvedValue()
    renderEditor()
    fireEvent.change(dateInput(), { target: { value: TODAY } })
    fireEvent.change(contentInput(), { target: { value: 'Today' } })
    fireEvent.click(saveButton())

    const saved = vi.mocked(saveEntry).mock.calls[0][0]
    expect(saved.date).toBe(TODAY)
    expect(await screen.findByText(`日記頁 ${saved.id}`)).toBeInTheDocument()
  })

  it('re-evaluates today when saving, e.g. after the page stayed open past midnight', async () => {
    vi.mocked(saveEntry).mockResolvedValue()
    vi.setSystemTime(new Date(2026, 9, 25, 23, 59, 0))
    renderEditor()
    // Midnight passes while the form is open: Oct 26 becomes today.
    vi.setSystemTime(new Date(2026, 9, 26, 0, 1, 0))
    fireEvent.change(dateInput(), { target: { value: '2026-10-26' } })
    fireEvent.change(contentInput(), { target: { value: 'After midnight' } })
    fireEvent.click(saveButton())

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(vi.mocked(saveEntry).mock.calls[0][0].date).toBe('2026-10-26')
  })

  it('reports a future date before checking for blank content', () => {
    renderEditor()
    fireEvent.change(dateInput(), { target: { value: '2026-10-26' } })
    fireEvent.click(saveButton())
    // Future date is reported before the blank-content message.
    expect(screen.getByRole('alert')).toHaveTextContent('日期不能晚於今天')
  })
})

describe('DiaryEditor (language)', () => {
  const languageSelect = () => screen.getByLabelText('語言')
  const otherInput = () => screen.getByLabelText('語言名稱')
  const optionLabels = () =>
    Array.from(languageSelect().options).map((option) => option.textContent)
  const selectedLabel = () => languageSelect().selectedOptions[0].textContent

  const item = (name, deleted = false) => ({
    name,
    updatedAt: '2026-10-01T00:00:00.000Z',
    deleted,
    deletedAt: deleted ? '2026-10-01T00:00:00.000Z' : null,
  })

  function withList(list) {
    vi.mocked(loadSettings).mockResolvedValue({ customLanguages: list })
  }

  // Waits until the custom list from settings is reflected in the select.
  async function waitForOption(label) {
    await waitFor(() => expect(optionLabels()).toContain(label))
  }

  function fillContent(text = 'Bonjour') {
    fireEvent.change(contentInput(), { target: { value: text } })
  }

  function chooseOther(text) {
    fireEvent.change(languageSelect(), { target: { value: '' } })
    fireEvent.change(otherInput(), { target: { value: text } })
  }

  it('sits between 日期 and 內容 and defaults to 自動判斷 for a new entry', async () => {
    withList([item('韓文'), item('法文', true)])
    renderEditor()
    await waitForOption('韓文')
    const fields = Array.from(document.querySelectorAll('input, select, textarea'))
    expect(fields.indexOf(languageSelect())).toBe(fields.indexOf(dateInput()) + 1)
    expect(fields.indexOf(contentInput())).toBe(fields.indexOf(languageSelect()) + 1)
    expect(selectedLabel()).toBe('自動判斷')
    // Deleted languages are not offered to other entries.
    expect(optionLabels()).toEqual(['自動判斷', '日文', '英文', '韓文', '其他'])
    expect(screen.queryByLabelText('語言名稱')).not.toBeInTheDocument()
  })

  it('gives the select the accessible name 語言 exactly', () => {
    renderEditor()
    // Exact match: the name must not include the option texts.
    expect(screen.getByRole('combobox', { name: '語言' })).toBe(languageSelect())
  })

  it('saves a built-in language without touching the list', async () => {
    vi.mocked(saveEntry).mockResolvedValue()
    renderEditor()
    fillContent()
    fireEvent.change(languageSelect(), { target: { value: '日文' } })
    fireEvent.click(saveButton())
    expect(vi.mocked(saveEntry).mock.calls[0][0].language).toBe('日文')
    expect(saveEntryAddingLanguage).not.toHaveBeenCalled()
    await screen.findByText(/日記頁/)
  })

  it('shows a 語言名稱 field for 其他 and saves the trimmed custom language', async () => {
    vi.mocked(saveEntryAddingLanguage).mockResolvedValue()
    renderEditor()
    fillContent()
    fireEvent.change(languageSelect(), { target: { value: '' } })
    expect(otherInput()).toHaveAttribute('placeholder', '例如：韓文')
    fireEvent.change(otherInput(), { target: { value: '  韓文 ' } })
    fireEvent.click(saveButton())

    expect(saveEntry).not.toHaveBeenCalled()
    expect(saveEntryAddingLanguage).toHaveBeenCalledTimes(1)
    const [saved, added] = vi.mocked(saveEntryAddingLanguage).mock.calls[0]
    expect(saved.language).toBe('韓文')
    expect(added).toBe('韓文')
    expect(await screen.findByText(`日記頁 ${saved.id}`)).toBeInTheDocument()
  })

  it.each([
    ['日文', '日文'],
    [' 英文 ', '英文'],
    ['自動判斷', 'auto'],
    ['auto', 'auto'],
  ])('treats %j typed into 其他 as the existing option', async (typed, stored) => {
    vi.mocked(saveEntry).mockResolvedValue()
    renderEditor()
    fillContent()
    chooseOther(typed)
    fireEvent.click(saveButton())
    expect(vi.mocked(saveEntry).mock.calls[0][0].language).toBe(stored)
    expect(saveEntryAddingLanguage).not.toHaveBeenCalled()
    await screen.findByText(/日記頁/)
  })

  it('does not save a blank 其他 and keeps everything typed', () => {
    renderEditor()
    fireEvent.change(dateInput(), { target: { value: '2026-10-01' } })
    fillContent('Keep me')
    chooseOther('   ')
    fireEvent.click(saveButton())
    expect(screen.getByRole('alert')).toHaveTextContent('請輸入日記語言')
    expect(saveEntry).not.toHaveBeenCalled()
    expect(saveEntryAddingLanguage).not.toHaveBeenCalled()
    expect(dateInput()).toHaveValue('2026-10-01')
    expect(contentInput()).toHaveValue('Keep me')
    expect(otherInput()).toHaveValue('   ')
    expect(languageSelect()).toHaveValue('')
  })

  it('checks blank content before the language', () => {
    renderEditor()
    chooseOther('')
    fireEvent.click(saveButton())
    expect(screen.getByRole('alert')).toHaveTextContent('內容不能空白')
  })

  it('checks the date before the language', () => {
    renderEditor()
    fillContent()
    chooseOther('')
    fireEvent.change(dateInput(), { target: { value: '' } })
    fireEvent.click(saveButton())
    expect(screen.getByRole('alert')).toHaveTextContent('請選擇日期')
  })

  it('clears the language error when the user types a name', () => {
    renderEditor()
    fillContent()
    chooseOther('')
    fireEvent.click(saveButton())
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(otherInput(), { target: { value: '韓' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('still saves when the language list cannot be loaded', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
    vi.mocked(loadSettings).mockRejectedValue(new Error('boom'))
    vi.mocked(saveEntryAddingLanguage).mockResolvedValue()
    renderEditor()
    await waitFor(() => expect(loadSettings).toHaveBeenCalled())
    expect(optionLabels()).toEqual(['自動判斷', '日文', '英文', '其他'])
    fillContent()
    chooseOther('泰文')
    fireEvent.click(saveButton())
    expect(saveEntryAddingLanguage).toHaveBeenCalledWith(
      expect.objectContaining({ language: '泰文' }),
      '泰文',
    )
    await screen.findByText(/日記頁/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('keeps the inputs and shows an error when saving with a custom language fails', async () => {
    vi.mocked(saveEntryAddingLanguage).mockRejectedValue(new Error('boom'))
    renderEditor()
    fillContent('Keep me')
    chooseOther('韓文')
    fireEvent.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('無法儲存日記')
    expect(otherInput()).toHaveValue('韓文')
    expect(contentInput()).toHaveValue('Keep me')
  })

  describe('edit mode', () => {
    it('preselects the entry language', async () => {
      withList([item('韓文')])
      renderEditor({ ...existing, language: '韓文' })
      await waitForOption('韓文')
      expect(selectedLabel()).toBe('韓文')
      expect(optionLabels().filter((label) => label === '韓文')).toHaveLength(1)
    })

    it.each([[undefined], [42], [''], ['   ']])(
      'treats a missing or invalid language (%j) as 自動判斷',
      (value) => {
        renderEditor({ ...existing, language: value })
        expect(selectedLabel()).toBe('自動判斷')
      },
    )

    it('keeps showing a deleted custom language and does not re-add it on save', async () => {
      withList([item('法文', true)])
      vi.mocked(saveEntry).mockResolvedValue()
      renderEditor({ ...existing, language: '法文' })
      await waitFor(() => expect(loadSettings).toHaveBeenCalled())
      expect(selectedLabel()).toBe('法文')
      expect(optionLabels()).toEqual(['自動判斷', '日文', '英文', '法文', '其他'])
      fillContent('Edited')
      fireEvent.click(saveButton())
      expect(await screen.findByText('已儲存')).toBeInTheDocument()
      expect(editWrites[0].language).toBe('法文')
      expect(vi.mocked(saveEntryEdit).mock.calls[0][2]).toBeNull()
    })

    it('shows a custom language that was never listed', () => {
      renderEditor({ ...existing, language: '泰文' })
      expect(selectedLabel()).toBe('泰文')
    })

    it('counts a language-only change as a modification and keeps the analysis', async () => {
      vi.mocked(saveEntry).mockResolvedValue()
      const analysis = { grammarErrors: [] }
      renderEditor({ ...existing, analysis })
      fireEvent.change(languageSelect(), { target: { value: '英文' } })
      fireEvent.click(saveButton())
      expect(await screen.findByText('已儲存')).toBeInTheDocument()
      const saved = editWrites[0]
      expect(saved.language).toBe('英文')
      expect(saved.content).toBe(existing.content)
      expect(saved.analysis).toBe(analysis)
      expect(saved.updatedAt > existing.updatedAt).toBe(true)
    })

    it('selects a newly added custom language after saving', async () => {
      vi.mocked(saveEntryAddingLanguage).mockResolvedValue()
      vi.mocked(saveEntry).mockResolvedValue()
      renderEditor(existing)
      await waitFor(() => expect(loadSettings).toHaveBeenCalled())
      chooseOther(' 韓文 ')
      fireEvent.click(saveButton())
      expect(await screen.findByText('已儲存')).toBeInTheDocument()
      expect(selectedLabel()).toBe('韓文')
      expect(screen.queryByLabelText('語言名稱')).not.toBeInTheDocument()
      expect(optionLabels()).toEqual(['自動判斷', '日文', '英文', '韓文', '其他'])

      // Saving again keeps the language and does not add it again.
      fillContent('Second save')
      fireEvent.click(saveButton())
      await waitFor(() => expect(saveEntryEdit).toHaveBeenCalledTimes(2))
      expect(editWrites[1].language).toBe('韓文')
      expect(vi.mocked(saveEntryEdit).mock.calls.map((call) => call[2])).toEqual(['韓文', null])
    })

    it('merges a language added by a save into a list that loads later', async () => {
      let finishLoad
      vi.mocked(loadSettings).mockReturnValue(
        new Promise((resolve) => {
          finishLoad = resolve
        }),
      )
      vi.mocked(saveEntryAddingLanguage).mockResolvedValue()
      renderEditor(existing)
      chooseOther('韓文')
      fireEvent.click(saveButton())
      expect(await screen.findByText('已儲存')).toBeInTheDocument()
      // The late result was read before the save and lacks 韓文; 韓文 is
      // kept and the other saved languages still appear, without duplicates.
      await act(async () =>
        finishLoad({ customLanguages: [item('法文'), item('德文', true)] }),
      )
      expect(optionLabels()).toEqual(['自動判斷', '日文', '英文', '法文', '韓文', '其他'])
      expect(selectedLabel()).toBe('韓文')
    })

    it('does not duplicate an added language that the late list already has', async () => {
      let finishLoad
      vi.mocked(loadSettings).mockReturnValue(
        new Promise((resolve) => {
          finishLoad = resolve
        }),
      )
      vi.mocked(saveEntryAddingLanguage).mockResolvedValue()
      renderEditor(existing)
      chooseOther('韓文')
      fireEvent.click(saveButton())
      expect(await screen.findByText('已儲存')).toBeInTheDocument()
      await act(async () => finishLoad({ customLanguages: [item('韓文'), item('法文')] }))
      expect(optionLabels()).toEqual(['自動判斷', '日文', '英文', '韓文', '法文', '其他'])
    })

    it('still applies a list that loads after a save without a new language', async () => {
      let finishLoad
      vi.mocked(loadSettings).mockReturnValue(
        new Promise((resolve) => {
          finishLoad = resolve
        }),
      )
      vi.mocked(saveEntry).mockResolvedValue()
      renderEditor(existing)
      fillContent('Edited')
      fireEvent.click(saveButton())
      expect(await screen.findByText('已儲存')).toBeInTheDocument()
      await act(async () => finishLoad({ customLanguages: [item('法文')] }))
      expect(optionLabels()).toContain('法文')
    })

    it('does not duplicate an active language typed into 其他', async () => {
      withList([item('韓文')])
      vi.mocked(saveEntryAddingLanguage).mockResolvedValue()
      renderEditor(existing)
      await waitForOption('韓文')
      chooseOther('韓文')
      fireEvent.click(saveButton())
      expect(await screen.findByText('已儲存')).toBeInTheDocument()
      expect(editWrites[0].language).toBe('韓文')
      expect(optionLabels().filter((label) => label === '韓文')).toHaveLength(1)
      expect(selectedLabel()).toBe('韓文')
    })
  })
})

describe('DiaryEditor (layout)', () => {
  it('wraps the form and the AI panel, in that order, for a saved entry', () => {
    renderEditor(existing)
    const form = saveButton().closest('form')
    const layout = form.parentElement
    expect(layout).toHaveClass('entry-layout')
    const panel = screen.getByRole('region', { name: 'AI 批改結果' })
    expect(Array.from(layout.children)).toEqual([form, panel])
  })

  it('has no two-column layout for a new entry', () => {
    renderEditor()
    expect(document.querySelector('.entry-layout')).toBeNull()
    expect(screen.queryByRole('region', { name: 'AI 批改結果' })).not.toBeInTheDocument()
  })
})

describe('DiaryEditor (navigation)', () => {
  it.each([
    ['new', undefined],
    ['edit', existing],
  ])('has no bottom 返回列表 / 取消 link (%s); the top bar has 返回', (_mode, entry) => {
    renderEditor(entry)
    expect(screen.queryByRole('link', { name: '返回列表' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '取消' })).not.toBeInTheDocument()
    expect(saveButton()).toBeInTheDocument()
  })
})
