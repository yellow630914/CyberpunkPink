# 不變式（cpp-architect 維護）

每一條都要能寫成斷言。測試層的每一種測試都要檢查相關的幾條。出處是設計書的文件與節。
「哪裡驗」寫的是現在已經有的測試（路徑相對於 `engine/`）；寫「之後」的是對應的系統還沒搬進來，到那個批次補。

用探針檢查的那幾條有現成的工具：`src/testkit/invariants.ts` 的 `observed(game, fn)` 會回傳違規的清單（第 2、21 條），四種測試都可以包一層。
已經修好的 bug 的重現放在 `tests/fixtures/repro/`（種子重播每次重播）、`tests/boundary/fixed-bugs.boundary.test.ts`、`tests/whitebox/bugs.whitebox.test.ts`。

M0 的修正批次（2026-11-22）之後照定案改了第 1、3、4、6、7、10、12、16、19、29、31 條，加了第 36～43 條。
M1 開工（2026-11-22）照定案改了第 29、36、43 條（錢分開夾、物品每一種 100 個、性別五個值），第 4、6 條補上戰鬥，加了第 44～58 條（戰鬥、格子地圖、快照、內容篩選與版本）。
M1 第一波之後的核心修正（2026-11-22；dev/adr/0014、審查 M1a）改了第 45、46、48、57 條，加了第 59～61 條（等著選的戰敗、花費與行動做完的掛點、開不起來的戰與壞掉的戰鬥存檔）。
M1 第二波的核心（2026-11-22；dev/adr/0015）加了第 62 條（效果的 op 都查得到）。第二波收尾（M1b-core-closeout）改了第 64 條，加了第 66～69 條。第二波的核心小修（M1b-core-fix2、fix3）加了第 70～77 條。

## 狀態與報告

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 1 | 遊戲狀態只經由提交報告（`commitReport`）改變；任何功能、任何掛鉤（`report.before`、`report.after`、`time.passed`、`turn.end`）都不直接寫狀態。整份換掉狀態的只有回退、讀檔、開新局、回到快照 | GAME_DESIGN 3 第 1、3 條；CODESCAN 0 | `tests/core/commit.test.ts`（嚴格模式抓掛鉤偷改，含 `turn.end`）；`tests/core/chain.test.ts`（鏈跑到一半狀態沒變）；`tests/whitebox/bugs.whitebox.test.ts` W002 |
| 2 | 每一個動作產生一份報告；提交後的狀態＝`applyReport(提交前的狀態, 報告)`（套 `changes`、把報告記進紀錄、流水號加一，沒有別的） | GAME_DESIGN 3 第 3 條；dev/adr/0003 | `commitViolations`；`tests/core/commit.test.ts` 的性質測試；冒煙全程 |
| 3 | 提交是原子的：有一筆變更不合法，整份報告不套，狀態完全不變。整個回合是一件事：掛鉤接著提交的報告（含 `turn.end` 的）不合法，原本那一份也不留；不成立的動作不通知、不改能回退的步數 | GAME_DESIGN 3 第 13 條；dev/adr/0008 | `tests/core/commit.test.ts`「整串是一件事」；`tests/core/game.test.ts`；`tests/whitebox/bugs.whitebox.test.ts` W001；`tests/boundary/undo-retry.boundary.test.ts` B003 |
| 4 | 回退到任一快照之後，狀態和當時完全相同（亂數狀態也一樣）。回退最多 5 步；步數不是正整數回 false、什麼都不動；失敗或被擋下的動作不佔步數；併進最新一樓的提交不另留步數。開戰留一步，戰鬥裡的每一步不另留：戰鬥中回退就回到開打之前 | AI_TASKS 2.4、5.5；GAME_DESIGN 9；dev/adr/0011 | `tests/core/save.test.ts`「回退」；`tests/boundary/undo-retry.boundary.test.ts`；`tests/core/game.test.ts`；`tests/core/battle-flow.test.ts`「開打是一份報告」；冒煙 |
| 5 | 同一個種子、同一串輸入，得到同一個結果；擲骰不改狀態；重試別的步驟不重擲，只有「重擲」換骰，而且每次重擲都留紀錄 | AI_TASKS 2.4 | `tests/smoke/m0.test.ts`；`tests/core/chain.test.ts`「重試」「重擲」；`tests/repro/replay.test.ts`（每一份跑兩次） |
| 6 | 存檔再讀檔，狀態一模一樣；讀不進來的存檔（含讀檔修復失敗的）不改變現在的狀態、回退與進行中的鏈。提交得進去的狀態一定存得下去、讀得回來（戰鬥打到一半也一樣：讀回來接著打，和沒有存讀檔的那一場一模一樣）。舊版的存檔照版本一步一步升上來（第 1 版 → 第 2 版），升不上來的整筆拒絕 | MIGRATION「敘事、狀態與介面」 | `tests/core/save.test.ts`（含 `tests/fixtures/saves/v1-m0.json` 的回歸）；`tests/core/battle-flow.test.ts`「存檔再讀檔之後接著打」；`tests/core/game.test.ts`「Game.load」；`tests/whitebox/bugs.whitebox.test.ts` W003、W004、W005；`tests/fixtures/repro/B001-*.json`；冒煙 |
| 7 | 變更只能讓時間往前走（回退、讀檔、回到快照是整份換掉狀態，不算）；兩種錢都不會變成負數；三條軌與餘韻不會低於 0；基本功等級在 0～6 | CORE_RULES 2、4；LIFE 1.1 | `tests/core/commit.test.ts`（性質測試） |

