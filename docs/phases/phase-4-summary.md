# Phase 4 Summary：Google Drive 同步

- 分支：`dev/phase-4`
- 範圍：spec 第 8 節 Phase 4（登入 Google、日記／語言清單／API key／模型隨 Drive 同步、軟刪除與 90 天清除、同步時機與狀態、離線補傳、授權過期處理），以及說明頁、設定頁、README 的同步說明
- 依據文件：`docs/spec.md`（3.4、3.6、4.1、4.3、第 6、7 節、8.4、8.5）、`docs/decisions.md`（Phase 4「同步」「設定頁」、Phase 2 語言清單規則）、`docs/WORKFLOW.md`
- 前置作業（spec 8.5）由使用者完成：OAuth 用戶端已建立，維持「測試」發布狀態，`drive.appdata` 為非機密範圍。

---

## 1. 完成的功能（對照 spec 8.4 驗收條件）

| # | 驗收條件 | 狀態 | 主要實作 |
|---|---|---|---|
| 1 | 未登入時所有功能正常使用，資料只存在本機 | 完成 | P4-T5（未登入時不連到 Google；只有打開設定頁的同步區塊才會載入 Google 登入程式） |
| 2 | 設定頁可以登入 Google 並授權 `drive.appdata`，也可以登出 | 完成 | P4-T3 `googleAuth.js`、`GoogleSyncSettings.jsx` |
| 3 | 登入後本機與 Drive 的日記依第 6 節規則合併 | 完成 | P4-T1 `sync.js`（TDD）、P4-T2 `applySyncResult`、P4-T5 `syncEngine.js` |
| 4 | API key 與模型隨日記同步，另一台裝置登入後可直接使用 | 完成 | P4-T2（各自記錄修改時間）、P4-T5 |
| 5 | 刪除的日記同步到其他裝置後也不顯示，不會復活 | 完成 | P4-T1（較新的刪除記號優先；同時間刪除優先） |
| 6 | 超過 90 天的刪除記號於同步時從本機與 Drive 清除 | 完成 | P4-T1 `purgeExpiredTombstones`、P4-T2（本機只硬刪仍過期的記號） |
| 7 | 開啟 App、儲存日記後自動同步；有手動同步按鈕；顯示同步狀態 | 完成 | P4-T5（頂部列雲朵圖示、設定頁狀態、上次同步時間、「立即同步」） |
| 8 | 離線時儲存的日記，於恢復網路後的下一次同步補上 | 完成 | P4-T5（離線不送請求，`online` 事件時同步） |
| 9 | `welcomeSeen` 只存在本機，不參與同步 | 完成 | P4-T1（只同步兩個設定）、P4-T2（快照不含 `welcomeSeen`） |
| 10 | Google 授權過期時能重新取得或提示重新登入，不會默默同步失敗 | 完成 | P4-T3（背景續期，失敗時「需要重新登入」）、P4-T5（Drive 拒絕 token 時先背景重試一次） |
| 11 | 合併、軟刪除、90 天清除的單元測試通過；兩個瀏覽器模擬兩台裝置的同步有測試且通過 | 完成 | `sync.test.js`、`db.test.js`、`syncEngine.test.js`；`e2e/sync-two-devices.spec.js`（P4-T6） |
| 12 | 語言清單隨同步；刪除的語言另一台也不顯示；刪除後再加回時以最後動作為準 | 完成 | P4-T1（以去除空白後的名稱合併）、P4-T5（設定頁語言清單同步後重新讀取） |

decisions.md Phase 4 的其他項目也都完成：
- 資料變動約 2 秒後合併成一次同步；開啟 App、登入、網路恢復、按「立即同步」時也會同步。
- 雲朵圖示用形狀加顏色表示同步中、已同步、同步失敗，點圖示進設定頁。
- 設定頁只顯示「已登入」，不顯示 Google 帳號。
- 登出只停止同步，不刪除本機與 Drive 的資料。
- 授權過期時先在背景重新取得；失敗時顯示「Google 登入已過期，請重新登入。」並附「重新登入」。
- 正在編輯的日記不另外提示，以最後修改的為準。
- 設定頁的 API key 說明改為新文字。

說明頁新增「跨裝置同步」一項，「寫日記」「使用前準備」兩項加上 Drive 的說明（P4-T7，文字經使用者確認）。

---

## 2. 任務與 commit 對照（`git log main..dev/phase-4`）

