# M5-core-seams

- 交給：cpp-architect 角色（sonnet；**改的是核心**，可以改 `engine/src/core/action/`、`engine/src/core/grid/`、`engine/src/shell/game.ts`）
- 目標：M5 要核心補的兩處小機制：(1) 活動可以宣告 `deny`，進行中時擋下外殼自己的動作（現在只有「回退步數」）；(2) 家的地圖種類與 `furniture` 這一種格子。
- 規格出處：dev/adr/0020 第三節「直播不回退」、第十節；dev/adr/0016 第一節（活動的登錄表）；dev/adr/0012、0018 第五節（地圖的種類怎麼分世界）；MEDIA 1.2「直播中不能回退」；DOWNTIME 7.4 節；UI 1.1 節規則 3。
- 可以改的路徑：`engine/src/core/action/activity.ts`、`engine/src/core/grid/model.ts`、`engine/src/core/grid/index.ts`、`engine/src/core/index.ts`（匯出）、`engine/src/shell/game.ts`（只有回退步數的那幾個方法）、`engine/tests/core/seams-m5.test.ts`、dev/invariants.md。
- 可以用的介面：`ActivityDef`、`ActivityRegistry`（`define`、`active`、`blockOf`）、`Game.undoSteps` 與 `UndoStack`、`CELL_TRAITS`、`STREET_MAP_KINDS`／`NET_MAP_KINDS` 的做法、`specialMapProblems`、`sheetProblems`。
- 不可以做的事：不改放行白名單的行為（`allow`、`allows`、`blockOf` 對既有的 `doing` 一律照舊）；不讓既有的活動（戰鬥、戰敗、場景、事件、副本、網內的行程、潛入）多擋任何事；不寫直播與家園的任何規則；不改現有格子種類的性質；共同的規定見 dev/work/M5-plan.md。

## 新的型別與鍵

- `ActivityDef.deny?: string[]`：這個活動進行中時不准做的外殼動作。封閉清單 `SHELL_ACTS = ['undo']`（之後要加再加）；寫了清單以外的字，`define` 丟錯。
- `ActivityRegistry.denied(state, act): string | null`：照 `order` 找第一個進行中、而且 `deny` 含 `act` 的活動，回它的 `reason(state, act)`（給玩家看的完整句子）；沒有就是 `null`。
- `Game.undoBlock(): string | null`：現在能不能回退步數（問 `denied(state, 'undo')`）。`Game.undoSteps(n)` 一開始先問它：被擋就回傳 `false`、什麼都不動（回退的堆疊原樣留著）。
- `HOME_MAP_KINDS = ['home']`、`isHomeMapKind(kind)`（和 `isStreetMapKind`、`isNetMapKind` 同一個做法）。
- `CELL_TRAITS.furniture = { walk: false, see: true }`（沒有標記）。它不進預設圖例：只當成「實例上被改過的一格」的種類用（`map.sheet` 的 `cells`）。

## 要做的

1. `deny`：`define` 時檢查清單；`denied` 照上面的寫法。沒有任何活動寫 `deny` 時，`undoSteps` 的行為和現在逐位元組相同。
2. `Game.undoSteps`、以及介面拿來決定按鈕能不能按的那個查詢（現有的 `canUndo` 或同等的東西；沒有就不加，只加 `undoBlock`）都要問。讀檔、回到快照（`rewindToKind`）、重試最新一樓**不受 `deny` 管**（那些各有自己的 `doing`）。
3. 家的地圖（`isHomeMapKind`）不要求遭遇點（`specialMapProblems` 給 `minSpots: 0`）；入口照舊認 `E` 或連接格；其餘的檢查（每格走得到、連接格、標記與版面對得上）照舊。
4. `furniture`：`Sheet` 讀到補丁把一格換成 `furniture` 時，那一格走不上去（`walkable`、`findPath`、`reachable` 都繞開）、看得穿（`visibleFrom` 照過去）。版面的圖例寫 `furniture` 的字元要被 `sheetProblems` 擋下（訊息：「furniture 只能是擺上去的家具，不能畫在版面上。」）。
5. dev/invariants.md 加兩條：活動的 `deny`（只擋清單裡的外殼動作、不影響白名單）；家的地圖種類與 `furniture` 格（只出現在補丁裡）。

## 驗收條件（`engine/tests/core/seams-m5.test.ts`；用 testkit 的玩具活動與一張最小的家的版面）

- 玩具活動寫 `deny: ['undo']`：進行中 `undoBlock()` 回它的原因、`undoSteps(1)` 回 `false`、狀態與回退的堆疊都沒變；活動結束之後 `undoSteps(1)` 成功，回到的是活動開始前後應該回到的那一步。
- 沒有 `deny` 的玩具活動進行中，`undoSteps` 的結果和這張工單之前一樣（拿既有的回退測試當對照，原樣全過）。
- `deny: ['nope']` 在 `define` 時丟錯。
- 兩個活動都進行中、只有外層寫 `deny`：照樣被擋，原因是外層的。
- `kind: 'home'` 的地圖沒有遭遇點可以載入；`kind: 'office_small'` 少遭遇點照舊被擋。
- 在一格地板上打 `furniture` 的補丁：`walkable` 是 `false`、`findPath` 繞過它、被它堵死的房間 `reachable` 不包含；`visibleFrom` 看得到它後面的格子；拿掉補丁恢復原狀。
- 版面的圖例用到 `furniture` 被擋，訊息對。
- `engine/tests/core/grid.test.ts`、`activity.test.ts` 與探索、網內行程的測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 完成時回報

改了哪些檔、測試結果、`Game` 上原本有沒有「能不能回退」的查詢（給 M5-ui-live 用）、ADR 做不到的地方。
