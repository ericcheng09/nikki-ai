# Phase 1 Summary：基礎日記

- 分支：`dev/phase-1`
- 範圍：spec 第 8 節 Phase 1（專案建置、日記新增／編輯／刪除、排序、本機儲存、首次使用說明（含範例日記與批改結果的唯讀顯示）、部署）
- 依據文件：`docs/spec.md`、`docs/decisions.md`、`docs/WORKFLOW.md`

---

## 1. 完成的功能（對照 spec 8.1 驗收條件）

| # | 驗收條件 | 狀態 | 主要實作 |
|---|---|---|---|
| 1 | 新增日記：日期選擇器（預設今天）、純文字內容、儲存 | 完成 | T4、T5 |
| 2 | 內容空白時不儲存（只有空白字元也視為空白） | 完成 | T2 `isBlank`、T4 |
| 3 | 同一天可新增多篇 | 完成 | T2、T4 |
| 4 | 列表依日期排序，同一天依建立時間排序 | 完成 | T2 `sortEntries`、T4 |
| 5 | 編輯與刪除；刪除前確認；軟刪除、立即清除內文、畫面上不再顯示 | 完成 | T2 `softDeleteEntry`、T5 |
| 6 | 重新整理或關閉瀏覽器後日記仍存在 | 完成 | T3 IndexedDB、T4 |
| 7 | 首次使用說明頁（功能介紹、範例日記、完整 AI 批改結果、粗體不以 HTML 渲染）；按「開始使用」後不再自動顯示；「使用說明」可重開；範例不出現在列表 | 完成 | T6b、T6c |
| 8 | 網站已部署、公開網址可存取、`main` 更新後自動部署 | **待合併後驗證** | T7 |
| 9 | 核心邏輯（排序、軟刪除）單元測試通過 | 完成 | T2 |
| 10 | 主要流程（新增 → 儲存 → 重新整理後仍存在）E2E 通過 | 完成 | T4 起各 E2E |
| 11 | README 包含簡介、部署網址、技術選型、本機安裝執行、測試執行 | 完成 | T8 |

---

## 2. 任務與 commit 對照（`git log main..dev/phase-1`）

| commit | 類型 | 內容 |
|---|---|---|
| `4a1998f` | T1 | Vite + React 專案骨架、`base: '/nikki-ai/'`、BrowserRouter basename、Vitest／Playwright 設定 |
| `7ac64ec` | T2 | 日記核心純函式（TDD）：建立、空白判斷、編輯、軟刪除、排序、過濾、本地日期 |
| `cb84f9f` | 規格 | 範例日記刪除改為直接移除（後被 `76e770a` 取代） |
| `d77ab64` | T3 | IndexedDB 儲存層（entries、settings 兩個 store） |
| `36bf5b6` | T4 | 主畫面日記列表與新增頁、單一 DB 連線 |
| `dcf2e4d` | T5 | 日記頁 `/entry/:id`：編輯與軟刪除 |
| `18af851` | 舊 T6 | 範例日記存為日記資料、可刪除。**已由 T6a 移除，依使用者決定保留在 git 歷史中，不改寫歷史** |
| `76e770a` | 規格 | 範例改為「首次使用說明頁」：spec 3.3、3.5、4.1、4.3、第 6 節、8.1-7、8.3-6、8.4-9；CLAUDE.md 移除範例例外 |
| `2b9a2e5` | 文件 | 新增 `docs/decisions.md`（spec 第 9 節引用，效力等同規格） |
| `641ffc4` | T6a | 移除舊範例實作（isSample、整筆刪除、seed、範例頁、範例 E2E） |
| `9efd0e2` | T6b | `**` 粗體安全解析（TDD）與唯讀批改結果元件 `AnalysisView` |
| `1476e72` | T6c | 首次使用說明頁 `/welcome`、`welcomeSeen` 設定、主畫面導向與「使用說明」連結 |
| `79d826f` | 文件 | decisions.md 補「首次使用說明」「AI 批改結果顯示」兩節 |
| `2501c95` | T7 | GitHub Actions 部署、404.html、模擬 Pages 的測試伺服器、正式 build 的 E2E |
| `44bb43c` | T8 | README |

---

## 3. 改動的檔案與用途（以目前分支內容為準）

