import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import WelcomePage from './WelcomePage.jsx'
import { markWelcomeSeen, saveEntry } from '../storage/connection.js'
import { WELCOME_SAMPLE_CONTENT } from '../lib/welcomeSample.js'

vi.mock('../storage/connection.js', () => ({
  markWelcomeSeen: vi.fn(),
  saveEntry: vi.fn(),
}))

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <Routes>
        <Route path="/" element={<p>主畫面</p>} />
        <Route
          path="/welcome"
          element={
            <>
              <Link to="/other">離開</Link>
              <WelcomePage />
            </>
          }
        />
        <Route path="/other" element={<p>其他頁</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.mocked(markWelcomeSeen).mockReset()
  vi.restoreAllMocks()
})

describe('WelcomePage', () => {
  it('shows the fixed welcome texts', () => {
    renderWelcome()
    expect(screen.getByRole('heading', { name: '歡迎使用外語學習日記' })).toBeInTheDocument()
    expect(
      screen.getByText('用外語寫日記，讓 AI 幫你找出錯誤、推薦更道地的說法。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '這個 App 可以做什麼' })).toBeInTheDocument()
    expect(
      screen.getByText(
        '寫日記：選擇日期，用任何外語寫下日記，一天可以寫好幾篇。日記存在你的瀏覽器裡，不會上傳到我們的伺服器。',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '範例' })).toBeInTheDocument()
    expect(
      screen.getByText('AI 批改功能即將推出，以下先用一篇日文日記讓你看看批改的效果。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '開始使用' })).toBeInTheDocument()
  })

  it('shows the sample diary text and its full analysis', () => {
    renderWelcome()
    expect(screen.getByText(WELCOME_SAMPLE_CONTENT)).toHaveClass('welcome-sample-content')

    const grammar = screen.getByRole('region', { name: '文法錯誤' })
    expect(within(grammar).getAllByRole('listitem')).toHaveLength(2)
    const corrected = screen.getByRole('region', { name: '修改後全文' })
    expect([...corrected.querySelectorAll('strong')].map((el) => el.textContent)).toEqual([
      'に',
      'かった',
      '少し疲れましたが、明日も早く起きるつもりです。',
    ])
    expect(corrected).not.toHaveTextContent('**')
    expect(screen.getByRole('region', { name: '中文翻譯' })).toHaveTextContent(
      '今天和朋友一起去了一家新開的咖啡廳。',
    )
  })

  it('never stores the sample as a diary entry', () => {
    renderWelcome()
    expect(saveEntry).not.toHaveBeenCalled()
  })

  it('開始使用 records welcomeSeen and goes home', async () => {
    vi.mocked(markWelcomeSeen).mockResolvedValue()
    renderWelcome()
    fireEvent.click(screen.getByRole('button', { name: '開始使用' }))

    expect(await screen.findByText('主畫面')).toBeInTheDocument()
    expect(markWelcomeSeen).toHaveBeenCalledTimes(1)
  })

  it('still goes home, silently, when saving the setting fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error')
    vi.mocked(markWelcomeSeen).mockRejectedValue(new Error('io'))
    renderWelcome()
    fireEvent.click(screen.getByRole('button', { name: '開始使用' }))

    expect(await screen.findByText('主畫面')).toBeInTheDocument()
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('does not navigate if the user already left before the save finished', async () => {
    let resolve
    vi.mocked(markWelcomeSeen).mockReturnValue(new Promise((r) => (resolve = r)))
    renderWelcome()

    fireEvent.click(screen.getByRole('button', { name: '開始使用' }))
    fireEvent.click(screen.getByRole('link', { name: '離開' }))
    expect(screen.getByText('其他頁')).toBeInTheDocument()

    await act(async () => resolve())
    expect(screen.getByText('其他頁')).toBeInTheDocument()
    expect(screen.queryByText('主畫面')).not.toBeInTheDocument()
  })
})
