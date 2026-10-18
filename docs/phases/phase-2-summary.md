# Phase 2 Summary：AI 批改

- 分支：`dev/phase-2`
- 範圍：spec 第 8 節 Phase 2（API key 設定與說明、語言選擇、提示詞模板、JSON 解析、批改結果顯示），以及 spec 3.5 修改後的主畫面選單（F1 起改為每頁的頂部固定列）
- 使用者回饋修改 F1～F9 見第 10 節；第 1～9 節為原本的 Phase 2 內容，被 F1～F9 改變的地方已標註「（已由 Fn 取代）」。
- 依據文件：`docs/spec.md`、`docs/decisions.md`（Phase 2 各節）、`docs/WORKFLOW.md`

---

## 1. 完成的功能（對照 spec 8.2 驗收條件）

| # | 驗收條件 | 狀態 | 主要實作 |
|---|---|---|---|
| 1 | 設定頁可輸入、修改、刪除 Gemini API key，並有申請說明 | 完成 | P2-T1、P2-T2 |
| 2 | 未設定 API key 時按批改，提示先到設定頁設定 | 完成 | P2-T7、P2-T8 |
| 3 | 按「AI 批改」才送出；儲存日記時不自動送出 | 完成 | P2-T8 |
| 4 | 語言選擇：自動判斷（預設）、日文、英文、其他；自行輸入的語言加入清單、可直接選、可在設定頁刪除 | 完成 | P2-T3、P2-T4、P2-T5 |
| 5 | 批改結果依 4.2 欄位顯示；文法錯誤為空顯示「無錯誤」；修改處粗體 | 完成 | P2-T8（沿用 Phase 1 的 `AnalysisView`） |
| 6 | 電腦上批改結果與日記左右並排，手機上上下排列 | 完成 | P2-T9 |
| 7 | 批改結果不修改日記原文；修改後可重新批改，新結果覆蓋舊結果 | 完成 | P2-T8 |
| 8 | 批改結果會儲存，重新打開日記仍可看到 | 完成 | P2-T8 |
| 9 | API 失敗或格式錯誤時顯示清楚訊息，不影響日記，不自動重試 | 完成 | P2-T6、P2-T7、P2-T8 |
| 10 | AI 回傳內容不以原始 HTML 渲染 | 完成 | P2-T6、P2-T8 |
| 11 | JSON 解析與驗證單元測試通過；批改流程 E2E（模擬 AI 回應）通過 | 完成 | P2-T6、P2-T8 |
| 12 | 設定頁可從可用模型中選擇；查詢失敗或所選模型無法使用時顯示清楚提示 | 完成 | P2-T2b |

spec 3.5 修改（Phase 2 前置決定）：主畫面右上角「選單」提供「設定」與「使用說明」，取代 Phase 1 的「使用說明」連結（P2-T1）；說明頁文字更新為 Phase 2 的功能（P2-T10）。**（已由 F1 取代：「選單」移除，「設定」與「使用說明」改為每頁頂部固定列的圖示按鈕；spec 3.5、8.1-7 已於 `4c52521` 修改。）**

---

## 2. 任務與 commit 對照（`git log main..dev/phase-2`）

| commit | 類型 | 內容 |
|---|---|---|
| `3392266` | 文件 | Phase 2 前置決定：spec 2.2、3.5、3.6、4.3、5.1、第 6 節、8.1-7 修改；decisions.md 新增 Phase 2 各節 |
| `49900a2` | P2-T1 | 主畫面「選單」（設定／使用說明）、`/settings` 骨架 |
| `53f1014` | P2-T2 | 設定頁 Gemini API key（輸入、顯示／隱藏、儲存、刪除、申請說明） |
| `c5782a5` | P2-T2b | 模型查詢與選擇（`src/lib/gemini.js` `listModels`、`ModelSettings`）；E2E 全域外部請求防護 |
| `d551dc2` | P2-T3 | 語言清單純函式（TDD）：解析「其他」輸入、加入、恢復、軟刪除、選單選項 |
| `a787cde` | P2-T4 | 日記編輯頁語言選單；自行輸入的語言與日記在同一交易寫入 |
| `52a41e5` | P2-T5 | 設定頁語言清單管理（軟刪除） |
| `356fb84` | P2-T6 | 提示詞模板、responseSchema、回應驗證與解析（TDD） |
| `b3dbfd3` | P2-T7 | Gemini generateContent 用戶端、錯誤代碼與中文訊息、120 秒逾時 |
| `48bc2f8` | P2-T8 | 日記頁「AI 批改」流程與結果顯示；批改結果與編輯儲存都在交易內合併到最新紀錄 |
| `5878288` | P2-T9 | 日記頁 768px 以上左右並排 |
| `2ac4e4d` | P2-T10 | 說明頁文字更新（使用者確認過的文字） |

