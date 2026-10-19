import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SettingsPage from './SettingsPage.jsx'
import { loadSettings, updateSettings } from '../storage/connection.js'
import { listModels } from '../lib/gemini.js'

vi.mock('../storage/connection.js', () => ({
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
  deleteCustomLanguage: vi.fn(),
}))
vi.mock('../lib/gemini.js', () => ({ listModels: vi.fn() }))
// The Google section has its own tests (GoogleSyncSettings.test.jsx).
vi.mock('../lib/googleAuth.js', () => ({
  default: {
    getStatus: vi.fn(async () => 'signedOut'),
    onStatusChange: vi.fn(() => () => {}),
  },
}))

const FLASH = { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }
const PRO = { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/" element={<p>主畫面</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(loadSettings).mockResolvedValue({
    welcomeSeen: true,
    geminiApiKey: '',
    geminiModel: '',
  })
  vi.mocked(updateSettings).mockResolvedValue(undefined)
  vi.mocked(listModels).mockResolvedValue([FLASH])
})

afterEach(() => {
  // Unmount first: a section remounted at the very end of a test (e.g.
  // ModelSettings for a new key) would otherwise call the reset
  // loadSettings mock, get undefined and throw (intermittent failure).
  cleanup()
  vi.mocked(loadSettings).mockReset()
  vi.mocked(updateSettings).mockReset()
  vi.mocked(listModels).mockReset()
})

function keyInput() {
  return screen.findByLabelText('API key')
}