## 分層

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 8 | 下層不 import 上層；L6 的功能之間沒有直接 import | CODESCAN 3 | `tests/core/layers.test.ts` |
| 9 | 引擎不 import vue、pinia 或任何套件，不碰瀏覽器的全域物件；正式的程式不 import 測試基礎建設 | dev/status.md 2026-11-21 的決定 | `tests/core/layers.test.ts` |
| 10 | 元件與 store 裡沒有規則判斷 | CODESCAN 2.8 | 沒有自動檢查，靠審查。`MainScreen.vue` 的 `freeAction()` 已經搬走；審查 E3（建角畫面自己算起始的錢）介面已修。還在介面這一側、等 dev/work/M0-fix-ui.md 換成問引擎的：`ui/src/stores/engine.ts` 的 `creation.attrStepBlock` 與 `limits`、`ui/src/components/ChainBar.vue` 的按鈕條件、`ui/src/stores/game.ts` 的星期與離收租日幾天 |

## 格式與內容底線（不論任何設定）

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 11 | 格式錯誤一律擋下：欄位不對、id 重複、引用不存在的東西。壞的一批內容整批不收 | GAME_DESIGN 3 第 13 條 | `tests/core/content.test.ts`；`tests/core/effects.test.ts` |
| 12 | 所有角色 18 歲以上：報告裡任何深度有低於 18 的年齡，整份不收（和讀檔同一條底線）；存檔裡任何深度有低於 18 的年齡，整筆拒絕、不自動改；生成的 NPC 年齡 ≥ 18 | AI_TASKS 3.19；PROMPTS H5；UI 14 | `tests/core/commit.test.ts`（含 W005）；`tests/core/save.test.ts`。NPC 的生成：之後（M2） |
| 13 | 效果只能是封閉清單（登錄表裡註冊過的種類）；清單以外的是格式錯誤 | EVENTS 2.4 | `tests/core/effects.test.ts` |