之後的 commit：`314a40a` P2-T10b（說明頁模型用詞）、`fe65759` 文件（本 summary、README、`e2e/acceptance-phase2.spec.js`）。使用者回饋修改 F1～F9 的 commit 見 10.2。

---

## 3. 改動的檔案與用途

### 3.1 新增

| 檔案 | 用途 |
|---|---|
| ~~`src/components/HomeMenu.jsx`~~ | （已由 F1 取代：已刪除，改為 `TopBar.jsx`） |
| `src/components/SettingsPage.jsx` | `/settings`：API key、模型、語言清單三個區塊；不受 `welcomeSeen` 影響 |
| `src/components/ApiKeySettings.jsx` | API key 輸入／顯示隱藏／儲存（去除空白）／刪除（不確認）、狀態行、申請說明（狀態行已由 F6 改為 key 可用狀態；申請說明已由 F7 改為可收合） |
| `src/components/ModelSettings.jsx` | 有 key 時查詢模型、自動選 Flash、變更即存、查詢失敗與「重新查詢」、所選模型已不在清單時提示（已由 F5／F6／F8 取代：不再自行查詢、沒有「重新查詢」，篩選與自動選擇在 `src/lib/models.js`） |
| `src/components/LanguageListSettings.jsx` | 語言清單列表與每列「刪除」（軟刪除、不確認） |
| `src/components/LanguageField.jsx` | 日記編輯頁的語言選單與「其他」輸入框（T8 review 時從 DiaryEditor 拆出） |
| `src/components/AiReviewPanel.jsx` | 「AI 批改」按鈕、錯誤訊息（含設定頁連結）、批改時間與結果顯示 |
| `src/lib/languages.js` | 語言清單純函式（`resolveLanguageInput`、`addLanguage`、`removeLanguage`、`activeLanguageNames`、`languageOptions`） |
| `src/lib/editorForm.js` | 編輯表單的 `formLanguage`／`hasUnsavedChanges` 純函式（T8 review 時拆出） |
| `src/lib/prompt.js` | spec 5.5 提示詞模板與 `buildPrompt` |
| `src/lib/analysis.js` | `ANALYSIS_RESPONSE_SCHEMA`（含 propertyOrdering）、`validateAnalysis`、`parseAnalysisResponse` |
| `src/lib/gemini.js` | Gemini API 用戶端：`listModels`、`generateAnalysis`、錯誤對照與中文訊息 |
| `src/lib/geminiError.js` | `GeminiError`（code 為機器可讀代碼，訊息固定不含資料） |
| `e2e/menu.spec.js`（已由 F1 的 `top-bar.spec.js` 取代）、`settings-api-key.spec.js`、`settings-model.spec.js`、`language.spec.js`、`settings-languages.spec.js`、`ai-review.spec.js`、`layout.spec.js`、`acceptance-phase2.spec.js` | Phase 2 E2E |
| 各 `*.test.js(x)` | 對應的單元測試 |

### 3.2 修改

| 檔案 | 改動 |
|---|---|
| `src/App.jsx` | 新增 `/settings` 路由 |
| `src/components/HomePage.jsx` | 「使用說明」連結改為 `HomeMenu`（已由 F1 取代：改由頂部列提供） |
| `src/components/DiaryEditor.jsx` | 語言選單；編輯儲存改用 `saveEntryEdit`（交易內合併）；已刪除日記不再被儲存復活；掛上 `AiReviewPanel`；並排版面的外框 |
| `src/components/WelcomePage.jsx` | 說明文字改為 Phase 2 功能 |
| `src/lib/diary.js` | 新增 `formatLocalDateTime`（批改時間） |
| `src/storage/db.js` | 設定新增 `geminiApiKey`、`geminiModel`、`customLanguages`（預設值每次重新建立）；新增 `putEntryAddingLanguage`、`removeCustomLanguage`、`putEntryEdit`、`putEntryAnalysis` |
| `src/storage/connection.js` | 對應的 `saveEntryAddingLanguage`、`deleteCustomLanguage`、`saveEntryEdit`、`saveEntryAnalysis` |
| `src/index.css` | 選單、設定頁、語言清單、批改區、768px 以上兩欄版面 |
| `e2e/helpers.js` | `writeStore`；Gemini 模擬（模型清單、generateContent）；**全域外部請求防護**（未模擬的外部請求一律中止並使測試失敗） |
| `e2e/welcome.spec.js`、`deploy.spec.js` | 改用選單開啟說明頁；prod 專用的 `/settings` 直接開啟與重新整理測試 |

