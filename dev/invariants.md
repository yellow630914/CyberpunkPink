# 不變式（cpp-architect 維護）

每一條都要能寫成斷言。測試層的每一種測試都要檢查相關的幾條。出處是設計書的文件與節。
「哪裡驗」寫的是現在已經有的測試（路徑相對於 `engine/`）；寫「之後」的是對應的系統還沒搬進來，到那個批次補。

用探針檢查的那幾條有現成的工具：`src/testkit/invariants.ts` 的 `observed(game, fn)` 會回傳違規的清單（第 2、12 條），四種測試都可以包一層。

## 狀態與報告

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 1 | 遊戲狀態只經由提交報告（`commitReport`）改變；任何功能、任何掛鉤都不直接寫狀態 | GAME_DESIGN 3 第 1、3 條；CODESCAN 0 | `tests/core/commit.test.ts`（嚴格模式抓掛鉤偷改）；`tests/core/chain.test.ts`（鏈跑到一半狀態沒變） |
| 2 | 每一個動作產生一份報告；提交後的狀態＝`applyReport(提交前的狀態, 報告)`（套 `changes`、把報告記進紀錄、流水號加一，沒有別的） | GAME_DESIGN 3 第 3 條；dev/adr/0003 | `commitViolations`；`tests/core/commit.test.ts` 的性質測試；冒煙全程 |
| 3 | 提交是原子的：有一筆變更不合法，整份報告不套，狀態完全不變 | GAME_DESIGN 3 第 13 條 | `tests/core/commit.test.ts` |
| 4 | 回退到任一快照之後，狀態和當時完全相同（亂數狀態也一樣） | AI_TASKS 2.4 | `tests/core/save.test.ts`「回退」；冒煙 |
| 5 | 同一個種子、同一串輸入，得到同一個結果；擲骰不改狀態；重試別的步驟不重擲，只有「重擲」換骰，而且每次重擲都留紀錄 | AI_TASKS 2.4 | `tests/smoke/m0.test.ts`；`tests/core/chain.test.ts`「重試」「重擲」；`tests/repro/replay.test.ts`（每一份跑兩次） |
| 6 | 存檔再讀檔，狀態一模一樣；讀不進來的存檔不改變現在的狀態 | MIGRATION「敘事、狀態與介面」 | `tests/core/save.test.ts`；冒煙 |
| 7 | 時間只往前走；兩種錢都不會變成負數；三條軌與餘韻不會低於 0；基本功等級在 0～6 | CORE_RULES 2、4；LIFE 1.1 | `tests/core/commit.test.ts`（性質測試） |

## 分層

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 8 | 下層不 import 上層；L6 的功能之間沒有直接 import | CODESCAN 3 | `tests/core/layers.test.ts` |
| 9 | 引擎不 import vue、pinia 或任何套件，不碰瀏覽器的全域物件；正式的程式不 import 測試基礎建設 | dev/status.md 2026-11-21 的決定 | `tests/core/layers.test.ts` |
| 10 | 元件裡沒有規則判斷 | CODESCAN 2.8 | 沒有自動檢查，靠審查。已知的一處：`ui/src/screens/MainScreen.vue` 的 `freeAction()` 自己擲骰、定 DC（M0-ui-engine 要搬走） |

## 格式與內容底線（不論任何設定）

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 11 | 格式錯誤一律擋下：欄位不對、id 重複、引用不存在的東西。壞的一批內容整批不收 | GAME_DESIGN 3 第 13 條 | `tests/core/content.test.ts`；`tests/core/effects.test.ts` |
| 12 | 所有角色 18 歲以上：低於 18 的角色寫不進狀態；存檔裡任何深度有低於 18 的年齡，整筆拒絕、不自動改；生成的 NPC 年齡 ≥ 18 | AI_TASKS 3.19；PROMPTS H5；UI 14 | `tests/core/commit.test.ts`；`tests/core/save.test.ts`。NPC 的生成：之後（M2） |
| 13 | 效果只能是封閉清單（登錄表裡註冊過的種類）；清單以外的是格式錯誤 | EVENTS 2.4 | `tests/core/effects.test.ts` |

