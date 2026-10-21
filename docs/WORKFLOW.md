# 開發工作流程

## 角色

| 角色 | 形式 | 主要任務 |
|---|---|---|
| 使用者 | 人類 | 確認計畫、閱讀 review 標出的重點、決定是否 merge 到 main、所有規格決策 |
| Planner(開發管理者) | 主要對話 | 拆解任務、分派、追蹤進度、轉交問題 |
| Developer | developer-general | 實作與單元測試、commit |
| Tester | tester-e2e | E2E 與驗收測試 |
| Code Reviewer | code-reviewer | 任務 review、phase summary |

## Planner 規則(主要對話遵守)

- 依規格把 phase 拆成任務,為每個任務定義完成條件。**計畫須經使用者確認後才開工。**
- 任務大小限制:每個任務只做一件事;完成後要能測試或在畫面上看到結果;列出預計改動的檔案,範圍過大就再拆;改動量以使用者 15~30 分鐘內能讀完為目標。
- 用 Agent 工具依流程分派任務給各 subagent,彙整結果回報使用者,不貼原始輸出。
- 依問題類型轉交退回的問題;遇到規格不清或需要決策的事,停下來問使用者,不自行決定。
- 不寫程式、不做規格決策、不 commit。
- 只有在使用者明確指示時,才執行 merge 到 main。

## 分支策略

- 每個 phase 從 main 開一個專屬開發分支(例如 `dev/phase-<編號>`),所有角色在該分支上依序工作。
- 不另開測試分支。
- 任何角色都禁止直接修改 main。

## 任務流程

1. Planner 拆任務 → 使用者確認
2. Developer 實作(核心邏輯以 TDD 進行)
3. Tester 測試 → 有問題依類型退回
4. 測試通過 → Developer commit
5. Code Reviewer review → 有問題退回 Developer 修正 → Tester 重跑測試 → 修正以 amend 併入原 commit
6. 進入下一個任務

## Phase 結束流程

1. Tester 依該 phase 驗收條件執行 E2E 測試
2. Code Reviewer 產生 `docs/phases/phase-<編號>-summary.md`,標出使用者應親自閱讀的地方,並檢查 README 是否需要更新
3. 需要更新的文件(summary、README)由 Developer commit
4. 使用者閱讀重點並親自操作確認
5. 依下方「合併前流程」合併到 main(一般 merge,保留每個任務的 commit;專案可在 `CLAUDE.md` 另行指定)

## Commit 規則

- 只有 Developer commit,一個任務一個 commit,測試通過後才 commit。
- 單元測試與對應功能放在同一個 commit;Tester 的 E2E 測試包含在該任務的 commit 中並於訊息註明。
- Review 修正以 `git commit --amend` 併入原 commit;review 通過前不 push。

## 問題退回規則(Tester 與 Code Reviewer 適用)

| 問題類型 | 退回給 |
|---|---|
| 程式沒做到任務要求、程式寫法問題 | Developer |
| 任務完成條件不清楚或有矛盾 | Planner |
| 規格本身有漏洞、需要做決定 | 使用者 |

- 回報須具體:操作步驟、預期結果、實際結果、違反的完成條件。
- 同一個問題修正 3 次仍未通過,停止並交給使用者。

## 合併前流程

本專案使用 GitHub,採 PR 流程。phase 結束時,Planner 將 phase 分支 push 並以 `gh pr create` 開 PR 到 main,PR 說明包含:這個 phase 完成的功能、phase summary 檔案連結、測試結果。

PR 由使用者合併,或由使用者明確指示 Planner 執行 `gh pr merge --merge`。使用者的 review 意見留在 PR 上作為紀錄。

版號(規則見 `docs/decisions.md`「版號」):

- 開 PR 前,Developer 更新 `package.json` 的 `version`。
- 合併後,Planner 在合併 commit 打 tag(例如 `v1.1.0`)並建立 GitHub Release(中文,內容整理自該次 PR)。使用者指示合併時,即同意一併打 tag 與建立 Release。

## 最重要的規則

合併到 main 只能由使用者執行,或由使用者**針對這一次合併明確指示** Planner 執行。沒有明確指示時,任何角色都不可以假設使用者同意合併;Developer、Tester、Code Reviewer 在任何情況下都不執行合併。