| 檔案 | 用途 |
|---|---|
| `package.json`、`package-lock.json` | 套件與 npm scripts（dev、test、test:e2e、test:e2e:prod、build、preview） |
| `vite.config.js` | `base: '/nikki-ai/'`；Vitest 設定（jsdom、setupFiles、固定 `TZ=Asia/Taipei`、收集 src 與 scripts 的測試） |
| `index.html` | 入口頁（`lang="zh-Hant"`、中文標題） |
| `src/main.jsx` | 掛載 App、BrowserRouter（basename 取自 `import.meta.env.BASE_URL`） |
| `src/App.jsx` | 頁首與路由：`/`、`/welcome`、`/entry/new`、`/entry/:id` |
| `src/index.css` | 版面與樣式 |
| `src/setupTests.js` | 載入 jest-dom matchers |
| `src/lib/diary.js` | 日記核心純函式：`isBlank`、`createEntry`、`updateEntry`、`softDeleteEntry`、`sortEntries`、`filterActiveEntries`、`getLocalDateString` |
| `src/lib/boldMarkup.js` | 將 `**` 標記解析為資料片段，供以 React 元素顯示粗體 |
| `src/lib/welcomeSample.js` | 說明頁的範例日記與批改結果（程式常數，深度凍結，不存入 DB） |
| `src/storage/db.js` | IndexedDB：開啟與升級、entries 讀寫（只有新增或覆蓋，沒有整筆刪除）、settings 讀寫（只接受已知 key） |
| `src/storage/connection.js` | 全 App 共用單一 DB 連線；`loadEntries`、`loadEntry`、`saveEntry`、`deleteEntry`（軟刪除）、`loadSettings`、`updateSettings`、`markWelcomeSeen` |
| `src/components/HomePage.jsx` | 主畫面：依 `welcomeSeen` 決定是否導向說明頁；「使用說明」連結與列表 |
| `src/components/DiaryList.jsx` | 日記列表（過濾已刪除、排序、80 字預覽、載入中、空狀態、錯誤狀態） |
| `src/components/DiaryEditor.jsx` | 新增與編輯表單、刪除按鈕、驗證與提示訊息 |
| `src/components/EntryPage.jsx` | `/entry/:id` 載入日記，找不到時顯示「找不到這篇日記」 |
| `src/components/WelcomePage.jsx` | 首次使用說明頁與「開始使用」 |
| `src/components/AnalysisView.jsx` | 唯讀批改結果顯示（Phase 2 沿用） |
| `src/**/*.test.js(x)` | 單元測試 |
| `scripts/copy-404.js` | build 後複製 `dist/index.html` 為 `dist/404.html` |
| `scripts/pages-server.js` | 只用於測試的靜態伺服器，模擬 GitHub Pages（找不到的路徑回 404 並附 404.html、補斜線 301、防路徑穿越）；不會被部署 |
| `scripts/*.test.js` | 上述兩個 script 的單元測試 |
| `playwright.config.js`、`playwright.prod.config.js` | E2E 設定：本機對開發伺服器，CI 或 `test:e2e:prod` 對正式 build；port 5199 |
| `e2e/*.spec.js`、`e2e/helpers.js` | E2E：smoke、新增、編輯與刪除、首次使用說明、部署行為 |
| `.github/workflows/deploy.yml` | push `main` 時執行安裝 → 單元測試 → build → E2E → 部署 GitHub Pages |
| `.gitignore` | 排除 node_modules、dist、Playwright 產出 |
| `README.md` | 專案說明 |
| `docs/spec.md`、`CLAUDE.md` | 規格修訂（範例改為首次使用說明） |
| `docs/decisions.md` | 開發細節決定（效力等同規格） |

---

## 4. 設計決定與偏離原計畫之處

以下只記錄事實與使用者的決定。

### 4.1 範例資料設計變更

- 原規格：範例存為一篇日記、標示「範例」、可刪除。中途使用者決定範例刪除時直接移除、不留刪除記號（`cb84f9f`），並依此實作了舊 T6（`18af851`）。
- 之後使用者改變設計：範例不再存為日記，改為「首次使用說明頁」（`76e770a`），並以設定 `welcomeSeen` 取代 `sampleDismissed`。
- Git 處理方式依使用者選擇：不改寫歷史，舊 T6 保留在歷史中，以 T6a（`641ffc4`）新 commit 移除。
- 原 T6 因此拆為 T6a（移除舊範例）、T6b（唯讀批改結果顯示）、T6c（首次使用說明頁）。
- Phase 1 因此已提供唯讀的批改結果顯示元件 `AnalysisView`，Phase 2 將沿用。