---

## 4. 設計決定與偏離原計畫之處

以下只記錄事實；細節以 `docs/decisions.md` 與 Planner 決策紀錄為準。

### 4.1 Planner 決定（使用者未逐條決定，請確認）

- **Commit 前綴**：Phase 2 用「P2-T<n>:」，以區分 Phase 1 的「T<n>:」。
- **介面文字**（「選單」與「目前已設定 API key」已由 F1、F6 取代）：選單按鈕「選單」、設定頁各訊息（「請輸入 API key」「目前已設定／尚未設定 API key」「已儲存」「已刪除」「已刪除「<名稱>」」、語言清單空狀態說明、「語言名稱」「例如：韓文」「請輸入日記語言」「AI 批改結果」「批改時間：YYYY-MM-DD HH:mm」「無法顯示批改結果，請重新批改。」「這篇日記已被刪除，無法儲存。」等）由 Planner 定稿；讀寫失敗訊息比照日記頁。
- **模型查詢**（已部分由 F5／F6／F8 取代：清單只列正式版主要文字模型；自動選最新的正式版 Flash；查詢狀態改在 API key 區顯示，失敗時隱藏模型區、沒有「重新查詢」，改用「重新確認」；見第 10 節）：ListModels（v1beta），key 只放 `x-goog-api-key` header，依 `nextPageToken` 翻頁（最多 20 頁）；只保留名稱為 `models/gemini*` 且支援 `generateContent` 的模型；`geminiModel` 存完整名稱；自動選第一個名稱含「flash」（不分大小寫）者，沒有則提示「請選擇模型」；選單變更即存；刪除 key 時隱藏模型區但保留 `geminiModel`；查詢失敗訊息分「API key 無效／無法連線／其他」三種，並有「重新查詢」。接受 Developer 追加「找不到可用的模型。」。
- **語言清單**：順序為第一次加入的順序，恢復的語言留在原位置；「其他」輸入 `auto`／「自動判斷」視同自動判斷，「日文」「英文」視同選該選項，皆不加入清單；清單資料格式不正確時略過壞項目，並排除保留名稱；舊日記用到、但不在清單中的語言，只在該篇日記的選單出現（放在清單語言之後、「其他」之前）。
- **交易內讀取再寫入**：加入語言（與日記同一交易）、刪除語言、寫回批改結果、編輯儲存，都在同一個 IndexedDB 交易內讀取最新資料再寫入，避免畫面上的舊資料覆蓋其他地方的修改。批改結果只寫 `analysis` 與 `updatedAt`。
- **編輯儲存不再讓已刪除的日記復活（Phase 1 行為變更）**：Phase 1 的編輯儲存會整筆覆蓋，若日記已在其他分頁刪除會復活。現在若資料庫中該篇已刪除或不存在，則不寫入，顯示「這篇日記已被刪除，無法儲存。」並保留輸入內容。
- **Gemini 請求**：逾時 120 秒視為網路錯誤；不自動重試；模型名稱須符合 `^models/[A-Za-z0-9._-]+$` 才組 URL（防止請求離開 API 路徑），不符視為模型無法使用；沒有候選結果或沒有文字（例如安全封鎖、MAX_TOKENS）視為格式錯誤；回應容許外包一層 ```json 程式碼框。
- **錯誤訊息附設定頁連結**：invalidKey、modelUnavailable、noKey、noModel。
- **E2E 全域外部請求防護**：所有 spec 都攔截非 localhost 的請求；只有模擬的 Gemini 端點會回應，其他一律中止並使測試失敗，確保 E2E 不會呼叫真的 Gemini。
- **版面**：日記頁在 768px 以上兩欄等寬，只有這一頁把容器加寬到 1120px（用 CSS `:has()`；不支援的瀏覽器仍是兩欄，只是在 720px 內）；新增頁維持單欄；DOM 順序為表單 → 批改結果。

### 4.2 使用者決定

- Gemini endpoint（`src/lib/gemini.js` 的 `API_BASE`，v1beta）維持寫死，不做成設定。
- 說明頁（P2-T10）文字由使用者確認。
- 其餘 Phase 2 前置決定已寫入 `docs/decisions.md`（`3392266`），包括接受 github.io 同網域共用資料的風險、`language` 存值格式、說明頁不放批改按鈕。

### 4.3 接受的 Developer 選擇

- `GeminiError` 獨立為 `geminiError.js`（避免 `gemini.js` 與 `analysis.js` 互相 import）。
- `listModels` 的 429 → quota、404 → modelUnavailable（設定頁仍顯示原本三種訊息）。
- 提示詞中語言名稱去除空白、「自動判斷」視同 auto；非字串內容視為空字串；`PROMPT_TEMPLATE` 由測試直接比對 spec 5.5 原文。
- 批改結果寫入失敗顯示「無法儲存批改結果，請重新整理頁面後再試一次。」；按批改時讀取設定失敗顯示一般批改失敗訊息；批改期間日記被刪除則靜默丟棄結果；錯誤訊息保留到下次按批改。
- generateContent 回應中的 thought 部分略過，其餘文字部分合併。

---

## 5. Tester 驗收測試結果

（以下為 F1～F9 之前的結果；最新結果見 10.4。）

- spec 8.2 驗收條件 1～12 全部通過；spec 8.1 Phase 1 驗收條件回歸測試通過。
- 單元測試：`npm test` 571 passed。
- E2E（開發伺服器，`npm run test:e2e`）：123 passed、8 skipped（skip 的是只對正式 build 有意義的 `e2e/deploy.spec.js`）。
- E2E（正式 build，`npm run test:e2e:prod`）：131 passed。
- E2E（`CI=1`）：131 passed；連續執行 3 次結果穩定。
- 所有 E2E 的 Gemini 回應皆為模擬資料，並由全域防護確保沒有實際呼叫外部服務。

---

## 6. 需要使用者決定的事項

以下 Planner 與 Code Reviewer 都沒有自行決定，請使用者決定。

**更新：三項都已由使用者決定（2026-10-18）**：(1) 補進 decisions.md（「AI 批改」節）；(2) 安全封鎖維持顯示格式錯誤訊息；(3) 改為「App 通常會自動幫你選好模型」（`314a40a`），「旁邊」維持。

1. **未選模型時的提示文字**：目前顯示「請先到設定頁選擇 Gemini 模型。」（附設定頁連結）。decisions.md「AI 批改」的錯誤訊息清單中沒有這一條，若同意請補進 decisions.md。
2. **安全封鎖的訊息**：Gemini 因安全規則封鎖提示詞時（回應 200 但沒有候選結果），目前顯示格式錯誤訊息「AI 回傳的格式不正確，請再試一次。」，但重試通常沒有用。要不要另設專用訊息（例如說明內容被 Gemini 拒絕）？
3. **說明頁文字的兩處用詞**（`src/components/WelcomePage.jsx`）：
   - 「App 會自動幫你選好模型」：只有模型清單中有 Flash 模型時才會自動選；是否改為「通常會自動幫你選好模型」？
   - 「批改結果只顯示在日記旁邊」：螢幕寬度小於 768px（手機）時，結果在日記下方。是否修改用詞？

---

## 7. 已知問題與待處理事項

### 7.1 後續 phase 待辦

- **Phase 4 文字**：`src/components/ApiKeySettings.jsx` 的「API key 只會存在這個瀏覽器，只用來呼叫 Gemini，不會傳送到其他地方。」與 `src/components/WelcomePage.jsx` 的「key 只會存在這個瀏覽器，只用來呼叫 Gemini。」在 Phase 4 同步上線後不再正確（spec 5.4：瀏覽器與 Google Drive），屆時要改。
- **Phase 4 規格缺口**：spec 第 6 節只定義日記與語言清單的合併規則，沒有定義 `geminiApiKey`、`geminiModel` 兩台裝置都有值且不同時以哪個為準（兩者目前沒有 `updatedAt`）。Phase 4 開始前需要決定。
- **`src/lib/prompt.test.js` 綁定 spec 的格式**：測試從 `docs/spec.md` 的「### 5.5」之後第一個 ```text 區塊讀出模板比對；若重新排版 spec（改標題或程式碼框語言），測試會失敗。這是刻意設計，用來防止模板與規格不一致。
- **Gemini API 版本固定為 v1beta**（`src/lib/gemini.js` `API_BASE`），依使用者決定維持寫死；若 Google 調整 v1beta，需要改這一行。

