import AnalysisView from './AnalysisView.jsx'
import {
  WELCOME_SAMPLE_ANALYSIS,
  WELCOME_SAMPLE_CONTENT,
} from '../lib/welcomeSample.js'

// First-use welcome page (spec 3.5). Shown automatically until the user
// presses 開始使用 (in the top bar, see WelcomeStartButton), and reachable
// any time via 使用說明 in the top bar. The sample is rendered from
// constants; nothing here touches diary entries.
export default function WelcomePage() {
  return (
    <article className="welcome">
      <h2>歡迎使用外語學習日記</h2>
      <p>用外語寫日記，讓 AI 幫你找出錯誤、推薦更道地的說法。</p>

      <section aria-labelledby="welcome-features">
        <h3 id="welcome-features">這個 App 可以做什麼</h3>
        <ul className="welcome-features">
          <li>
            寫日記：選擇日期，用任何外語寫下日記，一天可以寫好幾篇。日記存在你的瀏覽器裡，只有在你按「AI 批改」時，那篇日記的內容才會送到 Google Gemini。
          </li>
          <li>
            日曆：主畫面的日曆會標出有寫日記的日子，點一下就只看那天的日記；可以切換月份，回顧以前的紀錄。
          </li>
          <li>
            選擇語言：日記可以選日文、英文，或讓 AI 自動判斷。其他語言選「其他」並輸入名稱，下次就能直接選。
          </li>
          <li>
            AI 批改：在日記頁按「AI 批改」，AI 會找出文法錯誤和不通順的句子，推薦更道地的說法，並附上修改後的全文和中文翻譯。批改結果只顯示在日記旁邊，不會改動你的日記。
          </li>
          <li>
            使用前準備：AI 批改需要你自己的 Gemini API key，可以免費申請。從畫面右上角的齒輪「設定」貼上 key，App 通常會自動幫你選好模型。key 只會存在這個瀏覽器，只用來呼叫 Gemini。
          </li>
        </ul>
      </section>

      <section aria-labelledby="welcome-sample">
        <h3 id="welcome-sample">範例</h3>
        <p>以下用一篇日文日記，示範 AI 批改的結果。</p>
        <p className="welcome-sample-content">{WELCOME_SAMPLE_CONTENT}</p>
        <AnalysisView analysis={WELCOME_SAMPLE_ANALYSIS} />
      </section>
    </article>
  )
}