### 4.2 新增 `docs/decisions.md`

- 記錄規格本文沒寫到、但已經確定的細節，效力等同規格（spec 第 9 節引用）。新增或修改須經使用者確認。

### 4.3 其他使用者決定（詳見 `docs/decisions.md`）

- 排序：日期新的在上；同一天內後寫的在上。
- 日期以裝置時區的今天為預設，以 `YYYY-MM-DD` 儲存與顯示；日期被清空時不儲存。
- 內容原樣保存，不去除前後空白。
- 新增後跳到該篇日記頁（history replace，按上一頁回到列表）；編輯後留在原頁並顯示「已儲存」。
- 編輯成空白不儲存，保留原內容；離開時不提醒未儲存的修改。
- 刪除前使用瀏覽器內建確認視窗，確認後回主畫面。
- 首次使用說明只在進入主畫面時判斷；讀取設定失敗時照常顯示列表；寫入失敗仍回主畫面，本次開啟期間不再導向。
- 批改結果的空項目顯示方式、「→」「／」分隔符、`**` 的配對規則。
- 部署：以複製 404.html 處理子路徑重新整理；CI 執行單元測試與 E2E，任一失敗不部署；CI 的 E2E 對正式 build 執行；Node 22。
- E2E 使用專屬 port 5199，不沿用已開啟的伺服器；Vitest 固定在 `Asia/Taipei` 時區執行。

### 4.4 Planner 接受的範圍外修改

- T7 修改了 `vite.config.js`，讓 Vitest 也收集 `scripts/` 的測試。
- T7 的 workflow 加入 `workflow_dispatch`（手動觸發），並以 `if: github.ref == 'refs/heads/main'` 限制只有 main 會部署。

---

## 5. Tester 驗收測試結果（Phase 1 結束驗收）

- 單元測試：`npm test` 144 passed；`TZ=UTC` 下也是 144 passed。
- E2E（開發伺服器）：29 passed、7 skipped（skip 的是部署專用的 `e2e/deploy.spec.js`，只對正式 build 有意義）。
- E2E（正式 build，`npm run test:e2e:prod`）：36 passed。
- E2E（`CI=1`）：36 passed；`CI=1` 搭配 repeat-each 3、retries 0，共 108 passed。
- build 產出的 `index.html` 與 `404.html` 內容相同。
- 驗收 1～7、9～11 通過；驗收 8 的實際部署待合併到 main 後驗證。

---

## 6. 已知問題與待處理事項

### 6.1 合併後必須確認

- **驗收 8**:合併到 main 後確認三件事:GitHub Actions 部署成功、`https://ericcheng09.github.io/nikki-ai/` 可公開存取、之後 main 更新會自動部署。
- 使用者須先在 repo 的 Settings → Pages 把 Source 設為「GitHub Actions」(一次性設定,由使用者處理)。

### 6.2 親自操作前

- 曾在本機開發伺服器(`localhost:5173`)操作過舊 T6 的瀏覽器,IndexedDB 可能還留著舊範例日記和 `sampleDismissed` 設定,舊範例會被當成一般日記顯示在列表中。親自操作前,請先清除 localhost 的網站資料。

### 6.3 Phase 2 開始前需要使用者決定

- **同一個 github.io 網域下的專案共用資料**:部署後網域是 `https://ericcheng09.github.io`,和你帳號下其他 GitHub Pages 專案相同,那些專案的程式(包括它們使用的第三方套件)在技術上能讀寫本 App 的 IndexedDB。Phase 2 會把 Gemini API key 存進去,需要決定是否接受這個暴露範圍,或改用自訂網域等做法。
- **`language` 欄位的存值格式**:spec 4.1 只寫「日文、英文,或使用者自行輸入的語言」,沒有定義要存成什麼值(例如 `'ja'` 或「日文」),這會影響提示詞中 `{語言}` 的填法。
- **說明頁和 AI 批改按鈕**:說明頁的範例是否需要「AI 批改」按鈕,以及相關的呈現方式。

### 6.4 後續 phase 的注意事項

