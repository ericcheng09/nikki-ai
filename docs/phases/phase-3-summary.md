# Phase 3 Summary：日曆

- 分支：`dev/phase-3`
- 範圍：spec 第 8 節 Phase 3（主畫面日曆、有日記日期標示、切換月份、點選日期篩選列表），以及日記頁「←」與刪除後的去向改為回到前一頁
- 依據文件：`docs/spec.md`（3.3、第 7 節、8.3）、`docs/decisions.md`（Phase 3「日曆」、Phase 2「畫面」的頂部列）、`docs/WORKFLOW.md`

---

## 1. 完成的功能（對照 spec 8.3 驗收條件）

| # | 驗收條件 | 狀態 | 主要實作 |
|---|---|---|---|
| 1 | 日曆顯示在主畫面：電腦上在旁邊，手機上在上方 | 完成 | P3-T2（768px 以上日曆在列表左邊，較窄時在上方） |
| 2 | 有寫日記的日期有顯著標示 | 完成 | P3-T1 `entryDates`、P3-T2（底色圓圈） |
| 3 | 可以切換月份 | 完成 | P3-T1 `addMonths`、P3-T2（「‹」「›」「今天」） |
| 4 | 點選有日記的日期，顯示當天的日記列表並可開啟 | 完成 | P3-T3（列表只顯示當天，標題「M月D日 的日記」＋「顯示全部」） |
| 5 | 點選沒有日記的日期，不自動開啟新增日記 | 完成 | P3-T2（沒有日記的日期是純文字，不能點也不能聚焦） |
| 6 | 已刪除的日記不計入標示 | 完成 | P3-T1 `entryDates`、P3-T2 |
| 7 | 日曆標示邏輯的單元測試通過；有 E2E 測試且通過 | 完成 | P3-T1（TDD）、`e2e/calendar.spec.js`、`calendar-select.spec.js`、`acceptance-phase3.spec.js` |

decisions.md Phase 3 的其他項目也都完成：一週從星期日開始；標題「2026 年 10 月」；打開主畫面顯示本月；今天以外框標示；月初前與月底後留白；不顯示篇數；再點同一天或按「顯示全部」回到完整列表；選取的月份與日期記在網址（`/?month=2026-10&date=2026-10-18`），重新整理或從日記頁返回後保留。

說明頁「這個 App 可以做什麼」新增第 2 條「日曆」（P3-T4，文字經使用者確認）。

---

## 2. 任務與 commit 對照（`git log main..dev/phase-3`）

| commit | 類型 | 內容 |
|---|---|---|
| `488c321` | 文件 | decisions.md 新增「Phase 3」日曆各項；頂部列「←」改為日記頁、新增頁也回到前一頁 |
| `76edff3` | P3-T1 | 日曆純函式（TDD）：月曆格子、有日記的日期、切換月份、網址參數驗證、標題格式 |
| `2e09b6b` | P3-T2 | 主畫面日曆元件與版面；日記改由主畫面讀取一次，日曆與列表共用 |
| `93890d3` | P3-T3 | 點選日期篩選列表、網址保留月份與日期；日記頁「←」與刪除後回到前一頁 |
| `d14db1b` | P3-T4 | 說明頁新增「日曆」說明 |
| `072285d` | P3-T3b | 「顯示全部」後，等標題更新為「我的日記」再移動焦點（T3 review 的後續修正；T4 已在 T3 之後，所以做成獨立 commit，不改寫歷史） |

尚未 commit：`e2e/acceptance-phase3.spec.js`（Tester 的 Phase 3 驗收測試），將與本 summary（及 README，如使用者同意）一起由 Developer commit。

---

## 3. 改動的檔案與用途

### 3.1 新增

| 檔案 | 用途 |
|---|---|
| `src/lib/calendar.js` | 日曆純函式：`monthGrid`（星期日開始，月外為 `null`，4～6 週）、`entryDates`（未刪除日記的日期）、`currentMonth`（裝置時區）、`addMonths`（0001～9999 年）、`monthOfDate`、`parseMonthParam`／`parseDateParam`（嚴格驗證）、`formatMonthTitle`／`formatDayTitle` |
| `src/lib/homeQuery.js` | 主畫面網址參數規則：`resolveHomeQuery`（丟掉無效或沒有日記的日期、月份跟著日期）、`homeSearchParams`（保留其他參數） |
| `src/lib/navigation.js` | `canGoBackInApp`：判斷是否有前一個 App 內頁面；「←」與刪除日記共用 |
| `src/components/Calendar.jsx` | 月曆元件：「‹」「›」「今天」、語意化表格、有日記的日期為切換按鈕（`aria-pressed`）、今天 `aria-current="date"` |
| `e2e/calendar.spec.js`、`calendar-select.spec.js`、`acceptance-phase3.spec.js` | Phase 3 E2E |
| `src/lib/calendar.test.js`、`homeQuery.test.js`、`navigation.test.js`、`src/components/Calendar.test.jsx` | 對應的單元測試 |

