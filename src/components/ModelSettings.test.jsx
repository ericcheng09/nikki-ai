import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import ModelSettings from './ModelSettings.jsx'
import { syncReplacedData } from '../storage/syncSignals.js'
import { listModels } from '../lib/gemini.js'
import useModelQuery from '../lib/useModelQuery.js'
import { loadSettings, updateSettings } from '../storage/connection.js'

vi.mock('../lib/gemini.js', () => ({ listModels: vi.fn() }))
vi.mock('../storage/connection.js', () => ({
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

const KEY = 'test-key-123'
const PRO = { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }
const FLASH = { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }
const LITE = { name: 'models/gemini-2.0-flash-lite', displayName: '' }
// Not stable main text models: hidden unless nothing else is available.
const FLASH_PREVIEW = {
  name: 'models/gemini-2.5-flash-preview-05-20',
  displayName: 'Gemini 2.5 Flash Preview',
}
const EXP = { name: 'models/gemini-exp-1206', displayName: 'Gemini Experimental' }
const UPPER_FLASH = { name: 'models/gemini-2.5-FLASH-preview', displayName: '' }

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

// Wires the section like SettingsPage does: one shared query started with
// the key, the section shown (and remounted per request) only while that
// query is loading or succeeded.
function Harness() {
  const { state, start } = useModelQuery()
  useEffect(() => {
    start(KEY)
  }, [start])
  if (state.status !== 'loading' && state.status !== 'success') return null
  return <ModelSettings key={state.requestId} query={state} />
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
  // Unmount before resetting the mocks, so no late effect calls a mock
  // that has already been reset (it would return undefined).
  cleanup()
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
    render(<Harness />)
    expect(screen.getByRole('heading', { name: 'Gemini 模型' })).toBeInTheDocument()
    expect(screen.getByText('正在取得模型清單…')).toBeInTheDocument()
    await act(async () => {})
    expect(listModels).toHaveBeenCalledWith(KEY)
    expect(screen.getByText('正在取得模型清單…')).toBeInTheDocument()
  })

  it('lists models by displayName, falling back to name', async () => {
    withModel(PRO.name)
    vi.mocked(listModels).mockResolvedValue([PRO, LITE])
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    const options = Array.from(select.options).map((o) => o.textContent)
    expect(options).toEqual(['Gemini 2.5 Pro', 'models/gemini-2.0-flash-lite'])
    expect(select).toHaveValue(PRO.name)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('auto-selects the newest stable Flash model, not the first in API order', async () => {
    const OLD_FLASH = { name: 'models/gemini-2.0-flash-001', displayName: 'Gemini 2.0 Flash 001' }
    const NEW_LITE = { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite' }
    vi.mocked(listModels).mockResolvedValue([PRO, OLD_FLASH, NEW_LITE, FLASH])
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    expect(select).toHaveValue(FLASH.name)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ geminiModel: FLASH.name }, { automatic: true })
  })

  it('auto-selects and saves the newest flash model when none is chosen', async () => {
    vi.mocked(listModels).mockResolvedValue([PRO, FLASH, LITE])
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    expect(select).toHaveValue(FLASH.name)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ geminiModel: FLASH.name }, { automatic: true })
  })

  it('matches flash case-insensitively', async () => {
    // Only reachable through the fallback list (no main text model).
    vi.mocked(listModels).mockResolvedValue([EXP, UPPER_FLASH])
    render(<Harness />)
    expect(await screen.findByLabelText('模型')).toHaveValue(UPPER_FLASH.name)
    expect(updateSettings).toHaveBeenCalledWith({ geminiModel: UPPER_FLASH.name }, { automatic: true })
  })

  it('lists only stable main text models', async () => {
    withModel(PRO.name)
    vi.mocked(listModels).mockResolvedValue([FLASH_PREVIEW, PRO, EXP, FLASH])
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    expect(Array.from(select.options).map((o) => o.value)).toEqual([PRO.name, FLASH.name])
  })

  it('never auto-selects a hidden model', async () => {
    vi.mocked(listModels).mockResolvedValue([FLASH_PREVIEW, PRO])
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    expect(select).toHaveValue('')
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('lists every model when no stable main text model is available', async () => {
    vi.mocked(listModels).mockResolvedValue([EXP, FLASH_PREVIEW])
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    expect(Array.from(select.options).map((o) => o.value)).toEqual([EXP.name, FLASH_PREVIEW.name])
    // Auto-selection works on the shown (fallback) list.
    expect(select).toHaveValue(FLASH_PREVIEW.name)
    expect(updateSettings).toHaveBeenCalledWith({ geminiModel: FLASH_PREVIEW.name }, { automatic: true })
  })

  it('keeps a saved hidden model selectable, without a warning', async () => {
    withModel(FLASH_PREVIEW.name)
    vi.mocked(listModels).mockResolvedValue([FLASH_PREVIEW, PRO, FLASH])
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      PRO.name,
      FLASH.name,
      FLASH_PREVIEW.name,
    ])
    expect(select).toHaveValue(FLASH_PREVIEW.name)
    expect(screen.queryByText(/已無法使用/)).not.toBeInTheDocument()
    expect(updateSettings).not.toHaveBeenCalled()
    // After switching away, the hidden model is no longer offered.
    fireEvent.change(select, { target: { value: FLASH.name } })
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
    expect(Array.from(select.options).map((o) => o.value)).toEqual([PRO.name, FLASH.name])
  })

  it('selects nothing and asks the user to choose when no flash model exists', async () => {
    vi.mocked(listModels).mockResolvedValue([PRO])
    render(<Harness />)
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
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    expect(select).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveTextContent('無法儲存設定')
  })

  it('saves immediately when the user picks a model', async () => {
    withModel(FLASH.name)
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    fireEvent.change(select, { target: { value: PRO.name } })
    expect(await screen.findByText('已儲存')).toBeInTheDocument()
    // A user's choice is not automatic, so it is stamped with the real time.
    expect(updateSettings).toHaveBeenCalledWith({ geminiModel: PRO.name })
    expect(updateSettings.mock.calls.at(-1)).toHaveLength(1)
    expect(select).toHaveValue(PRO.name)
  })

  it('keeps the previous choice when saving a pick fails', async () => {
    withModel(FLASH.name)
    vi.mocked(updateSettings).mockRejectedValue(new Error('boom'))
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    fireEvent.change(select, { target: { value: PRO.name } })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法儲存設定，請重新整理頁面後再試一次。',
    )
    expect(select).toHaveValue(FLASH.name)
  })

  it('warns when the saved model is no longer available, without overwriting it', async () => {
    withModel('models/gemini-old')
    render(<Harness />)
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

  it('shows nothing for a failed query and keeps the saved model', async () => {
    // Errors and 重新確認 live in the API key section (SettingsPage).
    withModel(FLASH.name)
    vi.mocked(listModels).mockRejectedValue(codedError('network'))
    const { container } = render(<Harness />)
    await act(async () => {})
    expect(listModels).toHaveBeenCalledTimes(1)
    expect(container).toBeEmptyDOMElement()
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('renders a given successful result without querying itself', async () => {
    withModel(PRO.name)
    render(<ModelSettings query={{ status: 'success', models: [PRO, FLASH], requestId: 1 }} />)
    expect(await screen.findByLabelText('模型')).toHaveValue(PRO.name)
    expect(listModels).not.toHaveBeenCalled()
  })

  it('shows the loading text while the given query is loading', async () => {
    render(<ModelSettings query={{ status: 'loading', models: [], requestId: 1 }} />)
    expect(screen.getByText('正在取得模型清單…')).toBeInTheDocument()
    // Still loading once the saved model has been read.
    await act(async () => {})
    expect(screen.getByText('正在取得模型清單…')).toBeInTheDocument()
    expect(screen.queryByLabelText('模型')).not.toBeInTheDocument()
  })

  it('shows a load error when settings cannot be read', async () => {
    vi.mocked(loadSettings).mockRejectedValue(new Error('boom'))
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent('無法讀取設定，請重新整理頁面。')
    expect(screen.queryByLabelText('模型')).not.toBeInTheDocument()
  })

  // Stale responses for a replaced key are covered in useModelQuery and
  // SettingsPage tests; here the whole wiring goes away mid-request.
  it('drops a pending query result after unmount', async () => {
    const pending = deferred()
    vi.mocked(listModels).mockReturnValue(pending.promise)
    const { unmount } = render(<Harness />)
    await act(async () => {})
    expect(listModels).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => pending.resolve([FLASH]))
    // No auto-select save from the stale response.
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('drops a pending query error after unmount', async () => {
    const pending = deferred()
    vi.mocked(listModels).mockReturnValue(pending.promise)
    const { unmount } = render(<Harness />)
    await act(async () => {})
    expect(listModels).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => pending.reject(codedError('network')))
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('does not update after unmount while settings are loading', async () => {
    const load = deferred()
    vi.mocked(loadSettings).mockReturnValue(load.promise)
    const { unmount } = render(<Harness />)
    unmount()
    await act(async () => load.resolve({ geminiModel: '' }))
    expect(updateSettings).not.toHaveBeenCalled()
  })
})

describe('ModelSettings after a sync', () => {
  it('selects the model a sync brought from another device', async () => {
    withModel(PRO.name)
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    expect(select).toHaveValue(PRO.name)
    withModel(FLASH.name)
    await act(async () => syncReplacedData.emit())
    expect(select).toHaveValue(FLASH.name)
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('keeps the selection when the reload fails', async () => {
    withModel(PRO.name)
    render(<Harness />)
    const select = await screen.findByLabelText('模型')
    vi.mocked(loadSettings).mockRejectedValue(new Error('idb'))
    await act(async () => syncReplacedData.emit())
    expect(select).toHaveValue(PRO.name)
  })
})