- spec 3.5 規定說明頁文字每個 phase 結束時都要更新。Phase 2 要把「AI 批改功能即將推出」改掉並加上 API key 說明;Phase 4 要補充 Google Drive 同步的說明(說明頁目前寫「不會上傳到我們的伺服器」)。
- Phase 2 的 JSON 驗證應保證:三個列表欄位是由物件組成的陣列、`alternatives` 有 1 到 2 個字串、文字欄位都是字串。建議也用同一個驗證函式驗證說明頁的範例常數。`analysis` 為 null(尚未批改)時由外層處理。
- Phase 2 寫入批改結果需要專用函式,只能寫 `analysis` 欄位(`updateEntry` 只允許修改 content、date、language),以符合「不得覆蓋原文」。
- Phase 4:同步以字串比較 `updatedAt`,前提是所有時間戳都由 `toISOString()` 產生;`welcomeSeen` 不同步。

### 6.5 尚未處理的非阻擋建議(來自各任務 review)

- `src/storage/db.js` 的 `runTransaction` 支援多 store,但移除舊範例後只剩單一 store 的用法。
- 從「使用說明」重新打開說明頁後按「開始使用」,歷史紀錄會留下兩個 `/`,按上一頁會停在同一頁。
- `connection.loadEntry` 是讀出全部日記再找出那一篇,資料量變大時可改用 `store.get(id)`。
- `scripts/pages-server.js` 補斜線的 301 不保留 query string(只影響測試伺服器)。
- 內容沒有修改也按儲存時,仍會更新 `updatedAt`。
- 收到 `onversionchange` 關閉 DB 後,`connection.js` 仍沿用已關閉的連線,畫面只會提示重新整理;未來升級 DB 版本時需要處理。
- `crypto.randomUUID()` 只在安全環境(HTTPS 或 localhost)可用,用區網 IP 以 http 連開發伺服器時無法新增日記。
- `docs/decisions.md`「部署與測試」寫「CI 的 E2E 對正式 build(preview)執行」,但實際用的是 `scripts/pages-server.js`,不是 `vite preview`。用字的修改需經使用者確認。

---

## 7. 建議使用者親自閱讀的地方(依優先順序)

| 優先 | 檔案 | 原因 |
|---|---|---|
| 1 | `.github/workflows/deploy.yml` | 外部服務與對外發布:部署權限(`pages: write`、`id-token: write`)、觸發條件(含 `workflow_dispatch` 與只限 main 的部署條件) |
| 2 | `src/storage/connection.js`(`deleteEntry`)、`src/storage/db.js`(`putEntry`、`saveSettings`) | 資料刪除與寫入:所有刪除都是軟刪除,刪除記號只留 4 個欄位;db 層沒有整筆刪除 |
| 3 | `src/components/AnalysisView.jsx`、`src/lib/boldMarkup.js` | 外部內容(AI 回傳)的顯示,安全規則 5.4:所有欄位以文字輸出,`**` 轉為 `<strong>`,不使用原始 HTML |
| 4 | `docs/decisions.md` | 效力等同規格,由 Planner 整理;請確認每一條都是你的決定 |
| 5 | `src/components/WelcomePage.jsx`、`src/lib/welcomeSample.js` | 給使用者看的說明文字和範例批改內容(日文與中文說明的正確性);「開始使用」失敗時的處理 |
| 6 | `src/components/HomePage.jsx` | 是否導向說明頁的判斷 |
| 7 | `scripts/pages-server.js` | 會讀取本機檔案的伺服器(防路徑穿越);只用於測試 |
| 8 | `src/components/DiaryEditor.jsx`(刪除處理) | 刪除確認文字,以及刪除後回主畫面的行為 |

另外,第 6.3 節「同一個 github.io 網域下的專案共用資料」是影響 API key 安全的規格決策,請在 Phase 2 開始前閱讀。

---

## 8. README 是否需要更新

**Phase 1 不需要更新。**

`README.md` 已包含 spec 8.1-11 與 spec 第 9 節 Phase 1 要求的全部內容,與現行程式一致:

- App 簡介
- 部署網址(與 git remote `ericcheng09/nikki-ai` 一致)
- 技術選型
- 本機安裝與執行(Node 22、`npm ci`、dev 5173、preview 4173)
- 測試執行方式(`npm test`、`test:e2e`、`test:e2e:prod`、Playwright 瀏覽器安裝)
- Pages 來源的一次性設定

可選的小幅補充(不影響驗收):

- 在「文件」一節加上 `docs/phases/phase-1-summary.md` 的連結。spec 第 9 節要求專案完成時才需要連結 phase summary,所以現在加不加都可以。
- 註明用手機以區網 IP 連開發伺服器時無法新增日記(`crypto.randomUUID` 需要安全環境)。