| commit | 類型 | 內容 |
|---|---|---|
| `00cc2f2` | 文件 | decisions.md 新增「Phase 4」：同步規則、時機、狀態顯示、登出、授權過期、設定頁說明文字 |
| `9776d2a` | P4-T1 | 同步純函式（TDD）：Drive 檔案格式與驗證、日記／語言清單／兩個設定的合併、平手規則、90 天清除、是否需要寫本機或上傳 |
| `efdccaf` | P4-T2 | API key 與模型的修改時間；讀取同步快照；在單一交易內與目前本機資料再合併後寫入；資料變動通知；修正三個測試檔的偶發失敗 |
| `7fa3bae` | P4-T3 | Google 登入（GIS token 模型，只要 `drive.appdata`）、登出（撤銷 token）、重新登入；設定頁「Google Drive 同步」區塊；API key 說明新文字；E2E `google-signin.spec.js` |
| `04fd9c8` | P4-T4 | Google Drive 客戶端：列出、下載、建立、更新、刪除同步檔 |
| `46fa028` | P4-T5 | 同步流程、觸發、狀態顯示、頂部列雲朵、「立即同步」、同步後各頁重新讀取；假 Drive 與 GIS stub；E2E `sync.spec.js` |
| `940fa42` | P4-T6 | 兩台裝置 E2E（兩個瀏覽器 context 共用一個假 Drive）`sync-two-devices.spec.js` |
| `30bde9f` | P4-T5b | 修正同步後比對 API key 時用到舊值（ref 改在讀取／儲存時就更新），也修好偶發失敗的測試（T6 已在 T5 之後，做成獨立 commit） |
| `33fc37c` | P4-T7 | 說明頁與 README 的同步說明；Phase 4 驗收測試 `acceptance-phase4.spec.js` |

---

## 3. 改動的檔案與用途

### 3.1 新增

| 檔案 | 用途 |
|---|---|
| `src/lib/sync.js` | 同步純函式：`buildSyncFile`、`parseSyncFile`（`format`／`unsupportedVersion`）、`mergeSync`（合併＋清除＋是否變動）、`purgeExpiredTombstones`、`canonicalJson` |
| `src/lib/googleAuth.js` | Google 登入：載入 GIS（只從 `accounts.google.com/gsi/client`）、預先載入、互動登入與背景續期、token 重用（剩 60 秒以上）、登出與撤銷、狀態通知 |
| `src/lib/drive.js` | Drive 請求（只連 `www.googleapis.com`，token 只放 `Authorization` header）、檔案 ID 驗證、錯誤代碼 `auth`／`quota`／`notFound`／`network`／`other`、60 秒逾時 |
| `src/lib/syncEngine.js` | 同步流程：一次一個（分頁內排隊＋`navigator.locks` 跨分頁）、觸發、多個同步檔合併、解析失敗停止、Drive 拒絕 token 時重試一次、登出後不再寫入、狀態 |
| `src/lib/syncStatus.js` | 同步狀態與錯誤的中文文字、雲朵圖示樣式、上次同步時間格式 |
| `src/lib/useSyncStatus.js`、`src/lib/useSyncReplacedData.js` | 元件讀取同步狀態；「同步寫入了其他裝置的資料」時重新讀取 |
| `src/storage/syncSignals.js` | 兩種通知：本機修改了會同步的資料（排同步）、同步寫入了資料（各頁重讀，不排同步） |
| `src/components/GoogleSyncSettings.jsx` | 設定頁「Google Drive 同步」：登入、已登入、需要重新登入、同步狀態、上次同步時間、「立即同步」、登出 |
| `src/testUtils/fakeSyncEngine.js` | 元件測試用的假同步引擎 |
| `e2e/google-signin.spec.js`、`sync.spec.js`、`sync-two-devices.spec.js`、`acceptance-phase4.spec.js` | Phase 4 E2E |
| `src/lib/sync.test.js`、`googleAuth.test.js`、`drive.test.js`、`syncEngine.test.js`、`syncStatus.test.js`、`useSyncReplacedData.test.js`、`src/components/GoogleSyncSettings.test.jsx` | 對應的單元測試 |

### 3.2 修改