### 7.2 已接受的行為

- **批改期間修改日記**：批改送出的是按下按鈕時已儲存的內容。若批改期間修改並儲存日記，結果仍會存進該篇，但可能對應舊內容；畫面會顯示批改時間，由使用者決定是否重新批改（符合 decisions.md「舊批改結果照常顯示，並標出批改時間」）。
- 在另一個分頁已刪除某語言後，於設定頁再刪除一次，仍會顯示「已刪除「<名稱>」」（清單本身會正確更新）。

### 7.3 親自操作時請確認

- **768px 平板直向**：剛好 768px 時兩欄各約 350px，請在平板直向看一下是否好用。
- 需要一把真的 Gemini API key 才能確認實際批改（E2E 全部是模擬資料）。請確認：自動選到的模型、批改結果的品質與格式、錯誤 key 時的訊息。
- 用過 Phase 1 版本的瀏覽器可直接使用；新的設定項目有預設值，不需要清除資料。

### 7.4 尚未處理的非阻擋建議

- Phase 1 summary 6.5 的項目仍未處理（`loadEntry` 讀出全部日記、內容未修改也會更新 `updatedAt`、`onversionchange` 後沿用已關閉的連線等）。
- 設定頁三個區塊各自讀取一次設定（每次開啟設定頁讀三次），目前資料量下沒有影響。