function saveKey(input, value) {
  fireEvent.change(input, { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
}

describe('SettingsPage', () => {
  it('shows the 設定 heading and the API key section, without its own home link', async () => {
    renderSettings()
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    // Back / home are in the top bar (decisions.md 畫面).
    expect(screen.queryByRole('link', { name: '回主畫面' })).not.toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Gemini API key' }),
    ).toBeInTheDocument()
  })

  it('hides the model section while no key is saved', async () => {
    renderSettings()
    await keyInput()
    expect(screen.queryByRole('heading', { name: 'Gemini 模型' })).not.toBeInTheDocument()
    expect(listModels).not.toHaveBeenCalled()
  })

  it('queries models on open when a key is already saved', async () => {
    vi.mocked(loadSettings).mockResolvedValue({
      geminiApiKey: 'test-key-123',
      geminiModel: FLASH.name,
    })
    renderSettings()
    expect(await screen.findByLabelText('模型')).toHaveValue(FLASH.name)
    expect(listModels).toHaveBeenCalledWith('test-key-123')
  })

  it('shows the model section and queries right after a key is saved', async () => {
    renderSettings()
    const input = await keyInput()
    saveKey(input, 'test-key-123')
    expect(await screen.findByLabelText('模型')).toHaveValue(FLASH.name)
    expect(listModels).toHaveBeenCalledWith('test-key-123')
  })

  it('queries again when a key is saved again, using the new key', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ geminiApiKey: 'test-key-123', geminiModel: '' })
    renderSettings()
    const input = await keyInput()
    await screen.findByLabelText('模型')
    saveKey(input, 'test-key-456')
    await screen.findByText('已儲存')
    await vi.waitFor(() => expect(listModels).toHaveBeenLastCalledWith('test-key-456'))
    // Let the remounted model section finish loading before the test ends.
    expect(await screen.findByLabelText('模型')).toBeInTheDocument()
  })

  it('hides the model section after the key is deleted, keeping the model', async () => {
    vi.mocked(loadSettings).mockResolvedValue({
      geminiApiKey: 'test-key-123',
      geminiModel: FLASH.name,
    })
    renderSettings()
    await screen.findByLabelText('模型')
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    expect(await screen.findByText('已刪除')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Gemini 模型' })).not.toBeInTheDocument()
    // Only the key is cleared; geminiModel is never written.
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ geminiApiKey: '' })
  })

  it('ignores a slower model query for a key that was replaced', async () => {
    let resolveOld
    vi.mocked(listModels)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve
        }),
      )
      .mockResolvedValueOnce([PRO, FLASH])
    vi.mocked(loadSettings).mockResolvedValue({ geminiApiKey: 'test-key-123', geminiModel: '' })
    renderSettings()
    const input = await keyInput()
    await vi.waitFor(() => expect(listModels).toHaveBeenCalledTimes(1))
    saveKey(input, 'test-key-456')
    const select = await screen.findByLabelText('模型')
    expect(Array.from(select.options).map((o) => o.value)).toEqual([PRO.name, FLASH.name])
    // The first query answers late with a different list.
    await act(async () => resolveOld([{ name: 'models/gemini-old-flash', displayName: '' }]))
    expect(Array.from(screen.getByLabelText('模型').options).map((o) => o.value)).toEqual([
      PRO.name,
      FLASH.name,
    ])
    // Whatever the options (an automatic choice passes { automatic: true }).
    const savedModels = vi.mocked(updateSettings).mock.calls.map(([partial]) => partial.geminiModel)
    expect(savedModels).not.toContain('models/gemini-old-flash')
  })

  it('shows the language list without an API key, after the API key section', async () => {
    renderSettings()
    await keyInput()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Gemini API key', '語言清單', 'Google Drive 同步'])
  })

  it('places the language list after the model section when a key is saved', async () => {
    vi.mocked(loadSettings).mockResolvedValue({
      geminiApiKey: 'test-key-123',
      geminiModel: FLASH.name,
      customLanguages: [],
    })
    renderSettings()
    await screen.findByLabelText('模型')
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Gemini API key', 'Gemini 模型', '語言清單', 'Google Drive 同步'])
  })

  it('keeps the language list when the API key is deleted', async () => {
    vi.mocked(loadSettings).mockResolvedValue({
      geminiApiKey: 'test-key-123',
      geminiModel: FLASH.name,
      customLanguages: [],
    })
    renderSettings()
    await screen.findByLabelText('模型')
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    await screen.findByText('已刪除')
    expect(screen.getByRole('heading', { name: '語言清單' })).toBeInTheDocument()
  })

  describe('API key check (shared with the model list)', () => {
    const coded = (code) => Object.assign(new Error(`failed: ${code}`), { code })
    const withSavedKey = (geminiModel = FLASH.name) =>
      vi.mocked(loadSettings).mockResolvedValue({ geminiApiKey: 'test-key-123', geminiModel })

    it('sends exactly one request on page open and shows that the key works', async () => {
      withSavedKey()
      renderSettings()
      expect(await screen.findByText('API key 可以使用')).toBeInTheDocument()
      expect(await screen.findByLabelText('模型')).toHaveValue(FLASH.name)
      expect(listModels).toHaveBeenCalledTimes(1)
    })

    it('shows 正在確認 API key… and the model loading text while the request runs', async () => {
      withSavedKey()
      vi.mocked(listModels).mockReturnValue(new Promise(() => {}))
      renderSettings()
      expect(await screen.findByText('正在確認 API key…')).toBeInTheDocument()
      expect(screen.getByText('正在取得模型清單…')).toBeInTheDocument()
    })

    it('sends exactly one request per key save', async () => {
      renderSettings()
      const input = await keyInput()
      saveKey(input, 'test-key-123')
      expect(await screen.findByText('API key 可以使用')).toBeInTheDocument()
      expect(listModels).toHaveBeenCalledTimes(1)
      // Saving the same key again checks it again, once.
      saveKey(input, 'test-key-123')
      await vi.waitFor(() => expect(listModels).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('API key 可以使用')).toBeInTheDocument()
      expect(listModels).toHaveBeenCalledTimes(2)
    })

    it('saves an invalid key anyway and reports it only in the key section', async () => {
      vi.mocked(listModels).mockRejectedValue(coded('invalidKey'))
      renderSettings()
      const input = await keyInput()
      saveKey(input, 'bad-key')
      expect(await screen.findByText('API key 無效，請確認後重新儲存。')).toBeInTheDocument()
      expect(updateSettings).toHaveBeenCalledWith({ geminiApiKey: 'bad-key' })
      // The model section is gone instead of repeating the error.
      expect(screen.queryByRole('heading', { name: 'Gemini 模型' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '重新查詢' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '重新確認' })).not.toBeInTheDocument()
    })

    it.each([
      ['network', '無法確認 API key，請檢查網路後再試一次。'],
      ['quota', '無法確認 API key，請稍後再試。'],
      ['other', '無法確認 API key，請稍後再試。'],
    ])('on a %s failure offers 重新確認, which sends exactly one new request', async (code, text) => {
      withSavedKey()
      vi.mocked(listModels).mockRejectedValueOnce(coded(code)).mockResolvedValueOnce([PRO, FLASH])
      renderSettings()
      expect(await screen.findByText(text)).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Gemini 模型' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '重新確認' }))
      expect(await screen.findByText('API key 可以使用')).toBeInTheDocument()
      expect(await screen.findByLabelText('模型')).toHaveValue(FLASH.name)
      expect(listModels).toHaveBeenCalledTimes(2)
      expect(listModels).toHaveBeenLastCalledWith('test-key-123')
      // The saved model was never touched by the failure.
      expect(updateSettings).not.toHaveBeenCalled()
    })

    it('keeps keyboard focus through 重新確認: on the button while checking and after a new failure, then on the result', async () => {
      withSavedKey()
      let finish
      vi.mocked(listModels)
        .mockRejectedValueOnce(coded('network'))
        .mockReturnValueOnce(
          new Promise((resolve, reject) => {
            finish = reject
          }),
        )
        .mockResolvedValueOnce([FLASH])
      renderSettings()
      const button = await screen.findByRole('button', { name: '重新確認' })
      button.focus()
      fireEvent.click(button)
      expect(await screen.findByText('正在確認 API key…')).toBeInTheDocument()
      expect(button).toHaveFocus()
      expect(button).toHaveAttribute('aria-disabled', 'true')
      await act(async () => finish(coded('network')))
      expect(await screen.findByText('無法確認 API key，請檢查網路後再試一次。')).toBeInTheDocument()
      expect(button).toHaveFocus()
      fireEvent.click(button)
      expect(await screen.findByText('API key 可以使用')).toHaveFocus()
      expect(listModels).toHaveBeenCalledTimes(3)
    })

    it('ignores a late failure for a replaced key', async () => {
      let rejectOld
      vi.mocked(listModels)
        .mockReturnValueOnce(
          new Promise((resolve, reject) => {
            rejectOld = reject
          }),
        )
        .mockResolvedValueOnce([FLASH])
      withSavedKey()
      renderSettings()
      const input = await keyInput()
      await vi.waitFor(() => expect(listModels).toHaveBeenCalledTimes(1))
      saveKey(input, 'test-key-456')
      expect(await screen.findByText('API key 可以使用')).toBeInTheDocument()
      await act(async () => rejectOld(coded('invalidKey')))
      expect(screen.getByText('API key 可以使用')).toBeInTheDocument()
      expect(screen.queryByText(/API key 無效/)).not.toBeInTheDocument()
      expect(screen.getByLabelText('模型')).toBeInTheDocument()
    })

    it('drops the check when the key is deleted mid-request', async () => {
      let resolveOld
      vi.mocked(listModels).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve
        }),
      )
      withSavedKey()
      renderSettings()
      await screen.findByText('正在確認 API key…')
      fireEvent.click(screen.getByRole('button', { name: '刪除' }))
      expect(await screen.findByText('尚未設定 API key')).toBeInTheDocument()
      await act(async () => resolveOld([FLASH]))
      expect(screen.queryByText('API key 可以使用')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Gemini 模型' })).not.toBeInTheDocument()
    })
  })
})