| 檔案 | 改動 |
|---|---|
| `src/storage/db.js` | 寫入 key／模型時同時記錄修改時間（`geminiApiKeyUpdatedAt`／`geminiModelUpdatedAt`）；`readSyncSnapshot`；`applySyncResult`；本機專用紀錄 `googleAuth`（token）與 `syncMeta`（上次同步時間）；`invalidateGoogleToken` |
| `src/storage/connection.js` | 寫入成功後發出資料變動通知；`updateSettings` 的 `automatic` 選項；登入狀態、同步時間的讀寫 |
| `src/main.jsx` | 啟動同步引擎（未登入時只讀本機狀態） |
| `src/components/TopBar.jsx`、`src/index.css` | 登入後頂部列顯示雲朵圖示（說明頁不顯示），點圖示進設定頁 |
| `src/components/SettingsPage.jsx` | 加入「Google Drive 同步」區塊 |
| `src/components/ApiKeySettings.jsx` | 新說明文字；同步帶來的 key 會顯示並重新確認（使用者正在輸入時不覆蓋輸入框） |
| `src/components/ModelSettings.jsx` | App 自動選的模型以 `{ automatic: true }` 儲存；同步後選取新的模型 |
| `src/components/LanguageListSettings.jsx`、`HomePage.jsx` | 同步後重新讀取語言清單／日記（日曆標示跟著更新） |
| `src/components/WelcomePage.jsx`、`README.md` | 同步說明（使用者確認的文字） |
| `src/lib/diary.js` | 只改註解（時間改為解析後比較） |
| `e2e/helpers.js` | 預設以空腳本回應 GIS 網址；共用 GIS stub、假 Drive（可接多個 context）；全域攔截未模擬的外部請求 |
| `e2e/settings-guide.spec.js`、`settings-languages.spec.js`、`welcome.spec.js`；多個元件測試 | 配合新區塊與新文字；修正等待時機 |

---

## 4. 設計決定與偏離原計畫之處

### 4.1 使用者決定（`docs/decisions.md` Phase 4，`00cc2f2`）

- API key 與模型各自記錄修改時間，以較新的為準；刪除 key 也會同步。
- 自動同步：資料變動（約 2 秒合併一次）、開啟 App、手動同步、網路恢復。
- 頂部列雲朵圖示（形狀＋顏色），設定頁顯示文字狀態、上次同步時間、「立即同步」；只顯示「已登入」。
- 登出只停止同步，不刪除任何資料。
- 授權過期先背景重新取得，失敗時顯示「Google 登入已過期，請重新登入。」與「重新登入」。
- 正在編輯的日記不提示，最後修改的為準。
- 設定頁 API key 說明新文字；說明頁與 README 文字（P4-T7）。

### 4.2 Planner 決定

- **Drive 檔案格式**：`{ format: 'nikki-ai-sync', version: 1, entries, customLanguages, settings: { geminiApiKey, geminiModel: { value, updatedAt } } }`，檔名 `nikki-ai-sync.json`，放在 `appDataFolder`。
- **無法讀取的檔案**：格式錯誤回 `format`，其他 App 或其他版本回 `unsupportedVersion`；兩者都停止同步，本機與 Drive 都不寫入。
- **合併**：
  - 日記以 `id`、語言以去除空白後的名稱聯集，`updatedAt` 新者為準。
  - 平手時刪除記號優先，否則鍵排序後 JSON 字串較大者，兩台結果一致。
  - 未知欄位保留；格式不對的單筆略過；超過 90 天的刪除記號清除（剛好 90 天保留，`deletedAt` 無法解析的保留）。
- **修改時間的存法**：
  - 存在 `geminiApiKeyUpdatedAt`／`geminiModelUpdatedAt`，每次寫入都更新。
  - Phase 4 之前存的值沒有時間，視為 1970-01-01。
- **App 自動選的模型**：時間記為 1970-01-01，不會蓋掉使用者在另一台手動選的模型（Tester 發現的情境）。見第 6 節。
- **寫入本機**：`applySyncResult` 在單一交易內與目前本機資料再合併。同步期間的修改保留；只硬刪仍過期的本機刪除記號；不刪除未刪除或格式錯誤的日記。
- **通知**：資料寫入成功後才發出；同步寫入只發「已被同步更新」，不會再排一次同步。
- **Google 登入**：
  - 使用 GIS token 模型，只要 `drive.appdata`。用戶端 ID 依 spec 8.5 可公開。
  - token 剩 60 秒以上才重用。
  - 背景續期失敗時回傳 `needsLogin`，不丟例外。
  - 登入失敗顯示「無法登入 Google，請再試一次。」。
  - 登出時撤銷 token，保留所有資料。