---

## 8. 建議使用者親自閱讀的地方（依優先順序）

| 優先 | 檔案 | 原因 |
|---|---|---|
| 1 | `src/lib/gemini.js` | 外部服務呼叫，會送出 API key 與日記內容：key 只放 `x-goog-api-key` header（不進 URL、body、錯誤訊息或 log）；請求 URL 由儲存的模型名稱組成（有格式檢查）；錯誤代碼對照；120 秒逾時、不重試 |
| 2 | `src/components/ApiKeySettings.jsx` | 金鑰的輸入、儲存、顯示（密碼欄、顯示／隱藏）與刪除；所有錯誤處理都不記錄 log |
| 3 | `e2e/helpers.js`（全域外部請求防護、`installGeminiMock`） | 確保 E2E 永遠不會呼叫真的 Gemini、也不會把測試 key 送到外部；這個防護失效時測試可能打到真的 API |
| 4 | `src/storage/db.js`（`putEntryAnalysis`、`putEntryEdit`、`putEntryAddingLanguage`、`removeCustomLanguage`） | 資料寫入與刪除：批改結果只寫 `analysis`／`updatedAt`、絕不寫原文；已刪除的日記不會被編輯或批改結果復活（Phase 1 行為變更）；語言清單軟刪除；跨兩個 store 的交易 |
| 5 | `src/components/AiReviewPanel.jsx` | 外部 AI 內容的顯示（以文字輸出、重新驗證儲存的結果）；按鈕時讀取 key 並呼叫外部服務；未儲存修改時不送出 |
| 6 | `src/lib/analysis.js`（中風險） | AI 回傳內容的驗證：任何不符都整體視為格式錯誤，未知欄位丟棄 |
| 7 | `src/lib/prompt.js`（中風險） | 日記內容放進提示詞的方式（原樣插入，不會被當作模板變數再次替換） |
| 8 | `src/components/WelcomePage.jsx` | 給使用者看的說明文字（第 6 節第 3 點） |

另外請閱讀第 6 節「需要使用者決定的事項」與 7.1 的 Phase 4 規格缺口。

---

## 9. README 是否需要更新

**更新：已於 `fe65759` 更新，F1 再改為頂部列的描述（第 3 點的「選單」已不適用）。F1～F9 之後的檢查見 10.7。**

**需要。** `README.md` 目前仍是 Phase 1 的內容，以下幾處與現況不符：

1. 開頭簡介：「之後的版本會加入 AI（Gemini）批改……」與「日記存在你的瀏覽器（IndexedDB）裡，不會上傳到伺服器。」需改為已提供 AI 批改，並說明按「AI 批改」時日記會送到 Gemini。
2. 標題「目前功能（Phase 1）」改為「目前功能（Phase 2）」，並補上 Phase 2 功能。
3. 「之後可從主畫面的「使用說明」重新打開」改為從右上角「選單」打開。
4. 「之後的 Phase 預計加入」移除 AI 批改那一行。
5. 技術選型「Gemini API（Phase 2 起，使用者自備 API key）」可維持。
6. 測試指令沒有變更，不需要改。
7. 可選：「文件」一節加上 phase summary 連結（spec 第 9 節要求專案完成時才需要）。

建議文字見 Code Reviewer 回報。

---

## 10. 使用者回饋修改（F1～F9）

使用者在 2026-10-18 實際操作後提出 U1～U9 回饋並確認方案；之後再決定自動選最新 Flash 與日記框自動長高（F8、F9）。規格與決定的修改在 `4c52521`（spec 3.5、8.1-7、decisions.md）與 `d94a78b`（decisions.md「Gemini 模型」「畫面」）。