## AI

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 14 | AI 關閉時遊戲完整可玩：每一條任務鏈都能只靠退路跑完 | GAME_DESIGN 3 第 4 條；AI_TASKS 9 第 1 步 | `tests/core/chain.test.ts`「AI 關閉」；冒煙（全程 AI 關閉） |
| 15 | AI 交出的每一份結果都經過驗證；驗證不過的不會寫入狀態 | AI_TASKS 2.5 | `tests/core/chain.test.ts`「對抗模式」（十種壞掉的回應） |
| 16 | 套用永遠是最後一步；套用之前狀態不變；套用只寫驗證過的草稿 | AI_TASKS 1 第 4 條、2.1 | `tests/core/chain.test.ts`「鏈跑到一半」；模板的格式檢查 |
| 17 | 夾值發生在寫正文之前；寫正文收到的 `<results>` 是夾過的值 | AI_TASKS 1 第 13 條、2.2 | `tests/core/chain.test.ts`「夾值發生在寫正文之前」 |
| 18 | 寫正文與它之後的步驟（潤色、對照）不交出新的數值；`<covered>` 少了只標記號，不算失敗、不重試、不改結果 | AI_TASKS 2.2、4.1 | `tests/core/chain.test.ts`「對照」「潤色」 |
| 19 | 「玩家要求的結果也夾值」開著（預設）時，玩家要求的結果照上限夾；關著時，只有附 `asked` 而且那段字真的出現在玩家這一回合的輸入裡的那幾筆免夾；AI 自己生成的一律夾；內建的內容不夾 | AI_TASKS 2.5；GAME_DESIGN 3 第 13 條 | `tests/core/effects.test.ts`；`tests/core/action.test.ts`；`tests/core/chain.test.ts` |
| 20 | 被夾值不算失敗，但留記號、列出原本的值與夾過的值，報告卡有一行白話的提醒（不出現欄位名稱） | AI_TASKS 2.5 | `tests/core/effects.test.ts`；`tests/core/chain.test.ts` |
| 21 | 同時跑的 AI 請求不超過 3 個 | AI_TASKS 2.2、8 | `tests/core/chain.test.ts`「同時跑」；`observed` |
| 22 | 自動重試時只帶上一次的錯誤（`<previous_error>`），不帶上一次的整份輸出；被拒絕與取消的不自動重試 | AI_TASKS 5.3、2.6 | `tests/core/chain.test.ts` |
| 23 | 重試一步：這一步與所有依賴它的後面幾步重跑；沒有依賴它的保留結果 | AI_TASKS 2.4 | `tests/core/chain.test.ts`「重試一步」 |
| 24 | 任務鏈的細節只保留最近五樓；回退刪掉一樓時，它的任務鏈一起刪掉 | AI_TASKS 5.5 | `tests/core/commit.test.ts`；`tests/core/chain.test.ts` |
| 25 | Agent 支線不擋主鏈，只新增、不修改已經發生的事 | AI_TASKS 6.1 | 之後（Agent 模式） |

## 數值的邊界（邊界測試從各規格補齊）

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 26 | 檢定：1d20 + mod(屬性) + 基本功等級 + 情境；超過 DC 5 以上或自然 20 大成功，低於 DC 5 以上或自然 1 大失敗；成功差距不到 3 是「是，但是」 | CORE_RULES 3 | `tests/core/check.test.ts` |
| 27 | DC 的階梯是 10、13、16、19、22、25；難度的偏移預設 −2～+2、自訂 −4～+4 | CORE_RULES 3；BALANCE 7.2 | `tests/core/check.test.ts` |
| 28 | judge 的 DC 在參考值 ±3、時間在行動種類的上限內、成功程度照骰值（設定開著時；關著時只有 `asked` 對得上的免） | AI_TASKS 4.1 | `tests/core/action.test.ts`（性質測試） |
| 29 | AI 自己給的錢（`cred`、`cash`）每件不超過這一區等級的上限：I 120、II 360、III 1,200、IV 3,900、V 12,000 | EVENTS 2.4 | `tests/core/effects.test.ts`（性質測試） |
| 30 | 有效屬性在 1～24 | CORE_RULES 1 | `tests/core/check.test.ts` |
| 31 | AI 自己給的沉溺變化一件 ±3；`hp` 不會讓人倒下、`load` 不會讓人過載 | EVENTS 2.4 | `tests/pending/M0-character.test.ts`（M0-character 完成後） |
| 32 | 建角：屬性用 15、14、13、12、10、8 各一次加 2 點自由點數，單項 4～18；基本功 10 點、單項最高 3；特質點 4、特質最多 8、缺陷最多 2 | CHARACTER 5 | `tests/pending/M0-creation.test.ts`（M0-creation 完成後） |
| 33 | 成人場景每場沉溺變化在 −4～+4 | AI_TASKS 4.2 | 之後（M2） |
| 34 | 一件委託的隊伍最多 4 人含主角、另外最多 2 位同行 | GAME_DESIGN 7 | 之後（M2） |
| 35 | scene_talk 的契合變化在 −5～+10，目的進度一次最多 +20 | AI_TASKS 4.2 | 之後（M2） |
