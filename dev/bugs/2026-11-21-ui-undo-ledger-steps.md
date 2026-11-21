# ui-undo-ledger-steps：舊系統的每一筆帳（ui.money、ui.time）各佔一步回退，五筆之後最新那一樓回退不到

- 發現者：cpp-tester-whitebox
- 嚴重度：錯誤（介面的「紀錄的回退」按鈕還沒接上 `e.undo`，接上之前玩家碰不到；store 的 `undo`、`canUndo` 現在就是錯的）
- 和審查的關係：dev/reviews/2026-11-21-M0.md 的 S3 是同一個根源（一個動作變成好幾步回退）；這份補上量化的重現與回退容量的後果。
- 規格出處：AI_TASKS 5.5 節第 1 條（「一段正文是一樓。沒有正文的鏈……算在當時最新的那一樓」）；AI_TASKS 2.4 節「回退」一列（回退最多 5 步，GAME_DESIGN 第 9 節）；UI 的讀檔對話框「紀錄的回退・最近五樓」。
- 期望的行為：沒有正文的帳（`ui.money`、`ui.time`）算在最新的那一樓；回退一步收回整樓（自由行動加上它之後的帳）。
- 實際行為：`useEngine().commit`／`ledger` 都走 `game.commit`，每一次都 `undo.push` 一步。AI 關閉、種子 7、建角之後做一次自由行動，再用 `g.money.cash -= 10` 花五次錢：回退堆疊（上限 5）裡只剩那五筆帳。`e.undo()` 一次只把現金從 1450 補回 1460，紀錄還是 2 則；連按六次之後自由行動那一樓仍在，`canUndo` 已經是 false。另一個後果：只收回引擎這一半（錢），舊系統那一半（例：買到的東西進了背包）不跟著回去，買東西再回退等於白拿。
- 重現：`ui/tests/fixtures/repro/ui-undo-ledger-steps.json`（介面層的重現格式，由 `ui/tests/helpers/uiRepro.ts` 執行；引擎的 repro 格式沒有 store 層的動作，所以不放在 `engine/tests/fixtures/repro/`）。會失敗的測試：`ui/tests/pending/M0-ui-engine-bugs.test.ts`（在 `ui/` 跑 `npx vitest run --config vitest.pending.config.ts M0-ui-engine-bugs`）。
- 可能的位置（推測）：`ui/src/stores/engine.ts` 的 `commit`、`ledger`（`game.commit` 一定留一步回退）。可能要引擎給一個「併進最新一樓、不另留回退」的提交入口（`engine/src/shell/game.ts` 的 `Game.commit`），屬於 cpp-architect。
