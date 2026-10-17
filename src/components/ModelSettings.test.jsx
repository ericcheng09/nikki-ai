import { act, fireEvent, render, screen } from '@testing-library/react'
import ModelSettings from './ModelSettings.jsx'
import { listModels } from '../lib/gemini.js'
import { loadSettings, updateSettings } from '../storage/connection.js'

vi.mock('../lib/gemini.js', () => ({ listModels: vi.fn() }))
vi.mock('../storage/connection.js', () => ({
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

const KEY = 'test-key-123'
const PRO = { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }
const FLASH = { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }
const LITE = { name: 'models/gemini-2.0-FLASH-lite', displayName: '' }

function withModel(geminiModel) {
  vi.mocked(loadSettings).mockResolvedValue({ geminiApiKey: KEY, geminiModel })
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

function codedError(code) {
  return Object.assign(new Error(`Gemini request failed: ${code}`), { code })
}

let consoleSpies

beforeEach(() => {
  withModel('')
  vi.mocked(updateSettings).mockResolvedValue(undefined)
  vi.mocked(listModels).mockResolvedValue([PRO, FLASH])
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
  vi.mocked(listModels).mockReset()
})

describe('ModelSettings', () => {
  it('shows a loading text while the list is queried with the key', async () => {
    vi.mocked(listModels).mockReturnValue(new Promise(() => {}))
    render(<ModelSettings apiKey={KEY} />)
    expect(screen.getByRole('heading', { name: 'Gemini 模型' })).toBeInTheDocument()
    expect(screen.getByText('正在取得模型清單…')).toBeInTheDocument()
    await vi.waitFor(() => expect(listModels).toHaveBeenCalledWith(KEY))
  })

  it('lists models by displayName, falling back to name', async () => {
    withModel(PRO.name)
    vi.mocked(listModels).mockResolvedValue([PRO, LITE])
    render(<ModelSettings apiKey={KEY} />)
    const select = await screen.findByLabelText('模型')
    const options = Array.from(select.options).map((o) => o.textContent)
    expect(options).toEqual(['Gemini 2.5 Pro', 'models/gemini-2.0-FLASH-lite'])
    expect(select).toHaveValue(PRO.name)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('auto-selects and saves the first flash model when none is chosen', async () => {
    vi.mocked(listModels).mockResolvedValue([PRO, FLASH, LITE])
    render(<ModelSettings apiKey={KEY} />)
    const select = await screen.findByLabelText('模型')
    expect(select).toHaveValue(FLASH.name)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ geminiModel: FLASH.name })
  })

  it('matches flash case-insensitively', async () => {
    vi.mocked(listModels).mockResolvedValue([PRO, LITE])
    render(<ModelSettings apiKey={KEY} />)
    expect(await screen.findByLabelText('模型')).toHaveValue(LITE.name)
    expect(updateSettings).toHaveBeenCalledWith({ geminiModel: LITE.name })
  })

  it('selects nothing and asks the user to choose when no flash model exists', async () => {
    vi.mocked(listModels).mockResolvedValue([PRO])
    render(<ModelSettings apiKey={KEY} />)
    const select = await screen.findByLabelText('模型')
    expect(select).toHaveValue('')
    // Shown once, as the selected placeholder option.
    expect(select.selectedOptions[0]).toHaveTextContent('請選擇模型')
    expect(select.selectedOptions[0]).toBeDisabled()
    expect(screen.getAllByText('請選擇模型')).toHaveLength(1)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('shows a save error when auto-selecting fails, and still lists models', async () => {
    vi.mocked(updateSettings).mockRejectedValue(new Error('boom'))
    render(<ModelSettings apiKey={KEY} />)
    const select = await screen.findByLabelText('模型')
    expect(select).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveTextContent('無法儲存設定')
  })

  it('saves immediately when the user picks a model', async () => {
    withModel(FLASH.name)
    render(<ModelSettings apiKey={KEY} />)
    const select = await screen.findByLabelText('模型')
    fireEvent.change(select, { target: { value: PRO.name } })
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
    expect(updateSettings).toHaveBeenCalledWith({ geminiModel: PRO.name })
    expect(select).toHaveValue(PRO.name)
  })

  it('keeps the previous choice when saving a pick fails', async () => {
    withModel(FLASH.name)
    vi.mocked(updateSettings).mockRejectedValue(new Error('boom'))
    render(<ModelSettings apiKey={KEY} />)
    const select = await screen.findByLabelText('模型')
    fireEvent.change(select, { target: { value: PRO.name } })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法儲存設定，請重新整理頁面後再試一次。',
    )
    expect(select).toHaveValue(FLASH.name)
  })

  it('warns when the saved model is no longer available, without overwriting it', async () => {
    withModel('models/gemini-old')
    render(<ModelSettings apiKey={KEY} />)
    const select = await screen.findByLabelText('模型')
    expect(select).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveTextContent(
      '目前選擇的模型已無法使用，請重新選擇。',
    )
    // No auto-select: the stored value stays until the user picks one.
    expect(updateSettings).not.toHaveBeenCalled()
    fireEvent.change(select, { target: { value: FLASH.name } })
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
    expect(screen.queryByText(/已無法使用/)).not.toBeInTheDocument()
  })

  it.each([
    ['invalidKey', 'API key 無效，請確認後重新儲存。'],
    ['network', '無法連線到 Gemini，請檢查網路後再試一次。'],
    ['other', '無法取得模型清單，請稍後再試。'],
    [undefined, '無法取得模型清單，請稍後再試。'],
    ['toString', '無法取得模型清單，請稍後再試。'],
  ])('shows the %s query error with a 重新查詢 button', async (code, message) => {
    withModel(FLASH.name)
    vi.mocked(listModels).mockRejectedValue(codedError(code))
    render(<ModelSettings apiKey={KEY} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: '重新查詢' })).toBeInTheDocument()
    // The saved model is kept.
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('queries again with 重新查詢', async () => {
    withModel(FLASH.name)
    vi.mocked(listModels).mockRejectedValueOnce(codedError('network'))
    render(<ModelSettings apiKey={KEY} />)
    fireEvent.click(await screen.findByRole('button', { name: '重新查詢' }))
    expect(await screen.findByLabelText('模型')).toHaveValue(FLASH.name)
    expect(listModels).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a load error when settings cannot be read', async () => {
    vi.mocked(loadSettings).mockRejectedValue(new Error('boom'))
    render(<ModelSettings apiKey={KEY} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('無法讀取設定，請重新整理頁面。')
    expect(listModels).not.toHaveBeenCalled()
  })

  // Within one mount only one query runs at a time (重新查詢 appears only
  // after a failure); a newer key remounts the component, so a stale
  // response always arrives after unmount.
  it('drops a pending query result after unmount', async () => {
    const pending = deferred()
    vi.mocked(listModels).mockReturnValue(pending.promise)
    const { unmount } = render(<ModelSettings apiKey={KEY} />)
    await vi.waitFor(() => expect(listModels).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () => pending.resolve([FLASH]))
    // No auto-select save from the stale response.
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('drops a pending query error after unmount', async () => {
    const pending = deferred()
    vi.mocked(listModels).mockReturnValue(pending.promise)
    const { unmount } = render(<ModelSettings apiKey={KEY} />)
    await vi.waitFor(() => expect(listModels).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () => pending.reject(codedError('network')))
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('does not update after unmount while settings are loading', async () => {
    const load = deferred()
    vi.mocked(loadSettings).mockReturnValue(load.promise)
    const { unmount } = render(<ModelSettings apiKey={KEY} />)
    unmount()
    await act(async () => load.resolve({ geminiModel: '' }))
    expect(listModels).not.toHaveBeenCalled()
  })
})