### 10.1 回饋與對應任務

| 回饋 | 使用者的意見 | 任務 | 做了什麼 |
|---|---|---|---|
| U1、U6、U7 | 「返回列表」移到左上；改成每頁固定的頂部列；說明頁頂部列放「開始使用」 | F1 | 每頁頂部固定列：左「←」返回（設定、日記、新增頁）、中 App 名稱（回主畫面）、右「設定」「使用說明」圖示按鈕（設定頁不顯示「設定」）；說明頁右邊只放「開始使用」。移除「選單」、底部「返回列表」／「取消」、設定頁「回主畫面」 |
| U2 | 寬螢幕時批改結果固定在畫面上、在區內捲動 | F2 | 768px 以上批改區 sticky 在頂部列下方，最高為畫面高度扣掉頂部列與上下 16px，區內捲動；此時批改區可用 Tab 聚焦以鍵盤捲動；`scroll-padding-top` 讓聚焦的元素不被頂部列蓋住 |
| U3 | 「語言名稱」旁加「加入」 | F3 | 按「加入」或 Enter 立即加入語言清單並選取（日記沒存也加入）；日文／英文／auto／自動判斷直接選該選項；空白提示「請輸入日記語言」；Enter 不送出日記 |
| U9 | 日期與語言同一行 | F4 | 日期與語言各半寬同一行；「語言名稱」＋「加入」在下一行全寬；表單寬度小於 340px 才上下排列（375px 手機仍並排） |
| U4 | 模型清單只列主要模型 | F5 | 只列 `gemini-<版本>-pro／-flash／-flash-lite`（可帶 `-NNN`），不列 preview、exp、`-latest` 等；篩完沒有時列出完整清單 |
| U8 | 顯示 API key 是否可用 | F6 | API key 區顯示「正在確認 API key…」「API key 可以使用」「API key 無效，請確認後重新儲存。」「無法確認 API key，請檢查網路後再試一次。」或「無法確認 API key，請稍後再試。」（後兩者附「重新確認」）；與模型清單共用同一次請求；無效的 key 照樣儲存 |
| U5 | 「？如何取得」展開／收起說明 | F7 | 「？如何取得」按鈕展開或收起申請說明；沒有 key 時預設展開、有 key 時預設收起 |
| 使用者決定 1、2 | 自動選最新的正式版 Flash；flash-lite 算 Flash | F8 | 尚未選模型時，依版本號選最新的正式版 Flash |
| 使用者決定 3 | 日記內容框隨內容長高 | F9 | 「內容」框至少 12 行，隨內容長高、縮回，不在框內捲動 |

### 10.2 Commit

| commit | 類型 | 內容 |
|---|---|---|
| `4c52521` | 文件 | 記錄 U1～U9 的決定（spec 3.5、8.1-7、decisions.md） |
| `f341e8c` | P2-F1 | 頂部固定列 |
| `24d075a` | P2-F2 | 寬螢幕批改區固定在畫面上 |
| `39dbdbb` | P2-F3 | 自行輸入語言的「加入」按鈕 |
| `e7eda2a` | P2-F4 | 日期與語言同一行 |
| `4bed8fa` | P2-F5 | 只列正式版主要文字模型 |
| `5463701` | P2-F6 | 顯示 API key 是否可用 |
| `5828226` | P2-F7 | 可收合的 API key 申請說明 |
| `d94a78b` | 文件 | 記錄自動選最新 Flash 與內容框自動長高（decisions.md） |
| `1a46ab8` | P2-F8 | 自動選最新的正式版 Flash |
| `eb58fbf` | P2-F9 | 內容框隨內容長高 |

尚未 commit：Tester 為目前畫面更新的 `e2e/acceptance-phase2.spec.js`，以及 `e2e/layout.spec.js` 一個視窗縮放測試改為等版面穩定後再判斷（F9 的寬度變化在下一個畫面才重新計算高度）；將與本 summary 一起由 Developer commit。

### 10.3 各任務的決定

**F1**
- Planner：設定頁的「回主畫面」移除；找不到日記頁的「回主畫面」保留；返回鈕無障礙名稱「返回」；圖示用內嵌 SVG。返回目標：日記頁與新增頁回主畫面，設定頁回到進入前的 App 內頁面（直接開啟時回主畫面）。
- 接受 Developer：頂部列在 `.app` 外全寬、內容對齊 `--page-width`；返回鈕為按鈕，顯示「←」。
- Review 修正（併入原 commit）：`TopBar.jsx` 改用 `matchPath` 判斷頁面；頂部列重新整理案例的測法；`scroll-padding-top` 移到 F2。
- 說明頁「使用前準備」與 README 中的「選單」用詞改為頂部列（使用者確認過文字）。

