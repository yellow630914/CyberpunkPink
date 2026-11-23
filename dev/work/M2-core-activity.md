# M2-core-activity

- 交給：cpp-architect 角色（sonnet；**改的是核心**，派工時明說可以改下面列的核心路徑）
- 目標：照 dev/adr/0016 第一、二節，把「誰開誰的東西、誰擋住誰、做完交回給誰」做成核心的一張登錄表，`Game.blockOf` 改問它，報告可以帶 `launch`。
- 規格出處：dev/adr/0016 第一、二、七節（設計）；dev/adr/0014「等著選的戰敗由核心擋」（現有的行為要原樣留著）。設計書不用讀。
- 可以改的路徑：`engine/src/core/action/`（新增 `activity.ts`）、`engine/src/core/kernel.ts`、`engine/src/core/types/report.ts`、`engine/src/core/state/hooks.ts`、`engine/src/core/grid/`（`GridEffect.launch`）、`engine/src/core/battle/step.ts`（結算時發 `activity.end`）、`engine/src/shell/game.ts`、`engine/src/core/content/kinds.ts` 與 `engine/src/features/actions/index.ts`（只為了第 6 點）、`engine/src/testkit/`、`engine/tests/core/`、dev/invariants.md、dev/test-harness.md 第 1 節。
- 不可以做的事：不改戰鬥與戰敗現在被擋下時的句子與時機（主套件要原樣全過）；不在核心登記戰鬥與戰敗以外的活動；除了第 6 點不動 `features/`；共同的規定見 dev/work/M2-plan.md。

## 新的型別與鍵

- `Origin`、`Launch`、`ActivityDef`、`ActivityRegistry`（`k.activity`）：照 0016 第一節。
- `Report`／`ReportDraft` 多三個選填欄位：`launch?: Launch[]`、`triggers?: Array<{ point: string; where?: Record<string, unknown> }>`、`adult?: boolean`。
- 掛點 `activity.end`：`[{ state, kind, id, origin, outcome, result }, { changes?, lines?, launch?, rewind? } | void]`。
- `GridEffect.launch?: Launch[]`、`GridEffect.triggers?`（和報告的 `triggers` 同一個形狀）。

## 要做的

1. **登錄表**：`define`（同一個 `kind` 重複丟錯）、`allow(kind, prefix, owner)`（那個活動還沒登記時先記著，登記時併進去；始終沒有人登記就當沒這回事）、`active(state)`（照 `order`）、`blockOf(state, doing, draft)`、`start(k, state, kind, setup, origin)`（沒有這種活動、或它沒有 `start`，丟 `ActionBlocked`，句子寫出是哪一種）。每次登記發探針的 `registry.register`。
2. **內建兩筆**：`battle`（`order` 0）、`defeat`（`order` 10），規則照現在 `Game.blockOf` 的兩段原樣搬；`Game.blockOf` 只剩「問登錄表」。
3. **`launch`**：`Game.launch(kind, setup, origin?)` 是對外的入口（先問 `blockOf('<kind>.start')`）。任何一條提交的路（`commit`、任務鏈的套用、`gridMove`）提交完之後，照順序處理每一份報告的 `launch`：`k.activity.start` 拿到草稿、接著提交（不另留回退、不算一個回合）。種類是 `battle` 的走原本的 `startBattle`（開打前的快照照舊），`origin` 的 `by`、`ref` 與 `ext` 併進 `setup.origin.ext`。**任何一個開不成，整步不成立**：狀態回到這一步之前（含那份報告本身），丟 `ActionBlocked`。連開超過四層丟錯。
4. **`activity.end`**：給一個共用的函式（把每個處理函式回傳的 `changes`、`lines`、`launch`、`rewind` 併成一份；`rewind` 只取第一個）；`endBattle` 用它，`origin` 取自 `battle.origin.ext`（沒有 `by` 當 `core`），`result` 帶戰鬥的 id、等級與每一方還站著的人數。原本的 `k.battle.onEnd` 不動。
5. `GridEffect.launch` 與 `GridEffect.triggers` 併進走那一步的報告；原本的 `battle` 欄位照舊。
6. **行動種類的 `owner`**：`ActionKindEntry` 多選填的 `owner`（功能的 id）。寫了的那一筆，`features/actions` 不註冊，留給那個功能自己註冊（它要加照對象算的 DC、每天的次數；M2-npc-interact、M2-roster 用）。
7. **testkit**：一個玩具活動 `TEST_ACTIVITY`（狀態放 `state.ext.toy`：開始、走一步、結束時發 `activity.end`），給核心與下游的測試當替身。

## 驗收條件（`engine/tests/core/activity.test.ts`）

- 主套件原樣全過；戰鬥中與等著選戰敗時被擋下的句子和現在一字不差。
- 兩個活動同時進行：兩個都放行才過；先問 `order` 小的，原因是第一個不放行的那一句。
- `allow` 加的前綴生效；對還沒登記的種類先 `allow`、後 `define` 也生效。
- 報告帶 `launch`：提交之後玩具活動進行中，開始的報告在紀錄裡、和那份報告是同一步回退。
- `launch` 開不成：狀態和提交之前完全一樣（整份比對）、可以回退的步數不變、丟出來的原因是活動給的那幾句。
- `launch` 一場戰鬥：有開打前的快照；`origin` 的鍵出現在 `battle.origin.ext`。
- 戰鬥結算時 `activity.end` 的處理函式回傳的變更在 `battle.end` 那一份裡；回傳的 `launch` 在結算提交之後開起來。
- 活動進行中存檔再讀回來，被擋下的事還是被擋下。
- 行動種類的資料寫了 `owner` 的那一筆載得進來，但 `k.actions` 裡沒有它；沒寫的照舊。
- `npm test`、`npx tsc --noEmit`、分層檢查全過；dev/invariants.md 補「活動的放行是白名單」「`launch` 開不成整步不成立」兩條。

## 依賴

沒有。做完才能開 M2-core-shell（兩張都改 `shell/game.ts`，不要同時做）與 M2-director。

## 完成時回報

改了哪些檔、測試結果、ADR 做不到或沒寫清楚的地方。
