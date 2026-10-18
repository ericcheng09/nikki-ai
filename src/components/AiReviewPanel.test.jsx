import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DiaryEditor from './DiaryEditor.jsx'
import { GeminiError, generateAnalysis } from '../lib/gemini.js'
import { updateEntry } from '../lib/diary.js'
import {
  loadSettings,
  saveEntry,
  saveEntryAnalysis,
  saveEntryEdit,
} from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  loadSettings: vi.fn(),
  saveEntry: vi.fn(),
  saveEntryAddingLanguage: vi.fn(),
  saveEntryEdit: vi.fn(),
  saveEntryAnalysis: vi.fn(),
  deleteEntry: vi.fn(),
}))

// Only the network call is mocked; error messages and GeminiError are real.
vi.mock('../lib/gemini.js', async (importOriginal) => ({
  ...(await importOriginal()),
  generateAnalysis: vi.fn(),
}))

const existing = {
  id: 'entry-1',
  date: '2026-10-15',
  content: 'I go to school yesterday.',
  language: '英文',
  createdAt: '2026-10-15T01:00:00.000Z',
  updatedAt: '2026-10-15T01:00:00.000Z',
  deleted: false,
  deletedAt: null,
  analysis: null,
}

const analysis = (overrides = {}) => ({
  detectedLanguage: '英文',
  grammarErrors: [
    { original: 'I go', corrected: 'I went', explanation: '過去式' },
  ],
  unclearSentences: [],
  naturalExpressions: [],
  correctedText: 'I **went** to school yesterday.',
  translation: '我昨天去了學校。',
  // 11:04 in Asia/Taipei, where unit tests run.
  analyzedAt: '2026-10-25T03:04:00.000Z',
  ...overrides,
})

// Waits for the editor's language list load, so it settles inside act().
async function renderEditor(entry) {
  const path = entry ? `/entry/${entry.id}` : '/entry/new'
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>主畫面</p>} />
        <Route path="/settings" element={<p>設定頁</p>} />
        <Route path="/entry/new" element={<DiaryEditor />} />
        <Route path="/entry/:id" element={<DiaryEditor entry={entry} />} />
      </Routes>
    </MemoryRouter>,
  )
  await act(async () => {})
  return result
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const reviewButton = () => screen.getByRole('button', { name: /AI 批改|批改中…/ })
const contentInput = () => screen.getByLabelText('內容')
const resultRegion = () => screen.getByRole('region', { name: 'AI 批改結果' })

// Writes the analysis onto the given entry like the real storage does.
function storeAnalysisOn(entry) {
  vi.mocked(saveEntryAnalysis).mockImplementation(async (id, value) => ({
    ...entry,
    id,
    analysis: value,
    updatedAt: '2026-10-25T04:00:00.000Z',
  }))
}

let consoleSpies
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 25, 12, 0, 0))
  vi.mocked(loadSettings).mockResolvedValue({
    customLanguages: [],
    geminiApiKey: 'test-key',
    geminiModel: 'models/gemini-2.5-flash',
  })
  vi.mocked(saveEntryEdit).mockImplementation(async (base, changes) => updateEntry(base, changes))
  storeAnalysisOn(existing)
  // Nothing in the review flow may log (key, diary, prompt or response).
  consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((name) =>
    vi.spyOn(console, name),
  )
})

afterEach(() => {
  // Unmount first so a failed check below cannot leak this test's DOM.
  cleanup()
  const logged = consoleSpies.some((spy) => spy.mock.calls.length > 0)
  vi.useRealTimers()
  vi.mocked(generateAnalysis).mockReset()
  vi.mocked(saveEntryAnalysis).mockReset()
  vi.mocked(saveEntryEdit).mockReset()
  vi.mocked(saveEntry).mockReset()
  vi.mocked(loadSettings).mockReset()
  vi.restoreAllMocks()
  expect(logged, 'nothing may be logged').toBe(false)
})

