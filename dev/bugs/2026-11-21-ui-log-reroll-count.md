# ui-log-reroll-count：紀錄的擲骰行看不到重擲了幾次

- 發現者：cpp-tester-whitebox
- 嚴重度：錯誤（規格明寫「玩家不能藏起來」）
- 規格出處：UI 第 3.2 節（重擲過的擲骰行在最後標「重擲 ×2」，次數不能隱藏）；AI_TASKS 2.4 節「擲骰的步驟」一列（每次重擲都記一筆：紀錄裡的擲骰行標出重擲過幾次）；dev/invariants.md 第 5 條。
- 期望的行為：重擲兩次之後，最新那一則紀錄的 `roll` 帶著重擲的次數（2），`LogView` 顯示「重擲 ×2」。
- 實際行為：引擎的報告裡有（`timeline[].roll.rerolls`、`history`，見 `engine/src/core/types/check.ts` 的 `CheckRoll`），任務鏈列的那一步也有（`StepRecord.rerolls`）；但 `logEntryOf` 只取 `skill`、`die`、`mod`、`dc`、`result`，`EngineLogEntry.roll` 沒有這個欄位，`LogView.vue` 也不顯示。AI 關閉、種子 7、自由行動之後重擲兩次：`e.log[0].roll` 沒有重擲的次數。
- 重現：`ui/tests/fixtures/repro/ui-log-reroll-count.json`；會失敗的測試：`ui/tests/pending/M0-ui-engine-bugs.test.ts`（期望欄位名 `rerolls`，和引擎的 `CheckRoll` 同名；用別的名字的話改重現資料的 `rollRerolls` 取值處，`ui/tests/helpers/uiRepro.ts`）。
- 可能的位置（推測）：`ui/src/lib/engineView.ts` 的 `logEntryOf` 與 `EngineLogEntry`；`ui/src/components/LogView.vue` 的擲骰行。工單 M0-ui-engine 第二節的 `roll` 欄位表也沒列這一項，工單本身漏了，請 cpp-architect 一起補。
- 附帶看到的（不在這份 bug 裡）：UI 第 3.2 節要的 `twist`（判定的「但是／而且」）也到不了紀錄：引擎的判定有 `twist`，但沒有寫進報告，`logEntryOf` 拿不到。這是引擎那一側的缺口。

- 狀態：已修（2026-11-21，cpp-ui；測試在 ui/src/stores/repro.test.ts）
