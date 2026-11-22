# ui-stage-outside-dungeon：戰敗三選一的「回到這個階段開始時」在 M1 一律做不成

- 發現者：cpp-tester-whitebox（M1-ui-combat-picks 的白箱）
- 嚴重度：錯誤（三選一的第三個按鈕永遠只回「沒有更早的存檔點可以回去。」；另外兩個選擇照常，不會卡死）
- 規格出處：COMBAT_SYSTEM 8.4 節（「回到這個階段開始時」：委託副本裡回到這個階段剛開始的時候；**副本以外的戰鬥，等於重來這場戰鬥**；這一條不是設定，一律開著）；SERIES 第 6 節（階段的快照）；dev/adr/0014「三個選擇各自怎麼離開」；dev/invariants.md 第 59 條。
- 期望的行為：
  1. 副本以外打輸（引擎裡開打前的快照之前沒有別的快照）：按「回到這個階段開始時」和「重來這場戰鬥」一樣，回到開打之前再開一次（回傳 `null`，`inBattle` 是 true，`pendingDefeat` 是 null）。
  2. 在委託副本裡打輸：回到這個階段剛開始的時候。現在介面的副本還是舊系統（`useGame.takeSnapshot('階段', …)` 存在 store 自己的 `snapshots`，帶著 `eng.save()`），引擎的 `state.snapshots` 裡沒有 `stage`。
- 實際行為：`ui/src/stores/engine.ts` 的 `rewindToStage()` 只拿引擎快照清單裡「緊貼在開打前那一份之前」的那一份；M1 只有開戰會存引擎的快照，所以那一份永遠不存在，兩種情形都回傳 `'沒有更早的存檔點可以回去。'`，狀態不變、還在等三選一。另外它不看快照的種類（`stage`、`entry`、功能自己的），排在前面的是什麼就回到什麼。
- 重現：
  - `ui/tests/fixtures/repro-pending/ui-stage-outside-dungeon.json`（種子 7、建角、打一場 `BATTLE_SETUPS.hopeless()` 投降、按「回到這個階段開始時」；期望同重來）
  - `ui/tests/fixtures/repro-pending/ui-stage-legacy-dungeon.json`（同上，但先用舊系統存「入口」「階段」兩份快照、中間各過一段時間；期望時間回到「階段」那一刻，第 1 天 08:30）
  - 會失敗的測試：`ui/tests/pending/M1-ui-combat-picks-bugs.test.ts`（在 `ui/` 跑 `npx vitest run --config vitest.pending.config.ts M1-ui-combat-picks-bugs`）；兩條都在 `choiceResult` 失敗，實際是 `'沒有更早的存檔點可以回去。'`。
  - 執行器 `ui/tests/helpers/uiRepro.ts` 多了三種步驟（`loseBattle`、`rewindToStage`、`retryBattle`）與三個觀察值（`choiceResult`、`inBattle`、`pendingDefeat`）。修好之後把兩份 json 搬到 `ui/tests/fixtures/repro/`，`ui/src/stores/repro.test.ts` 就會每次重播。
- 引擎這一側已經照規格的部分有測試守著（`ui/src/stores/engine.picks.whitebox.test.ts`）：引擎裡有 `stage` 快照時回得去、時間與錢回到那一刻、之後的紀錄標成被收回、開打前的快照丟掉、入口／階段／開打前三份都在時回到最近的階段、快照壞掉時狀態不變。
- 可能的位置（推測，不改）：`ui/src/stores/engine.ts` 的 `rewindToStage()`（註解自己寫了「哪一份算階段開始是這裡暫定的轉接」）。
  - 「哪一份快照算這個階段的開始、副本以外要退成重來」是 COMBAT_SYSTEM 8.4 的規則，照 CODESCAN 2.8（不變式第 10 條）不該寫在 store。建議由 cpp-architect 在引擎給一個 `Game.rewindToStage()`（或 defeat 功能的轉接）：找最近一份 `kind === 'stage'` 的快照；沒有就走 `retryBattle()`；store 只轉接。
  - 舊系統的副本（`useGame` 的「階段」快照）要不要在 M1 就接上，或等 M2 委託副本搬進引擎時一起改成 `snapshot.add`（`stage`、`entry`；dev/adr/0011），請 cpp-architect 決定。在那之前，第 2 份重現會一直是紅的；如果決定等 M2，可以先只修第 1 份（副本以外等於重來），第 2 份留在 pending。
- 處理進度（2026-11-22）：
  - 第 1 份（副本以外，等於重來）修好了：引擎加了 `Game.rewindToStage()`（`engine/src/shell/game.ts`）：只在等三選一時成立，找開打前那份快照之前最近的 `kind === 'stage'`，沒有就走 `retryBattle()`；`ui/src/stores/engine.ts` 的 `rewindToStage()` 只轉接。重現 json 已搬到 `ui/tests/fixtures/repro/ui-stage-outside-dungeon.json`，引擎的回歸測試在 `engine/tests/whitebox/shell-battle.whitebox.test.ts`。
  - 第 2 份（舊系統副本的階段快照）**留在 pending**，`ui/tests/fixtures/repro-pending/ui-stage-legacy-dungeon.json` 還在原處：等 M2 委託副本搬進引擎、改用 `snapshot.add`（`stage`、`entry`；dev/adr/0011）之後自然解決，現在不接。
- fixed in（第 1 份）: `engine/src/shell/game.ts`（`rewindToStage`）、`ui/src/stores/engine.ts`