## AI

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 14 | AI 關閉時遊戲完整可玩：每一條任務鏈都能只靠退路跑完 | GAME_DESIGN 3 第 4 條；AI_TASKS 9 第 1 步 | `tests/core/chain.test.ts`「AI 關閉」；冒煙（全程 AI 關閉） |
| 15 | AI 交出的每一份結果都經過驗證；驗證不過的不會寫入狀態 | AI_TASKS 2.5 | `tests/core/chain.test.ts`「對抗模式」（十種壞掉的回應） |
| 16 | 套用永遠是最後一步；套用之前狀態不變；套用只寫驗證過的草稿：效果轉出來的變更（連同這次行動其餘的變更）在複製的狀態上驗過，套用不會因為它們失敗 | AI_TASKS 1 第 4 條、2.1；dev/adr/0007 | `tests/core/chain.test.ts`「鏈跑到一半」；`tests/core/effects.test.ts`「套得上去才算」；`tests/boundary/chain-pipeline.boundary.test.ts` B007；模板的格式檢查 |
| 17 | 夾值發生在寫正文之前；寫正文收到的 `<results>` 是夾過的值 | AI_TASKS 1 第 13 條、2.2 | `tests/core/chain.test.ts`「夾值發生在寫正文之前」 |
| 18 | 寫正文與它之後的步驟（潤色、對照）不交出新的數值；`<covered>` 少了只標記號，不算失敗、不重試、不改結果 | AI_TASKS 2.2、4.1 | `tests/core/chain.test.ts`「對照」「潤色」 |
| 19 | 「玩家要求的結果也夾值」開著（預設）時，玩家要求的結果照上限夾；關著時，只有附 `asked` 而且那段字真的出現在玩家這一回合的輸入裡的那幾筆免夾（格式的底線照擋，第 36 條）；AI 自己生成的一律夾；內建的內容照寫的算（唯一的例外是拿到的錢，第 29 條） | AI_TASKS 2.5；EVENTS 2.4；GAME_DESIGN 3 第 13 條 | `tests/core/effects.test.ts`；`tests/core/action.test.ts`；`tests/core/chain.test.ts`；`tests/boundary/ai-tasks-2.5.boundary.test.ts` |
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
| 29 | 錢：帳戶（`cred`）與現金（`cash`）各自一件事合計不超過上限 I 120、II 360、III 1,200、IV 3,900、V 12,000（兩個錢包分開夾，各有一份上限）：AI 給的照主角信譽那一階（無名、熟面孔 I，有號 II，搶手 III，頂尖 IV，傳說 V；還沒有信譽系統時當 I），拿到與失去都算；內建的事件照區或要地的等級，只算拿到的（付出去的價錢、罰款不算）。扣不到的不能拿來抵 | EVENTS 2.4；LIFE 1.3；dev/adr/0007 | `tests/core/effects.test.ts`；`tests/boundary/ai-tasks-2.5.boundary.test.ts`「錢的上限（一件事合計）」（性質測試）；`tests/fixtures/repro/E1-split-hp-below-one.json` |
| 30 | 有效屬性在 1～24 | CORE_RULES 1 | `tests/core/check.test.ts` |
| 31 | AI 自己給的（事件沒有標 `combat` 時）：沉溺一件事合計 ±3；`hp` 扣完最少剩 1；`load` 加完最多到上限 − 1；`afterglow` 一件事最多 +1 層、加完最多到上限 − 1。拆成幾筆給和合成一筆一樣；已經在邊界上時那一筆整筆拿掉並提醒 | EVENTS 2.4；AI_TASKS 2.5 | `tests/features/M0-character.test.ts`；`tests/boundary/ai-tasks-2.5.boundary.test.ts`「hp、load、sink」（性質測試） |
| 32 | 建角：屬性用 15、14、13、12、10、8 各一次加 2 點自由點數，單項 4～18；基本功 10 點、單項最高 3；特質點 4、特質最多 8、缺陷最多 2 | CHARACTER 5 | `tests/features/M0-creation.test.ts`；`tests/boundary/character-creation.boundary.test.ts`；`tests/features/M0-creation-fix.test.ts`（± 按鈕的性質測試） |
| 33 | 成人場景每場沉溺變化在 −4～+4 | AI_TASKS 4.2 | 之後（M2） |
| 34 | 一件委託的隊伍最多 4 人含主角、另外最多 2 位同行 | GAME_DESIGN 7 | 之後（M2） |
| 35 | scene_talk 的契合變化在 −5～+10，目的進度一次最多 +20 | AI_TASKS 4.2 | 之後（M2） |
| 36 | 格式的底線，夾值關著也照擋（只管 AI 交出的結果）：數量是安全整數（不溢位、不是無限或非數），套用之後的值也是；物品一件事每一種最多拿 100 個（不同種各算各的，總數不限）；戰鬥外 `hp` 最少剩 1 | EVENTS 2.4；AI_TASKS 2.5 | `tests/boundary/ai-tasks-2.5.boundary.test.ts`「格式的底線」「每一種物品一次最多 100 個」「hp」；`tests/core/commit.test.ts`「數量一律是安全整數」；`tests/fixtures/repro/B001-*.json`、`B007-*.json` |
| 37 | 一次行動總共花的時間（判定的時間加上結算裡的 `time`）不超過行動種類的時間上限；被夾的提醒照實寫時數 | EVENTS 2.4；AI_TASKS 3.1 | `tests/boundary/chain-pipeline.boundary.test.ts`「行動的總時間」（性質測試）；`tests/boundary/fixed-bugs.boundary.test.ts` B002 |
| 38 | 只有最新一樓可以在套用之後重試、重擲、用規則代替；之後又有別的提交就只能回退。不成立的請求先被拒絕，狀態與鏈都不動 | AI_TASKS 2.4；dev/adr/0008 | `tests/boundary/undo-retry.boundary.test.ts`（B005、審查 E2）；`tests/fixtures/repro/E2-*.json`、`B005-*.json` |
| 39 | 行動的結果分開：`refused`（行動被擋下，附原因，狀態不變、不留回退）、`paused`（鏈停下來等玩家，狀態還沒改）、`applied`、`cancelled` | AI_TASKS 5.1；dev/adr/0008 | `tests/core/game.test.ts`「行動的三種結果」；`ui/tests/pending/M0-fix-ui.test.ts` |
| 40 | 模板：寫正文只要依賴判定，中間就要隔著一個程式的步驟 | AI_TASKS 2.2；dev/adr/0009 | `tests/boundary/chain-pipeline.boundary.test.ts`「隔著程式」；`tests/boundary/fixed-bugs.boundary.test.ts` B006 |
| 41 | 時段：清晨 3～7、上午 7～11、中午 11～15、下午 15～19、黃金時段 19～23、深夜 23～3；深夜跨過午夜的那一段算前一天。第 1 天週二，第 7、14、21 天週一 | CORE_RULES 7.4 | `tests/core/util.test.ts`；`tests/core/conditions.test.ts`；`tests/core/game.test.ts`「clock」 |
| 42 | 回到快照（撤退）：狀態回到那一刻，之後的紀錄留著並標成被收回，報告與鏈的編號不重複 | SERIES 6 | `tests/core/game.test.ts`「Game.rewind」（性質測試） |
| 43 | 建角：起始的錢全部是現金、每個出身一樣；沒花完的義體點數每點 C$500、裝備點數每點 C$150；性別只有五個值（female、male、femboy、trans_f、futa；TS 只有男跨女一種）；內容篩選關掉「身體的私密描寫」時不寫私處 | CHARACTER 1、5.4；DATA 1、8 | `tests/features/M0-creation-fix.test.ts` |

