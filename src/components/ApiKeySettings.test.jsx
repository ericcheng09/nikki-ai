import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ApiKeySettings from './ApiKeySettings.jsx'
import { loadSettings, updateSettings } from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

const KEY = 'test-key-123'

function withKey(geminiApiKey) {
  vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: true, geminiApiKey })
}

async function renderLoaded() {
  render(<ApiKeySettings />)
  return screen.findByLabelText('API key')
}

let consoleSpies

beforeEach(() => {
  withKey('')
  vi.mocked(updateSettings).mockResolvedValue(undefined)
  // The key must never be logged (spec 5.4).
  consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((name) =>
    vi.spyOn(console, name),
  )
})

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  }
  vi.mocked(loadSettings).mockReset()
  vi.mocked(updateSettings).mockReset()
})

describe('ApiKeySettings', () => {
  it('shows a loading text while settings are being read', () => {
    vi.mocked(loadSettings).mockReturnValue(new Promise(() => {}))
    render(<ApiKeySettings />)
    expect(screen.getByText('載入中…')).toBeInTheDocument()
  })

  it('shows 尚未設定 and no 刪除 button when no key is saved', async () => {
    const input = await renderLoaded()
    expect(input).toHaveValue('')
    expect(screen.getByText('尚未設定 API key')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument()
  })

  it('prefills the saved key in a hidden, non-autocompleted field', async () => {
    withKey(KEY)
    const input = await renderLoaded()
    expect(input).toHaveValue(KEY)
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
    // No check result yet: the key is being confirmed.
    expect(screen.getByText('正在確認 API key…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刪除' })).toBeInTheDocument()
  })

  it('toggles between 顯示 and 隱藏', async () => {
    const input = await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: '顯示' }))
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: '隱藏' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('saves the trimmed key and shows 已儲存', async () => {
    const input = await renderLoaded()
    fireEvent.change(input, { target: { value: `  ${KEY}\n` } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
    expect(updateSettings).toHaveBeenCalledWith({ geminiApiKey: KEY })
    expect(input).toHaveValue(KEY)
    // No check result yet: the key is being confirmed.
    expect(screen.getByText('正在確認 API key…')).toBeInTheDocument()
    expect(screen.getByText('已儲存')).toHaveAttribute('role', 'status')
  })

  it('replaces an existing key', async () => {
    withKey('old-key')
    const input = await renderLoaded()
    fireEvent.change(input, { target: { value: 'new-key' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
    expect(updateSettings).toHaveBeenCalledWith({ geminiApiKey: 'new-key' })
  })

  it('does not save a blank key', async () => {
    const input = await renderLoaded()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(screen.getByRole('alert')).toHaveTextContent('請輸入 API key')
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('keeps the saved key when a blank value is submitted', async () => {
    withKey(KEY)
    const input = await renderLoaded()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(screen.getByRole('alert')).toHaveTextContent('請輸入 API key')
    expect(updateSettings).not.toHaveBeenCalled()
    // No check result yet: the key is being confirmed.
    expect(screen.getByText('正在確認 API key…')).toBeInTheDocument()
  })

  it('clears the error once the user types again', async () => {
    const input = await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'a' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deletes the key without a confirm dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    withKey(KEY)
    const input = await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    expect(await screen.findByText('已刪除')).toBeInTheDocument()
    expect(updateSettings).toHaveBeenCalledWith({ geminiApiKey: '' })
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
    expect(screen.getByText('尚未設定 API key')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('shows a save error without the key when saving fails', async () => {
    vi.mocked(updateSettings).mockRejectedValue(new Error(`failed ${KEY}`))
    const input = await renderLoaded()
    fireEvent.change(input, { target: { value: KEY } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('無法儲存設定，請重新整理頁面後再試一次。')
    expect(alert).not.toHaveTextContent(KEY)
    expect(screen.getByText('尚未設定 API key')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '儲存' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('keeps the key when deleting fails', async () => {
    vi.mocked(updateSettings).mockRejectedValue(new Error('boom'))
    withKey(KEY)
    const input = await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('無法儲存設定')
    expect(input).toHaveValue(KEY)
    // No check result yet: the key is being confirmed.
    expect(screen.getByText('正在確認 API key…')).toBeInTheDocument()
  })

  it('ignores a second click while saving', async () => {
    let finish
    vi.mocked(updateSettings).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const input = await renderLoaded()
    fireEvent.change(input, { target: { value: KEY } })
    const save = screen.getByRole('button', { name: '儲存' })
    save.focus()
    fireEvent.click(save)
    fireEvent.click(save)
    // Enter in the field submits the form too; also ignored meanwhile.
    fireEvent.submit(input.closest('form'))
    expect(updateSettings).toHaveBeenCalledTimes(1)
    // Inert but still focusable, so keyboard focus stays on 儲存.
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).not.toBeDisabled()
    expect(save).toHaveFocus()
    finish()
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
    expect(save).toHaveAttribute('aria-disabled', 'false')
    expect(save).toHaveFocus()
  })

  it('ignores 刪除 while a save runs, and 儲存 while deleting', async () => {
    let finish
    vi.mocked(updateSettings).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    withKey(KEY)
    await renderLoaded()
    const save = screen.getByRole('button', { name: '儲存' })
    const remove = screen.getByRole('button', { name: '刪除' })
    fireEvent.click(remove)
    expect(remove).toHaveAttribute('aria-disabled', 'true')
    expect(save).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(save)
    fireEvent.click(remove)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ geminiApiKey: '' })
    finish()
    expect(await screen.findByText('已刪除')).toBeInTheDocument()
  })

  it('moves focus to the key input after 刪除, whose button goes away', async () => {
    withKey(KEY)
    const input = await renderLoaded()
    const remove = screen.getByRole('button', { name: '刪除' })
    remove.focus()
    fireEvent.click(remove)
    expect(await screen.findByText('已刪除')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it('keeps focus on 刪除 when deleting fails', async () => {
    vi.mocked(updateSettings).mockRejectedValue(new Error('boom'))
    withKey(KEY)
    await renderLoaded()
    const remove = screen.getByRole('button', { name: '刪除' })
    remove.focus()
    fireEvent.click(remove)
    expect(await screen.findByRole('alert')).toHaveTextContent('無法儲存設定')
    expect(remove).toHaveFocus()
    expect(remove).toHaveAttribute('aria-disabled', 'false')
  })

  it('shows a load error and no form when settings cannot be read', async () => {
    vi.mocked(loadSettings).mockRejectedValue(new Error('boom'))
    render(<ApiKeySettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法讀取設定，請重新整理頁面。',
    )
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    // Instructions are still useful even when settings fail to load.
    expect(screen.getByText('如何取得 API key')).toBeInTheDocument()
  })

  it('shows the instructions with a safe external link', async () => {
    await renderLoaded()
    expect(screen.getByRole('heading', { name: '如何取得 API key' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'API key 頁面' })
    expect(link).toHaveAttribute('href', 'https://aistudio.google.com/apikey')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('用 Google 帳號登入，建立一個新的 API key。')).toBeInTheDocument()
    expect(screen.getByText(/複製產生的 key/)).toBeInTheDocument()
    expect(
      screen.getByText('API key 只會存在這個瀏覽器，只用來呼叫 Gemini，不會傳送到其他地方。'),
    ).toBeInTheDocument()
  })

  it('treats a missing geminiApiKey field as not set', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ welcomeSeen: true })
    const input = await renderLoaded()
    expect(input).toHaveValue('')
    await waitFor(() => expect(screen.getByText('尚未設定 API key')).toBeInTheDocument())
  })

  it('reports the loaded key and every saved or deleted key to onKeyChange', async () => {
    withKey(KEY)
    const onKeyChange = vi.fn()
    render(<ApiKeySettings onKeyChange={onKeyChange} />)
    const input = await screen.findByLabelText('API key')
    expect(onKeyChange).toHaveBeenLastCalledWith(KEY)
    fireEvent.change(input, { target: { value: ' other-key ' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await screen.findByText('已儲存')
    expect(onKeyChange).toHaveBeenLastCalledWith('other-key')
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    await screen.findByText('已刪除')
    expect(onKeyChange).toHaveBeenLastCalledWith('')
    expect(onKeyChange).toHaveBeenCalledTimes(3)
  })

  it('does not call onKeyChange when loading fails', async () => {
    const onKeyChange = vi.fn()
    vi.mocked(loadSettings).mockRejectedValue(new Error('boom'))
    render(<ApiKeySettings onKeyChange={onKeyChange} />)
    await screen.findByRole('alert')
    expect(onKeyChange).not.toHaveBeenCalled()
  })

  it('does not call onKeyChange for a blank or failed save', async () => {
    const onKeyChange = vi.fn()
    vi.mocked(updateSettings).mockRejectedValue(new Error('boom'))
    render(<ApiKeySettings onKeyChange={onKeyChange} />)
    const input = await screen.findByLabelText('API key')
    onKeyChange.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    fireEvent.change(input, { target: { value: KEY } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await screen.findByText(/無法儲存設定/)
    expect(onKeyChange).not.toHaveBeenCalled()
  })

  describe('key check line', () => {
    const check = (status, errorCode = '') => ({ status, models: [], errorCode, requestId: 1 })
    const checkLine = () => screen.getByText(/API key (可以使用|無效)|確認 API key/)

    async function renderWithCheck(keyCheck, onRetry = vi.fn()) {
      withKey(KEY)
      const view = render(<ApiKeySettings keyCheck={keyCheck} onRetry={onRetry} />)
      await screen.findByLabelText('API key')
      return { ...view, onRetry }
    }

    it.each([
      ['loading', '', '正在確認 API key…', false],
      ['success', '', 'API key 可以使用', false],
      ['error', 'invalidKey', 'API key 無效，請確認後重新儲存。', false],
      ['error', 'network', '無法確認 API key，請檢查網路後再試一次。', true],
      ['error', 'quota', '無法確認 API key，請稍後再試。', true],
      ['error', 'other', '無法確認 API key，請稍後再試。', true],
      ['error', 'toString', '無法確認 API key，請稍後再試。', true],
    ])('shows %s %s as a status line', async (status, code, text, retry) => {
      await renderWithCheck(check(status, code))
      expect(checkLine()).toHaveTextContent(text)
      expect(checkLine()).toHaveAttribute('role', 'status')
      expect(checkLine()).not.toHaveTextContent(KEY)
      expect(screen.queryByText('目前已設定 API key')).not.toBeInTheDocument()
      if (retry) {
        expect(screen.getByRole('button', { name: '重新確認' })).toBeInTheDocument()
      } else {
        expect(screen.queryByRole('button', { name: '重新確認' })).not.toBeInTheDocument()
      }
    })

    it('calls onRetry once per 重新確認 click', async () => {
      const { onRetry } = await renderWithCheck(check('error', 'network'))
      fireEvent.click(screen.getByRole('button', { name: '重新確認' }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('shows no check line without a saved key, whatever the check state', async () => {
      withKey('')
      render(<ApiKeySettings keyCheck={check('error', 'network')} onRetry={vi.fn()} />)
      await screen.findByLabelText('API key')
      expect(screen.getByText('尚未設定 API key')).toBeInTheDocument()
      expect(screen.queryByText(/確認 API key/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '重新確認' })).not.toBeInTheDocument()
    })

    describe('focus around 重新確認', () => {
      async function startRetry(onRetry = vi.fn()) {
        const { rerender } = await renderWithCheck(check('error', 'network'), onRetry)
        const button = screen.getByRole('button', { name: '重新確認' })
        button.focus()
        fireEvent.click(button)
        // The page answers by starting the check again.
        rerender(<ApiKeySettings keyCheck={check('loading')} onRetry={onRetry} />)
        return { rerender, onRetry }
      }

      it('keeps the button, inert and focused, while the retry runs', async () => {
        const { onRetry } = await startRetry()
        const button = screen.getByRole('button', { name: '重新確認' })
        expect(screen.getByText('正在確認 API key…')).toBeInTheDocument()
        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).toHaveFocus()
        fireEvent.click(button)
        expect(onRetry).toHaveBeenCalledTimes(1)
      })

      it('re-enables the button with focus kept when the retry fails again', async () => {
        const { rerender, onRetry } = await startRetry()
        rerender(<ApiKeySettings keyCheck={check('error', 'network')} onRetry={onRetry} />)
        const button = screen.getByRole('button', { name: '重新確認' })
        expect(button).toHaveAttribute('aria-disabled', 'false')
        expect(button).toHaveFocus()
        fireEvent.click(button)
        expect(onRetry).toHaveBeenCalledTimes(2)
      })

      it.each([
        ['success', '', 'API key 可以使用'],
        ['error', 'invalidKey', 'API key 無效，請確認後重新儲存。'],
      ])('moves focus to the status line when the retry ends in %s %s', async (status, code, text) => {
        const { rerender, onRetry } = await startRetry()
        rerender(<ApiKeySettings keyCheck={check(status, code)} onRetry={onRetry} />)
        expect(screen.queryByRole('button', { name: '重新確認' })).not.toBeInTheDocument()
        expect(screen.getByText(text)).toHaveFocus()
      })

      it('does not move focus for a check it did not start', async () => {
        const { rerender } = await renderWithCheck(check('loading'))
        const input = screen.getByLabelText('API key')
        input.focus()
        rerender(<ApiKeySettings keyCheck={check('success')} onRetry={vi.fn()} />)
        expect(input).toHaveFocus()
      })

      it('shows no button during a check started by a save', async () => {
        const { rerender, onRetry } = await startRetry()
        // A save while the retry runs starts its own check.
        fireEvent.click(screen.getByRole('button', { name: '儲存' }))
        await screen.findByText('已儲存')
        rerender(<ApiKeySettings keyCheck={check('loading', '')} onRetry={onRetry} />)
        expect(screen.queryByRole('button', { name: '重新確認' })).not.toBeInTheDocument()
      })
    })
  })
})
