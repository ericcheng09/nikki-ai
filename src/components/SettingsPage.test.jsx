import { act, fireEvent, render, screen } from '@testing-library/react'
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
    expect(updateSettings).not.toHaveBeenCalledWith({ geminiModel: 'models/gemini-old-flash' })
  })

  it('shows the language list without an API key, after the API key section', async () => {
    renderSettings()
    await keyInput()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Gemini API key', '語言清單'])
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
    expect(headings).toEqual(['Gemini API key', 'Gemini 模型', '語言清單'])
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
})