## 戰鬥（現實與內海同一套引擎；dev/adr/0010、0011）

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 44 | 戰鬥狀態（`state.battle`）只經由 `battle` 這一種變更改變；戰鬥的每一步（開打、玩家的一步、AI 的一步、結束）各是一份報告，照常經過提交。行動的條件、畫面的提示、AI 的打分只讀、不擲骰 | GAME_DESIGN 3 第 1、3 條；dev/adr/0011 | `tests/core/battle-flow.test.ts`「戰鬥狀態只經由提交改變」；`tests/probe/battle.probe.test.ts`；`tests/smoke/m1.test.ts`（全程 `commitViolations`） |
| 45 | 一格最多一個單位（和人重疊的東西不算，每一方每格最多一台沒被擊落的；補位時它跟著掛的那一格走，掛在空出來那一格的退到第 4 格）；站位只有第 1～4 格；超過四個的在後方等，有空格才從最後面補上來；前面那一格沒有人也沒有遮蔽時，後面的人連同遮蔽往前遞補 | COMBAT_SYSTEM 2、2.4、9.1 | `tests/core/battle.test.ts`「站位、距離與遮蔽」「後方的增援」；提交時與讀檔時的 `battleProblems`；`tests/core/battle-m1-followups.test.ts`「E2」 |
| 46 | 做不成的一步不改狀態、不留報告，回傳每一條原因（給玩家看的完整句子，寫出缺的是哪個條件）；灰掉的行動與選不了的目標都帶著原因。行動除了目標還要選的東西（`input.pick` 的每一個鍵）都用 `picks` 宣告，`battleOptions` 列出每一項、每個選項與選不了的原因；每個行動都帶圖示的鍵。宣告與行動本身（`run`）對得上 | COMBAT_SYSTEM 10；PLAN 5.5 第一項 | `tests/core/battle-flow.test.ts`「做不成的一步被擋下」「battleOptions」；`tests/pending/M1-combat.test.ts`（制伏的每一個條件）；`tests/features/M1-picks.test.ts`；`tests/core/battle-m1-followups.test.ts`「每個行動都有圖示的鍵」 |
| 47 | 戰鬥裡的骰子由（種子、游標、這一場的 id、這一場擲到第幾次）導出：同一個狀態、同一串輸入，整場的結果一樣；戰鬥結束時游標往前一格。存讀檔不改變之後的骰 | AI_TASKS 2.4；dev/adr/0011 | `tests/core/battle-flow.test.ts`「同一個種子兩次的結果一樣」「存檔再讀檔之後接著打」 |
| 48 | 戰鬥中不能做別的事：別的任務鏈（自由行動、事件）、別的報告（`Game.commit` 只收戰鬥的報告，其餘丟 `ActionBlocked`）、走地圖都擋下，原因寫出來；還沒分出結果不能結算；已經有一場在打不能再開一場 | COMBAT_SYSTEM 1.3（只有這張表上的行動） | `tests/core/battle-flow.test.ts`「戰鬥中不能做別的事」；`tests/core/battle-m1-followups.test.ts`「S3」 |
| 49 | 戰鬥結束：每一步的報告收成一份（`combat`；內海是 `netrun`），三條軌寫回角色；戰鬥中沒有人會死，倒下的人帶著傷回來（生命最少剩 1）；餘韻疊滿再過載而倒下的，餘韻清空、沉溺 +2。結束之後 `state.battle` 是 `null` | COMBAT_SYSTEM 8.1、8.2；CORE_RULES 4.2；AI_TASKS 3.9 | `tests/core/battle-flow.test.ts`「結束的結算」「倒下的人帶著傷回來」 |
| 50 | 命中：1d20 ＋ 加值 對 迴避（10 ＋ mod(反應) ＋ 遮蔽 ＋ 修正）；自然 20 一定命中、自然 1 一定失手；超過迴避 5 以上是要害（多一顆傷害骰）；命中率顯示時夾在 5～95% | COMBAT_SYSTEM 3 | `tests/core/battle.test.ts`「命中」 |
| 51 | 遮蔽：半掩體迴避 +2、掩體 +4；耐久照場景的等級（半掩體 15／15／20／25／30，掩體 30／30／40／50／60）；任何攻擊都傷到目標那一格的遮蔽（傷害骰 × 武器的遮蔽倍率），沒有人站的格子加倍；煙霧與人群打不破 | COMBAT_SYSTEM 2.1、2.5 | `tests/core/battle.test.ts`「站位、距離與遮蔽」 |
| 52 | 行動點：上限照角色，每回合回 3（第一回合從上限開始；被埋伏的一方從上限 − 2 開始），沒用完的留著、不超過上限；AI 一回合最多做 6 步 | COMBAT_SYSTEM 1.2；ENEMIES 4 | `tests/core/battle.test.ts`「回合與行動點」；`tests/core/battle-flow.test.ts`「AI 的回合」 |
| 53 | 感載：受到的感載 ＝ 傷害 × 敏感度的倍率 ×（攻擊者每一層餘韻 +10%）；到上限就過載：感載歸零、疊一層餘韻，現實是失去下一個回合、內海是閃斷；餘韻已經疊滿再過載就倒下。每回合自然消退 2 ＋ mod(意志)。首領被控制最多 1 回合，之後免疫控制 1 回合 | CORE_RULES 4.2；COMBAT_SYSTEM 7；CYBERSPACE 6.1、6.2；ENEMIES 4.5 | `tests/core/battle.test.ts`「感載、過載與餘韻」「狀態」 |
| 54 | 戰鬥裡給玩家與紀錄看的事件是封閉清單（`BATTLE_EVENTS`：要害、過載、打倒、制伏……）；每一拍帶著事件的標籤與數字，直播、紀錄、之後的功能聽這些，不解析文字 | PLAN 5.5 第二項；dev/adr/0010 | `tests/core/battle-flow.test.ts`「結束的結算」（每一拍的標籤都在 `BATTLE_EVENTS` 裡） |