- **預先載入 Google 登入程式**：打開設定頁的同步區塊時就先載入，避免 Safari 擋掉第一次點擊的彈窗。規則改為「沒打開設定頁的人不會連到 Google」。見第 6 節。
- **Drive 客戶端**：
  - 只連 `www.googleapis.com`，token 只放 header，檔案 ID 先驗證。
  - 錯誤代碼：401→`auth`、404→`notFound`、429 與限流→`quota`；儲存空間滿→`other`；讀取錯誤內容時逾時→`network`。
  - 檔案清單依建立時間由舊到新，同時間依 ID 排序。
- **同步流程**：
  - 一次一個：分頁內排隊，跨分頁用 `navigator.locks`；同步中有變動時再排一次。
  - 有多個同名檔案時，全部合併、寫入最舊的、刪除其他。
  - Drive 回 `auth` 時進入需要重新登入。
  - 離線時不送請求，恢復網路後同步。
  - 上次同步時間只存本機。
  - 雲朵圖示在齒輪左邊。
  - 錯誤文字見第 6 節。
- **同步中登出**：之後不再寫入本機或 Drive（T5 review 修正）。見第 6 節。

### 4.3 接受的 Developer 選擇

- **P4-T1**：
  - 平手比較用鍵排序的 JSON；清空的 key 平手時視同刪除。
  - 非字串或時間無法解析的設定視為沒有；只同步兩個設定。
  - 時間解析後比較。
  - 保留名稱（auto、自動判斷、日文、英文）不同步。
  - 同一邊重複的資料用同樣規則決定。
  - 合併結果本機的排前面。
  - Drive 沒有檔案時要上傳。
  - 回傳的資料都是複本。
- **P4-T2**：
  - 修改時間不出現在 `loadSettings()`。
  - 語言增刪前先讀一次，真的有變動才通知。
  - 同步寫入語言清單時，會去掉格式錯誤或保留名稱的項目（畫面本來就不顯示它們）。
- **P4-T3**：
  - 背景續期用 `prompt: 'none'`，互動登入用 `''`。
  - 登入狀態存成單一本機紀錄，不出現在 `loadSettings()`。
  - 需要重新登入時也可以登出；登出失敗顯示「無法登出，請重新整理頁面後再試一次。」。
  - token 存 IndexedDB 直到過期（約 1 小時）。
  - 背景續期與點擊登入不共用請求；有登出發生時，進行中的請求結果作廢。
- **P4-T5**：
  - 狀態包含是否登入。
  - Drive 拒絕 token 時先背景重試一次。
  - `notFound` 與未知錯誤用一般失敗文字；網路與離線用同一段文字。
  - 第一次同步前不顯示「上次同步」。
  - 設定頁也顯示雲朵；說明頁不顯示。
  - 使用者正在輸入 key 時，同步來的 key 不覆蓋輸入框。
  - 下載時檔案已被刪除就略過；取得鎖失敗視為 `other`。
  - `invalidateGoogleToken` 只清掉被拒絕的那個 token。

### 4.4 與 Phase 1～3 不同的行為

- **API key 說明**：設定頁與說明頁不再寫「只會存在這個瀏覽器」，改為登入 Google 後也會同步到 Drive 的 App 專屬資料夾。
- **寫入 key 與模型**：每次都會多寫一筆修改時間（不顯示）。
- **頂部列**：登入後多一個雲朵圖示（齒輪左邊）。
- **主畫面、設定頁的語言清單、API key、模型**：同步帶來新資料時會自動重新讀取。日記頁不會（見 7.1）。
- **硬刪除**：Phase 1 起日記一律軟刪除；現在同步時會從本機與 Drive 硬刪超過 90 天的刪除記號（spec 第 6 節的規定）。
- **對外連線**：除了 Gemini，現在還會連到 `accounts.google.com`（打開設定頁的同步區塊時、登入、續期、登出）與 `www.googleapis.com`（登入後同步）。

---

## 5. Tester 驗收測試結果

| 項目 | 結果 |
|---|---|
| spec 8.4 驗收條件 1～12 | 全部通過（`e2e/acceptance-phase4.spec.js`、`sync.spec.js`、`sync-two-devices.spec.js`、`google-signin.spec.js`） |
| spec 8.1～8.3 回歸測試 | 通過 |
| 單元測試 `npm test` | 1186 passed；P4-T5b 之後連續 10 次穩定 |
| E2E 開發伺服器 `npm run test:e2e` | 289 passed、8 skipped（skip 為只對正式 build 有意義的 `deploy.spec.js`）；連續 4 次穩定 |
| E2E 正式 build `npm run test:e2e:prod` | 297 passed |
| E2E `CI=1` | 297 passed |