### 3.2 修改

| 檔案 | 改動 |
|---|---|
| `src/components/HomePage.jsx` | 通過首次說明檢查後才讀取日記（一次），分給日曆與列表；月份與選取日期由網址決定，更新一律 `replace`；日記載入後才修正網址 |
| `src/components/DiaryList.jsx` | 改為由 props 提供資料；選取日期時只列當天、標題「M月D日 的日記」與「顯示全部」；「顯示全部」後焦點移到列表標題 |
| `src/components/TopBar.jsx` | 「←」在日記頁、新增頁、設定頁都回到前一個 App 內頁面，沒有時回主畫面（判斷移到 `navigation.js`） |
| `src/components/DiaryEditor.jsx` | 刪除後：有前一個 App 內頁面就回上一頁，否則以 `replace` 回主畫面 |
| `src/components/WelcomePage.jsx` | 新增「日曆」說明 |
| `src/index.css` | 主畫面版面（768px 以上加寬到 1120px，日曆欄 320px）、日曆樣式（有日記、今天、選取）、停用的圖示按鈕、列表標題列 |
| `e2e/diary-create.spec.js`、`diary-edit-delete.spec.js`、`layout.spec.js`、`top-bar.spec.js`、`welcome.spec.js` | 配合新版面、返回行為與說明頁文字；等待時機修正 |

---

## 4. 設計決定與偏離原計畫之處

### 4.1 使用者決定（`docs/decisions.md` Phase 3，`488c321`）

- 篩選既有的日記列表（不另開頁面）；只有有日記的日期可以點，沒有日記的日期沒有反應。
- 有日記的日期以底色圓圈標示，不顯示篇數；一週從星期日開始；「‹」「›」與「今天」；不限制可切換的範圍。
- 768px 以上日曆在列表左邊，較窄時在上方。
- 選取的月份與日期記在網址，重新整理或從日記頁返回後保留。
- 日記頁與新增頁的「←」改為回到前一頁（Phase 2 是一律回主畫面）。
- 說明頁「日曆」條目的文字。

### 4.2 Planner 決定

- 月初之前與月底之後留白；再點同一天取消選取。
- 主畫面在 768px 以上加寬到 1120px（同日記頁），日曆欄約 320px。
- 日曆用語意化表格；有日記的日期是按鈕，名稱「10月5日，有日記」；沒有日記的日期是純文字，不可聚焦；今天外框加 `aria-current`；選取的日期 `aria-pressed` 並有明顯樣式。
- 日記改由主畫面讀取一次，日曆與列表共用。
- 「‹」「›」在超出 0001～9999 年時停用；網址中無效的月份改顯示本月。
- 網址一律以 `replace` 更新（瀏覽月份與日期不增加瀏覽紀錄）；切換月份會清除選取日；無效的 month／date，或該日已沒有日記時，從網址移除；有效的日期決定月份。
- 刪除日記後與「←」相同：有前一個 App 內頁面就回上一頁（保留選取，該日沒有日記時自動移除），否則以 `replace` 回主畫面。
- 「顯示全部」後焦點移到列表標題「我的日記」，並等標題更新後才移動（P3-T3b）。

### 4.3 接受的 Developer 選擇

- 日曆計算用整數運算，不用 `Date`（不受時區、夏令時間、兩位數年份被當成 19xx 影響）；年份範圍 0001～9999。
- 日記載入中或讀取失敗時，日曆照常顯示但沒有標示；日曆標題為 h2，並是 polite live region（切換月份時會念出新月份）。
- 今天又有日記時，加一圈橘色外框；停用的「‹」「›」顯示為變淡。
- 「←」除了 `location.key` 外，再用 React Router 存在 `history.state.idx` 的位置判斷（直接開新增頁、存檔後按「←」不會離開 App）。
- 日記載入中或讀取失敗時，網址中有效的日期先保留；已在本月時按「今天」不動作；其他網址參數保留；切換月份後網址明確寫出 month。

### 4.4 與 Phase 1／2 不同的行為

- **日記頁、新增頁的「←」**：Phase 2 一律回主畫面；現在回到前一個 App 內頁面（例如帶著日曆月份與選取日的主畫面），直接開啟時回主畫面。
- **刪除日記後**：Phase 1／2 一律 `navigate('/')`（新增一筆瀏覽紀錄，按瀏覽器「上一頁」會回到「找不到這篇日記」）；現在回上一頁，或以 `replace` 回主畫面。
- **主畫面寬度**：768px 以上從 720px 加寬到 1120px。
- **列表讀取**：`DiaryList` 不再自己讀資料，改由 `HomePage` 讀取。

