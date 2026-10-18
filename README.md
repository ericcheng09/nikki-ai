# 外語學習日記

讓外語學習者用外語寫日記，並用 AI（Gemini）批改：找出文法錯誤、不通順的句子，推薦更道地的說法。

- 純前端網頁應用，沒有後端服務。
- 日記存在你的瀏覽器（IndexedDB）裡；只有在你按「AI 批改」時，那篇日記的內容才會送到 Google Gemini。

## 目前功能（Phase 2）

- 新增、編輯、刪除日記：選擇日期（預設今天，最晚只能選到今天），用任何外語輸入純文字內容；一天可以寫好幾篇。
- 日記列表依日期排序，日期新的在上；同一天內，後寫的在上。
- 刪除前會先確認。刪除採軟刪除，內文會立即清除。
- 第一次開啟時顯示使用說明頁，用一篇範例日記示範 AI 批改結果的樣子。之後可從主畫面右上角的「選單」→「使用說明」重新打開。
- 日記語言：自動判斷（預設）、日文、英文，或選「其他」自行輸入；自行輸入過的語言會加入語言清單，之後可直接選擇。
- AI 批改：在日記頁按「AI 批改」，顯示文法錯誤、不通順的句子、更道地的說法、修改後全文（修改處粗體）與中文翻譯。批改結果會儲存，不會修改日記原文；寬螢幕左右並排，手機上下排列。
- 設定頁（主畫面右上角「選單」→「設定」）：輸入、修改、刪除自己的 Gemini API key（附申請說明）；選擇 Gemini 模型（預設自動選一個 Flash 模型）；刪除語言清單中的語言。

之後的 Phase 預計加入：

- 日曆（Phase 3）。
- Google Drive 跨裝置同步（Phase 4）。

## 部署網址

https://ericcheng09.github.io/nikki-ai/

`main` 分支更新後，GitHub Actions 會自動執行單元測試、build 與 E2E 測試；全部通過才部署到 GitHub Pages。

repo 的 Pages 來源需設定為「GitHub Actions」，這是一次性的設定。

## 技術選型

| 項目 | 選擇 |
|---|---|
| 前端框架 | React |
| 建置工具 | Vite |
| 套件管理 | npm |
| 本機儲存 | IndexedDB |
| 單元測試 | Vitest |
| E2E 測試 | Playwright |
| 部署 | GitHub Actions + GitHub Pages |
| AI | Gemini API（Phase 2 起，使用者自備 API key） |
| 跨裝置同步 | Google Drive（Phase 4 起） |

## 本機安裝與執行

需要 Node.js 22。

```bash
npm ci            # 安裝套件
npm run dev       # 開發伺服器：http://localhost:5173/nikki-ai/
npm run build     # 建置正式版到 dist/（含給 GitHub Pages 用的 404.html）
npm run preview   # 預覽正式版：http://localhost:4173/nikki-ai/
```

> 注意：如果用 `npm run dev -- --host` 讓手機透過區網 IP（例如 `http://192.168.x.x:5173/nikki-ai/`）連線，瀏覽器的安全限制會讓新增日記失敗，請用 `localhost` 開啟。正式網址是 HTTPS，不受影響。

## 測試

第一次執行 E2E 測試前，先安裝 Playwright 使用的瀏覽器：

```bash
npx playwright install chromium
```

| 指令 | 說明 |
|---|---|
| `npm test` | 單元測試（Vitest），固定在 `Asia/Taipei` 時區執行 |
| `npm run test:e2e` | E2E 測試，對開發伺服器執行（port 5199）；部署專用的測試會略過 |
| `npm run test:e2e:prod` | 先 build，再對模擬 GitHub Pages 的本機伺服器執行完整 E2E 測試 |

## 文件

- [docs/spec.md](docs/spec.md)：正式規格
- [docs/decisions.md](docs/decisions.md)：開發過程中確定的細節決定
