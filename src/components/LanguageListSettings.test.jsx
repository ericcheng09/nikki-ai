import { act, fireEvent, render, screen, within } from '@testing-library/react'
import LanguageListSettings from './LanguageListSettings.jsx'
import { deleteCustomLanguage, loadSettings } from '../storage/connection.js'

vi.mock('../storage/connection.js', () => ({
  loadSettings: vi.fn(),
  deleteCustomLanguage: vi.fn(),
}))

const item = (name, deleted = false) => ({
  name,
  updatedAt: '2026-10-01T00:00:00.000Z',
  deleted,
  deletedAt: deleted ? '2026-10-01T00:00:00.000Z' : null,
})

function withList(customLanguages) {
  vi.mocked(loadSettings).mockResolvedValue({ customLanguages })
}

const EMPTY_TEXT =
  '尚未加入任何語言。在日記的語言選單選「其他」並輸入語言名稱，就會加入這裡。'

function rowNames() {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.language-name').textContent)
}

let consoleSpies

beforeEach(() => {
  withList([])
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
  vi.mocked(deleteCustomLanguage).mockReset()
})

describe('LanguageListSettings', () => {
  it('shows a loading text while settings are being read', () => {
    vi.mocked(loadSettings).mockReturnValue(new Promise(() => {}))
    render(<LanguageListSettings />)
    expect(screen.getByRole('heading', { name: '語言清單' })).toBeInTheDocument()
    expect(screen.getByText('載入中…')).toBeInTheDocument()
  })

  it('lists active languages in list order with a labelled 刪除 button each', async () => {
    withList([item('韓文'), item('法文', true), item('Deutsch')])
    render(<LanguageListSettings />)
    expect(await screen.findByText('韓文')).toBeInTheDocument()
    expect(rowNames()).toEqual(['韓文', 'Deutsch'])
    expect(screen.queryByText('法文')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刪除 韓文' })).toHaveTextContent('刪除')
    expect(screen.getByRole('button', { name: '刪除 Deutsch' })).toBeInTheDocument()
  })

  it('shows the empty text when there are no active languages', async () => {
    withList([item('法文', true)])
    render(<LanguageListSettings />)
    expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('treats a missing or malformed list as empty', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ customLanguages: 'oops' })
    render(<LanguageListSettings />)
    expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument()
  })

  it('deletes without a confirm dialog and shows 已刪除「name」', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    withList([item('韓文'), item('法文')])
    vi.mocked(deleteCustomLanguage).mockResolvedValue(['法文'])
    render(<LanguageListSettings />)
    fireEvent.click(await screen.findByRole('button', { name: '刪除 韓文' }))
    expect(await screen.findByText('已刪除「韓文」')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已刪除「韓文」')
    expect(deleteCustomLanguage).toHaveBeenCalledWith('韓文')
    expect(rowNames()).toEqual(['法文'])
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('shows the empty text after deleting the last language', async () => {
    withList([item('韓文')])
    vi.mocked(deleteCustomLanguage).mockResolvedValue([])
    render(<LanguageListSettings />)
    fireEvent.click(await screen.findByRole('button', { name: '刪除 韓文' }))
    expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument()
  })

  it('shows the list returned by storage, including changes from elsewhere', async () => {
    withList([item('韓文')])
    vi.mocked(deleteCustomLanguage).mockResolvedValue(['泰文'])
    render(<LanguageListSettings />)
    fireEvent.click(await screen.findByRole('button', { name: '刪除 韓文' }))
    await screen.findByText('已刪除「韓文」')
    expect(rowNames()).toEqual(['泰文'])
  })

  it('keeps the row and shows an error when deleting fails', async () => {
    withList([item('韓文')])
    vi.mocked(deleteCustomLanguage).mockRejectedValue(new Error('boom'))
    render(<LanguageListSettings />)
    fireEvent.click(await screen.findByRole('button', { name: '刪除 韓文' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '無法儲存設定，請重新整理頁面後再試一次。',
    )
    expect(rowNames()).toEqual(['韓文'])
    expect(screen.getByRole('button', { name: '刪除 韓文' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('ignores further clicks while a delete is in progress', async () => {
    withList([item('韓文'), item('法文')])
    let finish
    vi.mocked(deleteCustomLanguage).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<LanguageListSettings />)
    const button = await screen.findByRole('button', { name: '刪除 韓文' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: '刪除 法文' }))
    expect(deleteCustomLanguage).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => finish(['法文']))
    expect(rowNames()).toEqual(['法文'])
  })

  it('clears an earlier error on the next successful delete', async () => {
    withList([item('韓文'), item('法文')])
    vi.mocked(deleteCustomLanguage)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(['法文'])
    render(<LanguageListSettings />)
    fireEvent.click(await screen.findByRole('button', { name: '刪除 韓文' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '刪除 韓文' }))
    await screen.findByText('已刪除「韓文」')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a load error when settings cannot be read', async () => {
    vi.mocked(loadSettings).mockRejectedValue(new Error('boom'))
    render(<LanguageListSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent('無法讀取設定，請重新整理頁面。')
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument()
  })
})
