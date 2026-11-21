# CyberpunkPink 專案的工作規則（所有 cpp- 子代理開工前先讀）

路徑設定在 .claude/cpp/project.json：specRoot、workDir、coreDirs、featureDirs、dataDirs、uiDirs、testDirs、testFilePatterns。

## 這個環境（2026-11-21 調整）

- 雲端容器，閒置會回收：所有子代理、指令、守門 hook 都裝在 repo 的 `.claude/` 並提交；進度、工單、ADR、不變式、bug 與審查報告都在 repo 的 `dev/` 並提交。**做完的東西一定要 commit 並 push**，否則換容器就沒了。提交由總指揮（主 session）統一做：子代理與測試指令**不要自己 commit 或 push**，除非派工時明說要。
- 總指揮是主 session（不用 `claude --agent cpp-lead` 啟動），照 `.claude/agents/cpp-lead.md` 的分派規則把工作交給各個 cpp- 子代理。
- 程式分兩塊：`engine/`（純 TypeScript，不 import Vue 或任何瀏覽器 API，自己帶 vitest）與 `ui/`（Vue 3＋Pinia＋Vite，第四版的互動介面）。`ui/` 的 store 包住引擎：呼叫引擎的動作、拿回報告、把狀態交給畫面。
- `ui/` 是介面的依據（取代 docs/mockups/，見 docs/art/UI.md 1.1 節）。介面的工作是把 `ui/` 的假資料換成引擎，不是移植 mockups。
- ElondiaRPG 的原始碼唯讀放在 `/home/user/yellow630914/elondiarpg`（不在就 `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/yellow630914/elondiarpg /home/user/yellow630914/elondiarpg`）。只當參考，照 docs/plan/CODESCAN 的分層重寫；亂數、檢定、時間、錢、存檔、回退這類才考慮直接搬（docs/plan/MIGRATION 開頭的說明）。
- 測試檔可以放在 `engine/tests/`，也可以跟著原始檔叫 `*.test.ts`。
- 設計書的檢查：在 repo 根目錄跑 `python3 tools/docs/check.py` 要 0 個問題（只在改 docs/ 時需要）。
- 回報對使用者一律繁體中文；commit 訊息也是。

## 規格

- 設計書在 specRoot。引擎是唯一真相；AI 只交結構化的結果，程式驗證、夾值之後才寫入（GAME_DESIGN 第 3 節）。
- 只讀工單或任務需要的那幾節。不要整本讀。
- 規格與程式不一致時，以規格為準並回報；規格本身有矛盾時停下來回報，不自己裁決。
- 用語以 WORLD 第 7 節為準（竄網、潛入、滲透、委託、流竄 AI……）。

## 分層（CODESCAN 第 3 節）

L0 型別 → L1 純工具 → L2 內容 → L3 狀態核心 → L4 規則核心 → L5 行動核心 → L6 功能 → L7 外殼

- L0～L5 屬於 coreDirs，只有 cpp-architect 能改。
- **L6 的功能之間不直接 import**，只透過 L3～L5 的掛鉤與登錄表互相用到。分層檢查腳本在測試時擋住違規。
- 規則寫在引擎，不寫在元件（CODESCAN 2.8 節）。

## 搬遷批次

照 MIGRATION 第 6 節（M0～M7）與 CODESCAN 第 4 節的順序。進度記在 dev/status.md。

## engine/ 怎麼跑（2026-11-21，M0）

- 都在 `engine/` 底下跑。第一次先 `npm install`。
- `npm test`：主套件（核心、功能、冒煙、分層檢查、種子重播），要全過。`npx tsc --noEmit`：型別檢查，要沒有錯。
- `npm run test:pending`：給下游的驗收測試（`engine/tests/pending/`），工單做完之前照預期失敗。只跑一張的：`npx vitest run --config vitest.pending.config.ts <工單名>`。工單完成後把測試檔搬到 `engine/tests/features/`（資料的搬到 `engine/tests/data/`），它就進主套件。
- 資料夾與層的對照：`.claude/cpp/project.json` 的 `layers`。功能寫在 `engine/src/features/<功能>/`，做完在 `engine/src/features/index.ts` 的 `FEATURES` 加一行。
- 功能只從 `engine/src/core`（寫成 `'../../core'`）import；測試可以另外 import `engine/src/testkit`（狀態工廠 `makeState`、`makeGame`，不變式檢查 `observed`）。
- 介面的驗收測試在 `ui/tests/pending/`，跑法：在 `ui/` 跑 `npx vitest run --config vitest.pending.config.ts`。

## 工作檔案（都在 repo 的 dev/，要提交）

| 東西 | 位置 | 誰寫 |
|---|---|---|
| 進度 | dev/status.md | cpp-lead |
| 工單 | dev/work/<批次>-<功能>.md | cpp-architect |
| 架構決定 | dev/adr/NNNN-<題目>.md | cpp-architect |
| 不變式 | dev/invariants.md | cpp-architect 維護，測試層引用 |
| 測試基礎建設規格 | dev/test-harness.md | cpp-architect 照它實作 |
| bug 報告 | dev/bugs/<日期>-<id>.md | 測試層 |
| 審查報告 | dev/reviews/<日期>-<批次>.md | cpp-reviewer |
| 探針紀錄 | dev/probes/<系統>-<日期>.md | cpp-tester-probe |

程式碼、測試、資料檔寫在 engine/ 與 ui/。

## 工單格式

```
# <批次>-<功能>
- 交給：cpp-feature / cpp-data / cpp-ui
- 目標：一句話
- 規格出處：<文件> 第 X 節、<文件> 第 Y 節
- 可以改的路徑：
- 可以用的介面：登錄表、掛鉤、型別（附檔案路徑）
- 不可以做的事：
- 驗收測試：已經寫好的測試路徑；必須全部通過
- 完成時回報：改了哪些檔、測試結果、遇到的規格問題
```

## bug 報告格式

```
# <id>：一句話描述
- 發現者：cpp-tester-xxx
- 嚴重度：阻斷 / 錯誤 / 小問題
- 規格出處：<文件> 第 X 節（期望的行為）
- 實際行為：
- 重現：engine/tests/fixtures/repro/<id>.json（種子＋輸入＋期望），以及會失敗的測試路徑
- 可能的位置：檔案與函式（只寫推測，不改）
```

## 回報

用繁體中文。先講結論（過或不過、做完或卡住），再列細節。