## 格子地圖、快照、內容篩選（dev/adr/0011、0012）

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 55 | 地圖的定義合格才收：列數與每列的長度對得上、只有圖例裡的字元、標記和版面對得上、每一格從某個入口走得到。地圖上的位置、看過的格子、改過的格子只經由 `map.*` 變更改變 | DATA 9.3；COMMISSION_MAPS 1 | `tests/core/grid.test.ts` |
| 56 | 在格子上走：牆與擺設擋路；要條件的格子（上鎖的門）沒有人放行就過不去；走一段路遇到事情（標記觸發、開打）就停在那一格；走到敵人那一格就開打 | COMBAT_SYSTEM 10；SITES 12.5 | `tests/core/grid.test.ts`；`tests/smoke/m1.test.ts` |
| 57 | 快照放在狀態裡（`state.snapshots`），快照裡不再包快照；回到一份快照時，比它晚的快照與它自己一起丟掉。每場戰鬥開打前留一份；結果定案（打贏、脫離、功能自己的結果，或戰敗已經接受）就丟掉，只有打輸與投降之後留著等玩家三選一。重來這場戰鬥只在這一場還在打、或在等三選一時成立：回到開打之前，紀錄留著並標成被收回；打到一半重來的，這一場的每一步先收成一份 | COMBAT_SYSTEM 8.4；SERIES 6；dev/adr/0011 | `tests/core/battle-flow.test.ts`「重來這場戰鬥」；`tests/core/save.test.ts`；`tests/core/battle-m1-followups.test.ts`「E1」「S7」 |
| 58 | 內容篩選與版本：玩家關掉的標籤，帶著它的內容不出現，改走 `fallback` 指的那一筆（繞圈或找不到就不出現）；版本照主角的性別：男只走 `masc`，女七成 `default`、三成 `yuri`，偽娘、TS、扶他三個各三分之一；抽到的版本沒有寫就退回 `default` | ENEMIES 6；DATA 1、5；LEWD_SYSTEM 9 | `tests/core/versions.test.ts` |
| 59 | 戰敗（全隊倒下或投降）結算之後、開打前的快照還留著的期間，是在等玩家三選一（接受結果、重來這場戰鬥、回到這個階段開始時）：這段時間別的事都做不成（自由行動、別的報告、開另一場、走地圖），原因寫出來；接受結果的報告把那份快照丟掉才算選完。戰敗的後果在接受之前不發生 | COMBAT_SYSTEM 8.3、8.4；dev/adr/0014 | `tests/core/battle-m1-followups.test.ts`「E1」；`tests/features/M1-defeat-edge.test.ts`「E1」；`ui/src/stores/engine.followups.test.ts` |
| 60 | 一個行動要花多少只有一個數字（行動自己算的加上修正），畫面顯示的、檢查的、實際扣的、AI 算的都是它；「每回合第幾次才便宜」的次數只在行動做完的掛點（`action.done`）記，不改武器、不改行動。玩家的一步與 AI 選的一步走同一條路（`performAction`） | SKILLS 1.8；SKILL_TREES 定點射；dev/adr/0014 | `tests/core/battle-flow.test.ts`「行動的花費可以被修正」；`tests/core/battle-m1-followups.test.ts`「行動做完的掛點」；`tests/features/M1-abilities.test.ts`「定點射」 |
| 61 | 走到敵人那一格而戰開不起來（遭遇點寫壞了、沒有人上場），整步不成立：人沒有站過去、沒有留下報告，回傳原因。讀檔時進行中的戰鬥照提交時同一套檢查，戰場與狀態在這一局的內容裡查不到的整筆不讀 | 不變式第 3、6、11 條；審查 M1a 的 S2、E4 | `tests/core/battle-m1-followups.test.ts`「S2」「E4」 |