**F2**
- 接受 Developer：上下各留 16px；不加 `overscroll-behavior`；`--top-bar-height` 固定為 57px；批改區只在 768px 以上可 Tab 聚焦（`src/lib/useMediaQuery.js`）。
- decisions.md 的「高度為畫面扣掉頂部列」實作為最大高度：內容少時批改區較矮。

**F3**
- Planner：未按「加入」就儲存日記時，仍在儲存時加入（保留原本的保險）；加入失敗顯示「無法儲存設定，請重新整理頁面後再試一次。」；Enter 不送出日記。
- 接受 Developer：「加入」與儲存／刪除共用同一個進行中鎖；錯誤顯示在表單原有的錯誤行；成功後焦點移到語言選單；輸入法組字中的 Enter 不觸發；晚到的清單讀取會合併已加入的語言。
- 加入語言在同一個 IndexedDB 交易內讀取最新清單再寫入（`addCustomLanguage`），已軟刪除的同名語言恢復原項目。
- Review 修正（併入原 commit）：Safari 輸入法確認候選字的 Enter（`keyCode` 229）不觸發；點「加入」失敗時焦點回到輸入框。

**F4**
- Planner：約 340px 以下才換行；Tab 順序 日期 → 語言 →（語言名稱 → 加入）→ 內容。
- 接受 Developer：用 flex 換行而非 grid（避免寬畫面出現三欄）；每欄最小 162px。

**F5**
- Planner：已選但被篩掉、仍可用的模型（例如之前選的 preview）保留為額外選項，不顯示「已無法使用」；只有完整清單也沒有時才提示重新選擇。
- 接受 Developer：篩選放在 `src/lib/models.js`；切換到其他模型後，被隱藏的舊模型不再出現在選單。

**F6**
- Planner：查詢狀態統一顯示在 API key 區（含「重新確認」）；其他失敗（額度、伺服器錯誤等）顯示「無法確認 API key，請稍後再試。」；模型區只在查詢中與成功後顯示，失敗時不顯示錯誤也沒有「重新查詢」；「目前已設定 API key」由狀態文字取代；「儲存」「刪除」進行中改用 `aria-disabled` 保留焦點，刪除成功後焦點移到 key 欄位。
- 接受 Developer：失敗時整個模型區（含標題）隱藏；key 無效時不顯示「重新確認」；狀態行只在有 key 時出現；請求集中在 `src/lib/useModelQuery.js`，每次開設定頁、儲存 key、按「重新確認」各一次請求。
- Review 修正（併入原 commit）：按「重新確認」後焦點不再遺失。

**F7**
- Planner：載入後只決定一次展開狀態（無 key 展開、有 key 收起），之後儲存或刪除 key 不自動切換；讀取設定失敗時展開。
- 「API key 只會存在這個瀏覽器，只用來呼叫 Gemini，不會傳送到其他地方。」移到可收合的說明內，有 key 時預設看不到。

**F8**
- 使用者：flash 與 flash-lite 都算 Flash；先比版本號（新者優先），同版本 flash 優先於 flash-lite、不帶 `-NNN` 優先；沒有可比較版本的 Flash 時，改選第一個名稱含「flash」的模型。
- Planner：帶 `-NNN` 的之間，數字大的優先；仍相同時依 API 順序。只在尚未選模型時自動選，不覆蓋已選的模型。

**F9**
- Planner：最少 12 行、沒有上限。
- 接受 Developer：只用 JS（`src/lib/useAutoGrow.js`，不用 CSS `field-sizing`）；關閉拖拉調整大小的把手；調整高度時保留頁面捲動位置；寬度變化時在下一個畫面重新計算（避免 ResizeObserver loop 錯誤，Tester 發現後修正）。

### 10.4 Tester 驗收測試結果（`eb58fbf` 加上未 commit 的兩個 E2E 檔）

| 項目 | 結果 |
|---|---|
| spec 8.2 驗收條件 1～12 | 全部通過 |
| spec 8.1 Phase 1 驗收條件回歸（含修改後的 8.1-7：頂部列「使用說明」重新打開說明頁） | 通過 |
| 單元測試 `npm test` | 735 passed（31 個檔案） |
| E2E 開發伺服器 `npm run test:e2e` | 203 passed、8 skipped（skip 為只對正式 build 有意義的 `deploy.spec.js`）；連續 3 次穩定 |
| E2E 正式 build `npm run test:e2e:prod` | 211 passed（執行 2 次） |
| E2E `CI=1` | 211 passed |