---

## 5. Tester 驗收測試結果

| 項目 | 結果 |
|---|---|
| spec 8.3 驗收條件 1～7 | 全部通過（`e2e/acceptance-phase3.spec.js`） |
| spec 8.1、8.2 回歸測試 | 通過 |
| 單元測試 `npm test` | 835 passed（P3-T3b 之後） |
| E2E 開發伺服器 `npm run test:e2e` | 235 passed、8 skipped（skip 為只對正式 build 有意義的 `deploy.spec.js`）；連續 3 次穩定 |
| E2E 正式 build `npm run test:e2e:prod` | 243 passed |
| E2E `CI=1` | 243 passed |

---

## 6. 需要使用者決定的事項

- **README 更新文字**：見第 9 節（Code Reviewer 回報中附建議文字）。
- 其餘 Phase 3 的規格問題都已在開始前或過程中由使用者決定，目前沒有待決事項。

---

## 7. 已知問題與待處理事項

### 7.1 已接受的限制

- **依賴 React Router 的 `history.state.idx`**（`src/lib/navigation.js`）：React Router 7 在每次導覽時都會寫入；若之後升級的版本不再寫入，會退回只看 `location.key`，此時「直接開新增頁、存檔後按『←』」會離開 App 而不是回主畫面。升級 React Router 時要重新確認。
- **過了午夜「今天」不會自動更新**：今天的外框在畫面重新顯示時才會移動（例如切換月份、回到主畫面），沒有計時器。
- **年份範圍 0001～9999**：超出時「‹」「›」停用（decisions.md「不限制範圍」在實務上等同）。
- **沒有日記的「今天」**：`aria-current` 放在純文字上，部分螢幕閱讀器可能不會念出「今天」；畫面上有外框。
- **列表篩選本身不會被念出**：選取日期的按鈕會念出「已按下」，列表標題變化沒有 live region。
- **載入中**：網址中有效、但還沒確認有沒有日記的日期，會先短暫顯示當天標題，載入後若沒有日記才移除。
- **讀取日記失敗**：網址的日期保留，畫面會在錯誤訊息上方顯示當天標題與「顯示全部」。
- **768px 斷點**：仍同時寫在 `src/lib/useMediaQuery.js` 與 `src/index.css`（Phase 2 起）。

### 7.2 後續 phase 待辦（沿用 Phase 2）

- Phase 4：`ApiKeySettings.jsx` 與說明頁「key 只會存在這個瀏覽器」的文字要改；spec 第 6 節沒有定義 `geminiApiKey`、`geminiModel` 在兩台裝置不同時的合併規則。
- Phase 4 同步日記時，日曆的標示與列表會依新資料重新計算；目前日記只在進入主畫面時讀取一次，同步後需重新讀取或通知主畫面。

### 7.3 親自操作時請確認

- 電腦與手機上的日曆位置、標示顏色、今天與選取日的樣式是否清楚。
- 點日期 → 開日記 → 按「←」或瀏覽器「上一頁」→ 回到同一個月份與選取日。
- 刪除某天唯一的日記後，回到主畫面時該日的標示與選取都消失。
- 直接開 `/entry/new` 存檔後按「←」回主畫面，不離開 App。

---

## 8. 建議使用者親自閱讀的地方

| 優先 | 檔案 | 原因 |
|---|---|---|
| 1 | `src/components/DiaryEditor.jsx` 的刪除處理、`src/lib/navigation.js` | 資料刪除後的去向（回上一頁或 `replace` 回主畫面）；依賴 React Router 的 `history.state.idx` |
| 2 | `src/components/HomePage.jsx`、`src/lib/homeQuery.js` | 網址參數（使用者可任意輸入的外部內容）的驗證與修正規則；何時讀取日記 |
| 3 | `src/lib/calendar.js` 的 `entryDates` | 決定哪些日期被標示（排除已刪除的日記） |

本 phase 沒有金鑰、外部服務呼叫或資料寫入格式的改動；日曆只讀取日記，顯示的只有日期與數字。

---

## 9. README 是否需要更新

**需要。** `README.md` 仍是 Phase 2 的內容：

1. 標題「目前功能（Phase 2）」改為「目前功能（Phase 3）」。
2. 功能清單加上日曆一項。
3. 「之後的 Phase 預計加入」移除「日曆（Phase 3）」。

其他內容（技術選型、安裝、測試指令）不需要改。建議文字見 Code Reviewer 回報。