## 效果（dev/adr/0015）

| # | 不變式 | 出處 | 哪裡驗 |
|---|---|---|---|
| 62 | 效果（道具、技能、招牌行動、武器的附帶效果、快駭的 `{ op, ... }`）用到的每一個 `op` 都在效果登錄表裡查得到，`who` 與 `if` 都在核心的封閉清單裡：載入內容時查不到的擋下（`effectProblems`，訊息寫出那個 `op`），執行時（`run.effects`）丟錯；核心自己不註冊任何效果，每個 `op` 由管那個領域的功能註冊 | dev/adr/0015 第一節；EVENTS 2.4（效果只能是封閉清單） | `tests/core/battle-m1b-effects.test.ts`「效果的登錄表」「run.effects」；`tests/features/M1-combat.test.ts`、`tests/whitebox/combat.whitebox.test.ts`（道具的 `use.effects`） |
| 63 | 和人重疊的東西可以沒有操作者（`owner` 沒有鍵；有的話在讀檔與提交時查得到）；每一輪開頭（第一輪也算，還沒有人行動）發一次 `round.start`，處理函式做完核心替它收尾（補位、看結果），掛點裡分出結果就不再輪到下一個人。操作者退出（倒下、昏過去、被制伏）時：`autonomous` 的一台沒有操作者、`auto` 開著、`ext.orphan = true`、不發 `overlay.down`；其餘的停機。每格最多一台（`run.addOverlay` 擋，丟 `BattleBlocked`）；有操作者時耐久、護甲、迴避各問一次修正（`overlay_hp`、`overlay_armor`、`overlay_evade`），沒有操作者的不問 | dev/adr/0015 第三節、E6；COMBAT_SYSTEM 9.1 | `tests/core/battle-m1b-overlay.test.ts`「round.start」「沒有操作者的一台」「autonomous」「run.addOverlay」「存檔往返」；`tests/features/M1-summons.test.ts`（自己放的照舊停機） |
| 64 | 替身：和人重疊的東西自己開火（`run.overlayAttack`）時的攻擊者，由核心臨時組、不在 `battle.units` 裡、不寫進戰鬥狀態（`ext.overlay` 是那一台的 id，標籤 `machine`、`overlay`）；`run.attack` 的目標是替身時改打那一台的耐久（那一台已經被擊落或不在了，這一擊沒有發生）；狀態給不上去、推拉不動；`attackOverlay` 發 `attack.before` 與 `attack.after`（目標都是替身），改打（`redirect`）的不發 `attack.after`、發 `attack.redirected`（見第 66 條） | dev/adr/0015 第三節 | `tests/core/battle-m1b-overlay.test.ts`「run.overlayAttack 與替身」 |
| 65 | 義體：單位的 `implants` 是開打時的快照（每一件 `{ kind, name, contract? }`，讀檔時查形狀）；`cyber` 沒寫時用件數；`run.implantStatus` 挑一件（指定索引 → 指定種類 → 第一件還沒帶這個狀態的）給 `off_<種類>`／`boost_<種類>`（規則表沒有的退回 `_generic`），沒有可挑的回傳 `null`、不記拍；狀態連 `_generic` 都查不到丟錯，訊息寫出狀態 id。差多少是規則表的資料，核心不寫數字 | dev/adr/0015 第三節 | `tests/core/battle-m1b-overlay.test.ts`「義體」「義體的來源」 |
| 66 | 一擊可以在擲骰之前被取消：`attack.before` 的處理函式設 `opts.cancel`（一句完整的話）之後，核心不擲任何骰、不發 `attack.after`、把那一句話記成一拍（資料帶 `cancelled: true`）、結果 `aborted` 並帶 `cancelled`，後面的 `attack.before` 處理函式不再跑，然後發 `attack.cancel`（後果放這裡）；彈匣在發 `attack.before` 之前就扣了，所以取消的一擊照樣花彈匣，行動點是行動自己扣的。打人與打掛著的東西（`attackOverlay`）一樣。改打（`redirect`）的一擊結算之後發 `attack.redirected`（原本的目標、吃下的那一台、結果；打中、打空、被護甲擋光都發），不發 `attack.after`；彈匣只扣一次 | dev/adr/0015 第二、三節與 M1b-core-closeout 補記 | `tests/core/battle-m1b-closeout.test.ts`「AttackOpts.cancel」「attack.redirected」「attackOverlay 也發 attack.before」；`tests/features/M1b-core-closeout.test.ts`「卡彈與炸膛在 attack.before」「立牌」 |
| 67 | 掛著的東西的直接傷害只有一份算法（`run.damageOverlay`，打它的攻擊 `attackOverlay` 用同一份）：照傷害類型扣它的護甲（穿甲只抵銷護甲、`armorMult` 乘在護甲上）、類型對機器的倍率、做的人的傷害倍率；感載類的傷害對它無效；耐久歸零就擊落（`overlay.down`）；已經擊落的什麼都不做 | COMBAT_SYSTEM 9.1、第 5 節 | `tests/core/battle-m1b-closeout.test.ts`「run.damageOverlay」 |
| 68 | 沉溺只經由 `run.gainSink` 加（傷害類型自己帶的快感 +1、快感的感載效果）：先發 `sink.before`，處理函式設 `out.block` 就不加；呼叫的人的效果自己決定的（`AttackOpts.noSink`：on_hit 帶定力檢定的 `sink`）略過掛點。不再有「先加再扣」。已經退出的人與替身加不上 | COMBAT_SYSTEM 第 5 節（定力擋得掉沉溺那一部分） | `tests/core/battle-m1b-closeout.test.ts`「run.gainSink 與 sink.before」；`tests/features/M1b-core-closeout.test.ts`「快感的沉溺」 |
| 69 | 狀態可以寫 `until: 'next_overload'`（`BattleUntil` 是 `{ at: 'overload' }`）：帶著它的人過載的那一刻（包括餘韻疊滿而昏過去的那一次）拿掉，記一拍「結束了」；別人過載、自己的回合開始與結束都不拿；沒有過載就留到戰鬥結束。戰鬥裡行動灰掉的「不夠」那一句用資源池的中文名（`POOL_NAMES`：現金、小／中／大人情、RAM……），格式 `名字不夠（要 N，現在 M）。` | ITEMS 5.2（紙鶴）；dev/adr/0015 | `tests/core/battle-m1b-closeout.test.ts`「到下次過載」「資源池的中文名」；`tests/features/M1b-core-closeout.test.ts`「道具對一個敵人用」 |
| 70 | `check.before` 的 `unit` 是擲骰的人（`run.save` 的 `u`），`other` 是檢定對他擲的那個人（拿 DC 的那一方：被快駭、被誘惑的人，或豁免裡下手的人）；只有帶 `other` 的檢定才發，而且一次擲骰只發一次。`checked` 反應的主角是 `other`、`by` 是 `unit`，`react.dc` 加的是這一次的 DC。快駭的檢定（`hack.check`）走核心的 `check` 效果，自己不發這個掛點、不算防火牆 | dev/adr/0015 補記（M1b-core-fix2） | `tests/features/M1b-ops.test.ts`「check」；`tests/features/M1b-hack.test.ts`「hack.check 是核心 check 效果的包裝」；`tests/features/M1b-skill-format.test.ts`「checked」；`tests/core/battle-m1b-effects.test.ts` |
| 71 | 補位（`run.compact`）做完、狀態整理好之後，對每個往前移動的單位發一次 `compacted`（`from`、`to` 是這一次補位的淨移動，沒有人動不發）；「站在某一格的人往前補位」的反應聽這個掛點，不在每個動作做完去掃站位 | dev/adr/0015 補記 | `tests/core/battle.test.ts`「補位發 compacted」；`tests/features/M1b-skill-gunner-broker.test.ts`「不准動喔」 |
| 72 | 先攻的 `actNext` 問的是「對調之前動過沒有」：呼叫的人在 `swapOrder` 之前用 `run.hasActed` 問好、用 `{ acted }` 帶進來；動過的（順位在現在輪到的人之前或就是他）不排，沒動過的排到現在輪到的人後面一位，輪到的人不變。不在順序裡、已經退出的、現在輪到的人回傳 `false` | dev/adr/0015 E7 與補記 | `tests/core/battle-m1b-effects.test.ts`「hasActed」「actNext」；`tests/features/M1b-ops.test.ts`「act_next」；`tests/features/M1b-skill-gunner-broker.test.ts`「大局」 |
| 73 | `action.done` 的 `tags` 和問花費（`action_ap`）時帶的是同一串：行動的 id、`group:<圈>`、行動自己宣告的標籤、`other`、行動自己的 `costTags`（`item:medical`）；在行動做之前問好（用掉道具之後快取格可能空了）。功能不必自己記問花費時的標籤 | dev/adr/0014、0015 第二節與補記（M1b-core-fix3） | `tests/core/battle-m1b-fix3.test.ts`「performAction」；`tests/features/M1b-skill-medic.test.ts`「巡房」「名醫」 |
| 74 | 對自己給的 `until: own_turn_end`（`by` 就是帶著它的人、他自己的回合正在進行）：這個回合的結束不算，從他下一個回合的結束起算 `turns`（`BattleUntil.skip`；`battle.acting` 是回合進行中的單位，`beginTurn` 設、`advance` 在回合結束的結算做完之後拿掉；`run.skipsOwnTurnEnd(holder, by)`）。別人給的、不在他的回合裡給自己的、`source_turn_end`、`own_turn_start` 不變。buff 的計時（`features/abilities/mods.ts`）還沒套用同一個規則（dev/adr/0015 補記列了要做的事） | dev/adr/0015 補記（M1b-core-fix3） | `tests/core/battle-m1b-fix3.test.ts`「對自己給的 until: own_turn_end」；`tests/features/M1b-skill-medic.test.ts`「超頻」 |
| 75 | 公式的名字有三個家族：`tier`、`hp_max`、`load_max`，各有 `half_<名字>_up`（進位）與 `half_<名字>_down`（捨去）；`hp_max`、`load_max` 看這一筆落在的人（沒有就看做的人），沒有感載的人是 0；骰數的名字不收上限 | dev/adr/0015 第一節與補記（M1b-core-fix3） | `tests/core/battle-m1b-fix3.test.ts`「公式的 hp_max、load_max」 |
| 76 | 有效遮蔽 = 那一格本身的（煙霧算至少半掩體）+ `cover_level` 的修正，夾在 0～2，開著機體的人永遠 0（`run.coverOf`、`run.isExposed`）：迴避、暴露（監視）、AI 挑目標都問它；多出來的級數打不破，遮蔽的耐久與被打穿只看那一格自己的；修正的條件裡問有效遮蔽時回答那一格本身的 | COMBAT_SYSTEM 2.1；SKILL_TREES 堡壘姿態；dev/adr/0015 補記（M1b-core-fix3） | `tests/core/battle-m1b-fix3.test.ts`「cover_level」；`tests/features/M1b-skill-pilot.test.ts`「堡壘姿態」 |
| 77 | 效果的 `who: foe_overlay` 落在敵方**一台**沒被擊落的掛著的東西：`pick.overlay`（寫了卻不是敵方沒被擊落的一台就整筆不做）→ 目標（是敵方掛著的一台時）→ 最前面（格子最小）的一台；一台都沒有整筆不做。`pick:<鍵>` 也收掛著的東西的 id | dev/adr/0015 補記（M1b-core-fix3）；SKILL_TREES 管理員 | `tests/core/battle-m1b-fix3.test.ts`「who：foe_overlay」；`tests/features/M1b-hack.test.ts`「管理員」 |

