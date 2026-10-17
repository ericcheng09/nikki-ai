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
    expect(screen.getByText('目前已設定 API key')).toBeInTheDocument()
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
    expect(screen.getByText('目前已設定 API key')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已儲存')
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
    expect(screen.getByText('目前已設定 API key')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: '儲存' })).toBeEnabled()
  })

  it('keeps the key when deleting fails', async () => {
    vi.mocked(updateSettings).mockRejectedValue(new Error('boom'))
    withKey(KEY)
    const input = await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('無法儲存設定')
    expect(input).toHaveValue(KEY)
    expect(screen.getByText('目前已設定 API key')).toBeInTheDocument()
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
    fireEvent.click(save)
    fireEvent.click(save)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(save).toBeDisabled()
    finish()
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
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
})