E2E 不會真的連到 Google：GIS 換成 stub，Drive 換成記憶體中的假 Drive（檢查 Bearer token、分頁、建立時間、各種失敗）。全域防護會擋下並判定失敗任何未模擬的外部請求。真正的 Google 登入行為只能靠下方第 7.3 節的實機確認。

---

## 6. 使用者確認的事項（Planner 決定）

以下各項已於 2026-10-19 經使用者確認，並寫入 `docs/decisions.md` Phase 4：

1. **App 自動選的模型記為 1970 年**：自動選的 Flash 模型不會蓋掉另一台手動選的模型；只有使用者手動選擇才記現在時間。
2. **同步錯誤文字**：
   - 離線／網路：「無法連線到 Google Drive，恢復網路後會自動同步。」
   - 額度或限流：「Google Drive 暫時無法使用，請稍後再試。」
   - 檔案無法讀取：「Google Drive 上的同步資料無法讀取，為避免資料遺失已暫停同步。」
   - 其他：「同步失敗，請稍後再試。」
   - 登入失敗：「無法登入 Google，請再試一次。」
   - 登出失敗：「無法登出，請重新整理頁面後再試一次。」
3. **Drive 上的同步檔無法讀取時暫停同步**：格式錯誤或由較新版本寫入時，本機與 Drive 都不寫入，每次同步都顯示上述訊息，直到檔案可以讀取為止。
4. **打開設定頁的同步區塊時預先載入 Google 登入程式**：沒打開過設定頁的人不會連到 Google；打開的人即使不登入，也會向 `accounts.google.com` 下載一次登入程式。
5. **同步途中登出**：登出後，進行中的同步不再寫入本機或 Drive。
6. （小）登出後撤銷 token、保留所有資料；授權過期時也可直接登出。

---

## 7. 已知問題與待處理事項

### 7.1 已接受的限制

- **兩個瀏覽器同時上傳**：
  - 情況：Drive 不支援條件寫入，兩台裝置剛好同時同步時，後上傳的會蓋掉先上傳的。
  - 影響：被蓋掉的修改仍在那台裝置的本機，下次同步會再上傳，不會遺失；在那之前 Drive 上暫時是舊的。
  - 同一個瀏覽器的多個分頁有 `navigator.locks` 保護，不會發生。
- **Safari 的「立即同步」**：按「立即同步」時若 token 已過期，程式會先讀本機資料再呼叫 Google，彈窗可能不在點擊範圍內而被擋，結果顯示「需要重新登入」（不會默默失敗）。設定頁的「登入 Google」「重新登入」不受影響（已預先載入，點擊時直接呼叫）。
- **日記頁不會因同步重新載入**：開著的日記頁仍顯示舊內容，或顯示一篇已在別台刪除的日記。儲存時依「最後修改的為準」；已刪除的會顯示「這篇日記已被刪除，無法儲存。」。
- **其他分頁**：同一個瀏覽器的其他分頁，畫面與同步狀態要等該分頁自己下一次同步（或重新整理）才更新。
- **同步檔無法讀取時永久暫停**：App 內沒有修復方式；需要更新 App（較新版本寫入時），或到 Google Drive 設定「管理應用程式」刪除本 App 的隱藏資料，再重新同步。
- **token 存在 IndexedDB**：
  - Google 的 access token（只限本 App 的 Drive 資料夾，約 1 小時有效）和 API key 一樣存在瀏覽器。
  - 這屬於 Phase 2 已接受的 `<帳號>.github.io` 同網域風險：同帳號其他 Pages 專案技術上可讀取。