F1～F9 新增或改寫的 E2E：`top-bar.spec.js`（取代 `menu.spec.js`）、`sticky-panel.spec.js`、`language.spec.js`（加入）、`layout.spec.js`（日期與語言同一行、Tab 順序）、`settings-model.spec.js`（篩選、自動選最新 Flash）、`settings-api-key.spec.js`（key 可用狀態、焦點）、`settings-guide.spec.js`、`auto-grow.spec.js`。所有 Gemini 回應仍為模擬資料，並有全域外部請求防護。

### 10.5 已知問題與接受的限制

- **頂部列高度固定 57px**（`src/index.css` 的 `--top-bar-height`）：與頂部列的 CSS（40px 按鈕＋上下 8px＋1px 邊框）連動；瀏覽器設定很大的最小字級或只放大文字時，頂部列可能變高，批改區與聚焦位置會略被蓋住。一般縮放沒有影響。
- **768px 斷點寫在兩處**：`src/lib/useMediaQuery.js` 的 `WIDE_LAYOUT_QUERY` 與 `src/index.css` 的 media query，修改時要一起改。
- **768px 時兩欄各約 352px**，日期與語言同一行只多約 12px 空間；請在平板直向看一下。
- **模型篩選的備用清單**：篩完沒有主要模型時列出所有支援 generateContent 的 Gemini 模型，可能包含圖片或語音模型（符合 decisions.md 字面）。
- **自動選模型依名稱格式**：依 Google 的模型命名比較版本；若命名方式改變，會退回「第一個名稱含 flash」的規則。
- **內容框每次輸入會重新計算高度**：日記長度下沒有影響；極長的內容（數千行）輸入可能略慢。
- **F7**：有 key 時「API key 只會存在這個瀏覽器…」的說明預設收起。
- 第 7 節的既有事項仍適用（Phase 4 文字與規格缺口、v1beta 寫死等）；設定頁三個區塊仍各自讀取一次設定。

### 10.6 建議使用者親自閱讀的地方（F1～F9 新增或改動）

| 優先 | 檔案 | 原因 |
|---|---|---|
| 1 | `src/lib/useModelQuery.js`、`src/components/SettingsPage.jsx` | 用使用者的 API key 呼叫外部服務（模型清單）：每次開頁、儲存、重新確認各一次請求；舊請求的結果會被丟棄；錯誤只保留代碼，不記錄 log |
| 2 | `src/components/ApiKeySettings.jsx` | 金鑰的儲存與刪除、key 可用狀態與錯誤文字、焦點處理、可收合的說明（含「只存在這個瀏覽器」說明） |
| 3 | `src/storage/db.js` 的 `addCustomLanguage` | 「加入」直接寫入語言清單（交易內讀取再寫入、恢復軟刪除的項目、`updatedAt`），Phase 4 同步會用到 |
| 4 | `src/lib/models.js`、`src/components/ModelSettings.jsx` | 決定列出哪些模型、預設自動選哪個並儲存（之後批改就呼叫這個模型） |
| 5 | `src/components/LanguageField.jsx` | 使用者輸入的語言名稱、Enter 與輸入法處理 |

第 8 節原本的清單仍然適用。

### 10.7 待使用者處理或決定

1. **decisions.md 文字與 F5／F6 的實際行為不一致**（Planner 會提出修改文字）：
   - 「Gemini 模型」第 79 行：沒有寫到「已選但被篩掉、仍可用的模型保留為額外選項，不提示重新選擇」（F5）。
   - 「Gemini 模型」第 80 行：仍寫「查詢失敗時顯示錯誤訊息與「重新查詢」按鈕」；F6 起模型區在失敗時隱藏，改由 API key 區的「重新確認」重試。
   - 「設定頁」第 86 行：沒有「無法確認 API key，請稍後再試。」（其他失敗）以及「key 無效時不顯示重新確認」。
2. **README（可選）**：「預設自動選一個 Flash 模型」可改為「預設自動選最新的 Flash 模型」。README 其他描述（頂部列的「？」與齒輪、設定頁內容）與 F1～F9 後的現況一致，沒有「選單」「重新查詢」「目前已設定 API key」或固定大小內容框的描述。
3. 親自操作時請確認：頂部列與返回目標、寬螢幕批改區固定、「加入」語言、真的 API key 的可用狀態與自動選到的模型、錯誤 key 的訊息、長日記的內容框長高、平板直向 768px。
