# CyberpunkPink 專案的工作規則（所有 cpp- 子代理開工前先讀）

路徑設定在 .claude/cpp/project.json：specRoot、workDir、coreDirs、featureDirs、dataDirs、uiDirs、testDirs、testFilePatterns。

## 這個環境（2026-11-21 調整）

- 雲端容器，閒置會回收：所有子代理、指令、守門 hook 都裝在 repo 的 `.claude/` 並提交；進度、工單、ADR、不變式、bug 與審查報告都在 repo 的 `dev/` 並提交。**做完的東西一定要 commit 並 push**，否則換容器就沒了。提交由總指揮（主 session）統一做：子代理與測試指令**不要自己 commit 或 push**，除非派工時明說要。
- 內容資料一律用測試自帶的最小假資料；`engine/data/` 裡的內容類是暫定示意資料，不再匯入新內容，正式內容等潤色後經世界編輯器匯入（docs/plan/PLAN.md 第 1 節）。規則表照常。
- 額度（2026-11-22）：cpp-architect（fable、xhigh）只做設計——新的掛點與格式、ADR、拆工單；照說明改程式的修正一律派 cpp-feature／cpp-ui（sonnet）。改文件派 general-purpose 時指定 sonnet。同時最多兩個子代理。
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
- `npm test`：主套件（核心、功能、冒煙、分層檢查、種子重播），收尾時要全過（什麼時候跑見下面「測試準則」）。`npx tsc --noEmit`：型別檢查，要沒有錯。
- `npm run test:pending`：給下游的驗收測試（`engine/tests/pending/`），工單做完之前照預期失敗。只跑一張的：`npx vitest run --config vitest.pending.config.ts <工單名>`。工單完成後把測試檔搬到 `engine/tests/features/`（資料的搬到 `engine/tests/data/`），它就進主套件。
- 資料夾與層的對照：`.claude/cpp/project.json` 的 `layers`。功能寫在 `engine/src/features/<功能>/`，做完在 `engine/src/features/index.ts` 的 `FEATURES` 加一行。
- 功能只從 `engine/src/core`（寫成 `'../../core'`）import；測試可以另外 import `engine/src/testkit`（狀態工廠 `makeState`、`makeGame`，不變式檢查 `observed`）。
- 介面的驗收測試在 `ui/tests/pending/`，跑法：在 `ui/` 跑 `npx vitest run --config vitest.pending.config.ts`。

## 測試準則（使用者 2026-11-27）

- **步驟之間不跑全套把關**：總指揮不在步驟之間跑全套測試，下一步不必等上一步全綠。
- **每張工單**：做的代理照舊跑自己工單的測試與 `npx tsc --noEmit`（介面的跑自己的測試與 `vue-tsc`）。回報的紅燈只記下來、不擋進度。
- **記紅燈**：每張工單提交時，在提交訊息或 dev/status.md 記一句代理回報的紅燈（例：「紅 2：xxx 測試，疑似 yyy 造成」；沒有就寫「紅 0」）。不為此花額外的測試時間，收尾時好回頭找。
- **全套集中在每個 M 級的收尾**（engine 的 `npm test`、`npm run test:smoke`，ui 的 `npm test`），順序：冒煙 → 審查 → 修正批 → 白箱、邊界、探針。

## 戰鬥與格子地圖（2026-11-22，M1）

- 戰鬥的引擎在核心（`engine/src/core/battle/`，現實與內海共用；dev/adr/0010、0011），格子地圖也在核心（`engine/src/core/grid/`；dev/adr/0012）。功能不寫引擎，只往登錄表註冊：`k.battle`（行動、掛點、修正、結束時的變更、誰上場、帶進戰鬥的裝備、道具的效果）與 `k.grid`（站上標記、走進一格、放行、這一格能做的事）。
- 功能改戰鬥狀態只用 `BattleRun` 的基本動作；行動的條件與目標（`blocks`、`targets`）只讀。灰掉的原因寫成給玩家看的完整句子，一條一個條件。
- 測試：`engine/src/testkit` 有具名的情境（`BATTLE_SETUPS`）、`makeBattleGame`、`playOut`、`fixDice` 與一組最小的行動 `TEST_COMBAT`（dev/test-harness.md 第 1 節）。
- 設計書沒寫或兩處對不上而先定的東西集中在 dev/adr/0013；工單裡引用它的地方，做的時候看到設計書有相反的寫法就停下來回報。
- 註冊一個戰鬥行動時要寫齊的（dev/adr/0014）：`icon`（圖示的鍵）；`run` 會讀的每一個 `input.pick` 的鍵都要在 `picks` 宣告（選項、選不了的原因、對哪些目標適用），畫面才送得出來；用手上的武器攻擊一次的行動加 `tags: ['weapon_attack']`。花費的減免做成 `action_ap` 的修正，「用掉幾次」在 `action.done` 掛點記，不要改武器或別人的行動。在掛點裡替單位做一個行動用 `performAction`。
- 戰鬥中、或打輸之後還在等玩家三選一時，`Game.commit` 不收別的報告（丟 `ActionBlocked`，`Game.blockOf` 可以先問）；戰敗「接受結果」的報告要帶 `{ op: 'snapshot.drop', kind: 'battle' }`。

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

## 設計書成品同步（使用者 2026-11-24）

使用者只看設計書成品（https://claude.ai/artifact/BHwtMYmiWEydrSVzSur4pg）。**每次提交 docs/ 的修改之後，總指揮都要重建並發布成品**：`python3 tools/book/build.py --artifact <scratchpad>/artifact/design-book.html`，再用 Artifact publish 同一個 url（files 帶 content-catalog、content-events、content-quests 三個 html）。回報時寫上新的版本號。
- 事件的版本與主被動（使用者 2026-11-27）：版本 default／masc／yuri 只管對象與寫法，不管主被動；主被動照 LEWD_SYSTEM 第 2 節的開場主動權公式，由 adult_scene 的 nature、role、start_position 推出；性交易付錢的一方主導；男主角不額外扣主動權；戰敗主線被動、玩家自選的誘惑交易分支照公式；公式算不出來的特例寫成兩個選項。之後新增或匯入的事件、任務、委託、戰敗事件都照這條（不加 initiative 欄位）。