- **Phase 4 之前手動選的模型**：沒有修改時間，記為 1970 年；第一次同步時若另一台是 App 自動選的模型，兩者平手，可能被換成名稱字串較大的模型。只發生在升級後第一次同步，重新選一次即可。
- **登出的極小時間差**：同步在每次寫入前都會確認仍在登入中，但確認與寫入之間仍有極短的空檔；同時在另一個分頁登出時，可能還會完成一次寫入（只是使用者自己的資料寫到自己的資料夾）。
- **背景續期與點擊重新登入的極小時間差**：背景續期失敗後重新讀取狀態再寫「需要重新登入」，若「重新登入」剛好在中間完成，會被標回需要重新登入；下次同步會再提示，不會默默失敗。
- **格式錯誤的單筆資料**：Drive 檔案中格式不正確的日記或語言會被略過，下次上傳後從 Drive 消失（版本不同的檔案整個不會被覆蓋）。
- **時鐘**：比較時間與 90 天清除依賴各裝置時鐘；裝置超過 90 天沒同步時，已刪除的資料可能復活（spec 第 6 節已接受）。

### 7.2 待處理事項

- 第 6 節的項目確認後，補進 `docs/decisions.md`。
- 之後若要讓日記頁或其他分頁即時更新，需另外決定行為（目前依 decisions.md 不提示）。

### 7.3 親自操作時請確認（使用真實 Google 帳號）

1. **第一次登入**：在電腦的 Chrome 與 Safari（含 iPhone Safari）打開設定頁按「登入 Google」，彈窗不被擋，授權畫面只要求 App 專屬的 Drive 資料夾。登入後顯示「已登入」與雲朵圖示。
2. **兩台裝置同步**：
   - 在 A 寫日記、加入語言、設定 API key 與模型；B 登入後都看得到，且 B 可以直接 AI 批改。
   - 在 B 刪除日記與語言，A 同步後也不顯示。
   - 刪除後再加回語言，以最後的動作為準。
3. **約 1 小時後的背景續期**：登入超過 1 小時後修改日記，看雲朵是否變回「已同步」。若改為顯示「Google 登入已過期，請重新登入。」，表示真實環境中背景續期無法進行；這時按「重新登入」應能恢復。
4. **「立即同步」**：手動同步可以完成，狀態與上次同步時間會更新；在 Safari 上 token 過期時的結果（見 7.1）。
5. **離線**：關掉網路後寫日記，雲朵顯示同步失敗；恢復網路後自動補上。
6. **登出**：按「登出」後雲朵消失，本機日記仍在；在 Google 帳戶的「第三方存取權」中，本 App 的存取已被移除或之後不再使用；重新登入後資料照常合併。
7. 用區域網路 IP 從手機連線無法登入（README 已說明），要用正式網址測試手機。

---

## 8. 建議使用者親自閱讀的地方

| 優先 | 檔案 | 原因 |
|---|---|---|
| 1 | `src/lib/syncEngine.js` | 外部服務呼叫（寫入與刪除 Drive 檔案）；多檔合併後刪除其他檔案；無法讀取的檔案不覆蓋；登出後不再寫入；使用 token |
| 2 | `src/storage/db.js` 的 `applySyncResult`、`invalidateGoogleToken`、`getGoogleAuth`／`saveGoogleAuth` | 資料硬刪除（過期記號）與同步寫入本機；token 存放位置 |
| 3 | `src/lib/sync.js` | 合併與清除規則；外部內容（Drive 檔案）的驗證；決定什麼資料會被刪除或保留；`parseSyncFile` 的「不覆蓋 Drive」約定 |
| 4 | `src/lib/googleAuth.js` | 憑證（access token、用戶端 ID）；載入外部腳本；撤銷 token |
| 5 | `src/lib/drive.js` | 外部服務呼叫；token 只放 header；檔案 ID 驗證；外部回應的處理 |
| 6 | `src/storage/connection.js` 的 `updateSettings` | API key 寫入路徑；自動選模型的 1970 年規則 |
| 7 | `src/components/ApiKeySettings.jsx` | 從其他裝置同步來的 API key 的顯示與確認 |
| 8 | `e2e/helpers.js` | 測試如何阻擋真正的 Google 請求（假 Drive、GIS stub、全域防護） |

---

## 9. README 是否需要更新

**已更新，不需再改。** P4-T7（`33fc37c`）已依使用者確認的文字更新 README：
- 簡介加入 Drive 同步。
- 「目前功能（Phase 4）」加入跨裝置同步（同步內容含 API key、同步時機、雲朵圖示、登出不刪資料、同步檔無法讀取時暫停）。
- 移除「之後的 Phase 預計加入」。
- 技術選型改為 Google Drive（`drive.appdata`）並新增 Google 登入。
- 加註 Google 登入只能在已登記的網址使用，以及 OAuth「測試」狀態只限測試使用者。

已確認與目前實作一致。
