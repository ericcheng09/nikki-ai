# 外語學習日記 App

讓外語學習者寫外語日記，並用 AI（Gemini）批改。純前端網頁應用，部署在 GitHub Pages。

## 規格

- 正式規格：@docs/spec.md 。開發一律以它為準。
- 規格沒寫到、或規格之間有矛盾時，停下來詢問使用者，不要自行決定或假設。
- `notes/` 是使用者的私人筆記，不是規格，開發時不要參考。

## 目前進度

- 以目前所在的分支（`dev/phase-<編號>`）判斷正在進行的 phase。
- 已完成的 phase 以 `docs/phases/` 中的 summary 為準。
- 在 `main` 上或無法判斷時，先詢問使用者，不要自行開始任何 phase。

## 技術棧

React、Vite、npm、IndexedDB、Vitest（單元測試）、Playwright（E2E 測試）、GitHub Actions + GitHub Pages。

## 常用指令

<!-- 專案建立後，由 Developer 依實際設定更新 -->
- 開發伺服器：`npm run dev`
- 單元測試：`npm test`
- E2E 測試：`npm run test:e2e`
- 建置：`npm run build`
- 預覽正式版：`npm run preview`

## 必須遵守的規則

- **不建立任何後端服務**，所有功能在瀏覽器內完成。
- **AI 批改結果不得寫回或覆蓋使用者的日記原文。**
- **AI 回傳內容不得以原始 HTML 渲染**，不使用 `dangerouslySetInnerHTML`。
- **不得 commit 任何 API key 或金鑰**，這是公開 repo。API key 不得送往 Gemini API 以外的地方，也不得寫入 log。
- 刪除日記一律採軟刪除（規格第 4、6 節），從 Phase 1 開始就要遵守。
- 規格第 7 節列出的核心邏輯以 TDD 進行。
- E2E 測試中的 AI 回應一律使用模擬資料，不實際呼叫 Gemini API。
- App 介面文字使用中文；程式碼註解使用英文。
- 規格第 8.5 節的 Phase 4 前置作業由使用者處理，不要自行處理或假設結果。

<!-- standard-dev-team:start -->
## 開發團隊

- 主要對話擔任 Planner(開發管理者),須遵守 @docs/WORKFLOW.md 中的 Planner 規則與全部流程規則。
- 可分派的 subagent:developer-general、tester-e2e、code-reviewer
- 合併到 main 只能由使用者執行,或由使用者明確指示 Planner 執行。
<!-- standard-dev-team:end -->