describe('AI review button', () => {
  it('is not shown for a new, unsaved entry', async () => {
    await renderEditor()
    expect(screen.queryByRole('button', { name: 'AI 批改' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AI 批改結果' })).not.toBeInTheDocument()
  })

  it('is shown for a saved entry, with the result heading and no result yet', async () => {
    await renderEditor(existing)
    expect(reviewButton()).toHaveTextContent('AI 批改')
    expect(reviewButton()).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'AI 批改結果' })).toBeInTheDocument()
    expect(within(resultRegion()).queryByText(/批改時間/)).not.toBeInTheDocument()
    expect(screen.queryByText('無法顯示批改結果，請重新批改。')).not.toBeInTheDocument()
  })

  it('does not send anything when the entry is saved', async () => {
    await renderEditor(existing)
    fireEvent.change(contentInput(), { target: { value: 'I went to school.' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
    expect(generateAnalysis).not.toHaveBeenCalled()
    expect(saveEntryAnalysis).not.toHaveBeenCalled()
  })

  it('reads settings at click time and sends the saved entry', async () => {
    vi.mocked(generateAnalysis).mockResolvedValue(analysis())
    await renderEditor(existing)
    // Settings changed after the page opened (e.g. on the settings page).
    vi.mocked(loadSettings).mockResolvedValue({
      customLanguages: [],
      geminiApiKey: 'new-key',
      geminiModel: 'models/gemini-2.5-pro',
    })
    fireEvent.click(reviewButton())
    await screen.findByText(/批改時間/)
    expect(generateAnalysis).toHaveBeenCalledTimes(1)
    expect(generateAnalysis).toHaveBeenCalledWith({
      apiKey: 'new-key',
      model: 'models/gemini-2.5-pro',
      entry: { content: existing.content, language: '英文' },
    })
    expect(saveEntryAnalysis).toHaveBeenCalledWith('entry-1', analysis())
  })
})

describe('unsaved changes', () => {
  it.each([
    ['content', () => fireEvent.change(contentInput(), { target: { value: 'Changed' } })],
    ['date', () => fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-16' } })],
    ['language', () => fireEvent.change(screen.getByLabelText('語言'), { target: { value: '日文' } })],
    ['language (其他, blank)', () => fireEvent.change(screen.getByLabelText('語言'), { target: { value: '' } })],
  ])('blocks the review after a %s change', async (_field, change) => {
    await renderEditor(existing)
    change()
    fireEvent.click(reviewButton())
    expect(screen.getByRole('alert')).toHaveTextContent('請先儲存日記再批改')
    expect(loadSettings).toHaveBeenCalledTimes(1) // only the editor's list load
    expect(generateAnalysis).not.toHaveBeenCalled()
  })

  it('does not count typing the saved language into 其他 as a change', async () => {
    vi.mocked(generateAnalysis).mockResolvedValue(analysis())
    await renderEditor(existing)
    fireEvent.change(screen.getByLabelText('語言'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('語言名稱'), { target: { value: ' 英文 ' } })
    fireEvent.click(reviewButton())
    await screen.findByText(/批改時間/)
    expect(generateAnalysis).toHaveBeenCalledTimes(1)
  })

  it('allows the review again once the changes are saved', async () => {
    vi.mocked(generateAnalysis).mockResolvedValue(analysis())
    await renderEditor(existing)
    fireEvent.change(contentInput(), { target: { value: 'I went to school.' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await screen.findByText('已儲存')
    fireEvent.click(reviewButton())
    await screen.findByText(/批改時間/)
    expect(vi.mocked(generateAnalysis).mock.calls[0][0].entry.content).toBe('I went to school.')
  })
})

describe('errors', () => {
  it.each([
    ['noKey', '請先到設定頁設定 Gemini API key。', true],
    ['noModel', '請先到設定頁選擇 Gemini 模型。', true],
    ['invalidKey', 'API key 無效，請到設定頁確認。', true],
    ['modelUnavailable', '所選的模型已無法使用，請到設定頁重新選擇。', true],
    ['quota', '已達 Gemini 使用額度上限，請稍後再試。', false],
    ['network', '無法連線到 Gemini，請檢查網路後再試一次。', false],
    ['format', 'AI 回傳的格式不正確，請再試一次。', false],
    ['other', '批改失敗，請稍後再試一次。', false],
  ])('shows the message for %s', async (code, message, hasLink) => {
    vi.mocked(generateAnalysis).mockRejectedValue(new GeminiError(code))
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    const link = within(alert).queryByRole('link', { name: '前往設定頁' })
    if (hasLink) {
      expect(link).toHaveAttribute('href', '/settings')
    } else {
      expect(link).not.toBeInTheDocument()
    }
    expect(saveEntryAnalysis).not.toHaveBeenCalled()
    expect(reviewButton()).toHaveTextContent('AI 批改')
    expect(reviewButton()).toBeEnabled()
    // The diary itself is untouched.
    expect(contentInput()).toHaveValue(existing.content)
  })

  it('opens the settings page from the link', async () => {
    vi.mocked(generateAnalysis).mockRejectedValue(new GeminiError('noKey'))
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    fireEvent.click(await screen.findByRole('link', { name: '前往設定頁' }))
    expect(screen.getByText('設定頁')).toBeInTheDocument()
  })

  it('shows the generic message for an unexpected error, never its text', async () => {
    vi.mocked(generateAnalysis).mockRejectedValue(new Error('<b>secret-key</b>'))
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('批改失敗，請稍後再試一次。')
    expect(alert).not.toHaveTextContent('secret-key')
  })

  it('shows the generic message when settings cannot be read', async () => {
    await renderEditor(existing)
    await waitFor(() => expect(loadSettings).toHaveBeenCalledTimes(1))
    vi.mocked(loadSettings).mockRejectedValue(new Error('io'))
    fireEvent.click(reviewButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('批改失敗，請稍後再試一次。')
    expect(generateAnalysis).not.toHaveBeenCalled()
  })

  it('shows a storage message when the result cannot be saved', async () => {
    vi.mocked(generateAnalysis).mockResolvedValue(analysis())
    vi.mocked(saveEntryAnalysis).mockRejectedValue(new Error('io'))
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法儲存批改結果，請重新整理頁面後再試一次。',
    )
    expect(screen.queryByText(/批改時間/)).not.toBeInTheDocument()
  })

  it('keeps the previous result visible after an error', async () => {
    vi.mocked(generateAnalysis).mockRejectedValue(new GeminiError('network'))
    await renderEditor({ ...existing, analysis: analysis({ translation: '舊的翻譯' }) })
    fireEvent.click(reviewButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('無法連線到 Gemini')
    expect(screen.getByText('舊的翻譯')).toBeInTheDocument()
  })

  it('does not retry automatically', async () => {
    vi.mocked(generateAnalysis).mockRejectedValue(new GeminiError('quota'))
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    await screen.findByRole('alert')
    await act(async () => {})
    expect(generateAnalysis).toHaveBeenCalledTimes(1)
  })

  it('clears the previous error when a new review starts', async () => {
    vi.mocked(generateAnalysis).mockRejectedValueOnce(new GeminiError('quota'))
    const pending = deferred()
    vi.mocked(generateAnalysis).mockReturnValueOnce(pending.promise)
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    await screen.findByRole('alert')
    fireEvent.click(reviewButton())
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await act(async () => pending.resolve(analysis()))
  })
})

describe('while running', () => {
  it('disables the button with 批改中… and sends only once', async () => {
    const pending = deferred()
    vi.mocked(generateAnalysis).mockReturnValue(pending.promise)
    await renderEditor(existing)
    act(() => {
      fireEvent.click(reviewButton())
      fireEvent.click(reviewButton())
    })
    await waitFor(() => expect(reviewButton()).toHaveTextContent('批改中…'))
    expect(reviewButton()).toBeDisabled()
    expect(generateAnalysis).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(analysis()))
    expect(reviewButton()).toHaveTextContent('AI 批改')
    expect(reviewButton()).toBeEnabled()
  })

  it('lets the user keep editing and saving', async () => {
    const pending = deferred()
    vi.mocked(generateAnalysis).mockReturnValue(pending.promise)
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    await waitFor(() => expect(reviewButton()).toBeDisabled())
    fireEvent.change(contentInput(), { target: { value: 'Edited meanwhile' } })
    expect(screen.getByRole('button', { name: '儲存' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
    await act(async () => pending.resolve(analysis()))
  })

  it('still stores the result after the page was left', async () => {
    const pending = deferred()
    vi.mocked(generateAnalysis).mockReturnValue(pending.promise)
    const { unmount } = await renderEditor(existing)
    fireEvent.click(reviewButton())
    await waitFor(() => expect(generateAnalysis).toHaveBeenCalled())
    unmount()
    await act(async () => pending.resolve(analysis()))
    await waitFor(() => expect(saveEntryAnalysis).toHaveBeenCalledWith('entry-1', analysis()))
  })
})

describe('result', () => {
  it('shows the result with the local review time after success', async () => {
    vi.mocked(generateAnalysis).mockResolvedValue(analysis())
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    expect(await within(resultRegion()).findByText('批改時間：2026-10-25 11:04')).toBeInTheDocument()
    expect(within(resultRegion()).getByText('I went')).toBeInTheDocument()
    expect(within(resultRegion()).getByText('went').tagName).toBe('STRONG')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the edits typed while the review ran', async () => {
    const pending = deferred()
    vi.mocked(generateAnalysis).mockReturnValue(pending.promise)
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    await waitFor(() => expect(reviewButton()).toBeDisabled())
    fireEvent.change(contentInput(), { target: { value: 'Typing in progress' } })
    await act(async () => pending.resolve(analysis()))
    expect(await screen.findByText(/批改時間/)).toBeInTheDocument()
    expect(contentInput()).toHaveValue('Typing in progress')
    // Still unsaved relative to the stored text.
    fireEvent.click(reviewButton())
    expect(screen.getByRole('alert')).toHaveTextContent('請先儲存日記再批改')
  })

  it('saves later edits on top of the record that holds the new analysis', async () => {
    vi.mocked(generateAnalysis).mockResolvedValue(analysis())
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    await screen.findByText(/批改時間/)
    fireEvent.change(contentInput(), { target: { value: 'Edited after review' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await screen.findByText('已儲存')
    const [base] = vi.mocked(saveEntryEdit).mock.calls[0]
    expect(base.analysis).toEqual(analysis())
    // The old result stays visible after editing.
    expect(screen.getByText(/批改時間/)).toBeInTheDocument()
  })

  it('shows an analysis that was stored while the form held an older copy', async () => {
    vi.mocked(saveEntryEdit).mockImplementation(async (base, changes) => ({
      ...updateEntry(base, changes),
      analysis: analysis({ translation: '別處寫入的結果' }),
    }))
    await renderEditor(existing)
    fireEvent.change(contentInput(), { target: { value: 'Edited' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(await screen.findByText('別處寫入的結果')).toBeInTheDocument()
  })

  it('replaces the old result on re-review', async () => {
    vi.mocked(generateAnalysis).mockResolvedValue(analysis({ translation: '新的翻譯' }))
    await renderEditor({ ...existing, analysis: analysis({ translation: '舊的翻譯' }) })
    expect(screen.getByText('舊的翻譯')).toBeInTheDocument()
    fireEvent.click(reviewButton())
    expect(await screen.findByText('新的翻譯')).toBeInTheDocument()
    expect(screen.queryByText('舊的翻譯')).not.toBeInTheDocument()
  })

  it('shows nothing new when the entry was deleted meanwhile', async () => {
    vi.mocked(generateAnalysis).mockResolvedValue(analysis())
    vi.mocked(saveEntryAnalysis).mockResolvedValue(null)
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    await waitFor(() => expect(saveEntryAnalysis).toHaveBeenCalled())
    await waitFor(() => expect(reviewButton()).toBeEnabled())
    expect(screen.queryByText(/批改時間/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a stored result when the page opens', async () => {
    await renderEditor({ ...existing, analysis: analysis() })
    expect(within(resultRegion()).getByText('批改時間：2026-10-25 11:04')).toBeInTheDocument()
    expect(within(resultRegion()).getByText('我昨天去了學校。')).toBeInTheDocument()
  })

  it('hides the time line when analyzedAt is missing or unparsable', async () => {
    const { analyzedAt: _omit, ...withoutTime } = analysis()
    const { unmount } = await renderEditor({ ...existing, analysis: withoutTime })
    expect(screen.getByText('我昨天去了學校。')).toBeInTheDocument()
    expect(screen.queryByText(/批改時間/)).not.toBeInTheDocument()
    unmount()
    await renderEditor({ ...existing, analysis: analysis({ analyzedAt: 'yesterday-ish' }) })
    expect(screen.getByText('我昨天去了學校。')).toBeInTheDocument()
    expect(screen.queryByText(/批改時間/)).not.toBeInTheDocument()
  })

  it.each([
    ['a non-object', 'oops'],
    ['missing fields', { detectedLanguage: '英文' }],
    ['a bad analyzedAt type', analysis({ analyzedAt: 123 })],
  ])('shows a hint instead of an invalid stored analysis (%s)', async (_label, stored) => {
    await renderEditor({ ...existing, analysis: stored })
    expect(screen.getByText('無法顯示批改結果，請重新批改。')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '文法錯誤' })).not.toBeInTheDocument()
    expect(screen.queryByText(/批改時間/)).not.toBeInTheDocument()
  })

  it('shows nothing for an entry without an analysis field', async () => {
    const { analysis: _omit, ...withoutField } = existing
    await renderEditor(withoutField)
    expect(screen.queryByText('無法顯示批改結果，請重新批改。')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '文法錯誤' })).not.toBeInTheDocument()
  })

  it('renders AI text containing HTML as plain text', async () => {
    vi.mocked(generateAnalysis).mockResolvedValue(
      analysis({ translation: '<img src=x onerror="alert(1)">翻譯' }),
    )
    await renderEditor(existing)
    fireEvent.click(reviewButton())
    expect(await screen.findByText('<img src=x onerror="alert(1)">翻譯')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
})
