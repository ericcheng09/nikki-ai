import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WelcomePage from './WelcomePage.jsx'
import { saveEntry } from '../storage/connection.js'
import { WELCOME_SAMPLE_CONTENT } from '../lib/welcomeSample.js'

vi.mock('../storage/connection.js', () => ({
  markWelcomeSeen: vi.fn(),
  saveEntry: vi.fn(),
}))

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <WelcomePage />
    </MemoryRouter>,
  )
}

afterEach(() => {
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
    const features = screen
      .getByRole('heading', { name: '這個 App 可以做什麼' })
      .closest('section')
    // Only features available now (spec 3.5), in this order.
    expect(
      within(features)
        .getAllByRole('listitem')
        .map((item) => item.textContent.trim()),
    ).toEqual([
      '寫日記：選擇日期，用任何外語寫下日記，一天可以寫好幾篇。日記存在你的瀏覽器裡，只有在你按「AI 批改」時，那篇日記的內容才會送到 Google Gemini。',
      '日曆：主畫面的日曆會標出有寫日記的日子，點一下就只看那天的日記；可以切換月份，回顧以前的紀錄。',
      '選擇語言：日記可以選日文、英文，或讓 AI 自動判斷。其他語言選「其他」並輸入名稱，下次就能直接選。',
      'AI 批改：在日記頁按「AI 批改」，AI 會找出文法錯誤和不通順的句子，推薦更道地的說法，並附上修改後的全文和中文翻譯。批改結果只顯示在日記旁邊，不會改動你的日記。',
      '使用前準備：AI 批改需要你自己的 Gemini API key，可以免費申請。從畫面右上角的齒輪「設定」貼上 key，App 通常會自動幫你選好模型。key 只會存在這個瀏覽器，只用來呼叫 Gemini。',
    ])
    expect(screen.getByRole('heading', { name: '範例' })).toBeInTheDocument()
    expect(
      screen.getByText('以下用一篇日文日記，示範 AI 批改的結果。'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/即將推出/)).not.toBeInTheDocument()
    // The sample stays static: no review button here (decisions.md).
    expect(screen.queryByRole('button', { name: 'AI 批改' })).not.toBeInTheDocument()
    // 開始使用 lives in the top bar now (decisions.md 畫面).
    expect(screen.queryByRole('button', { name: '開始使用' })).not.toBeInTheDocument()
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
})
