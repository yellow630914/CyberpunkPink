# M3-defeat-net

- 交給：cpp-feature（sonnet）
- 目標：`features/defeat` 認得內海戰敗的兩種情況：戰鬥中被定位而結束的、贏的那一方裡有不算數的白蕾絲；並把「被扣線了沒有」交給戰敗的畫面。
- 規格出處：CYBERSPACE 6.7 節（戰敗那一條與最後的表）、6.8 節（到 90）；ENEMIES 第 6 節（`pinned`、`polluted` 兩列與表下「不算委託失敗的」）、第 9 節（戰敗那一條、野生蕾絲）；COMBAT_SYSTEM 8.3、8.4 節；dev/adr/0018 第十節與 N17；dev/work/M2-defeat.md（現有的流程）。
- 可以改的路徑：`engine/src/features/defeat/`、`engine/tests/features/M3-defeat-net.test.ts`。
- 可以用的介面：現有的 `pick`（選事件與版本）、`winnersOf`、`PendingDefeat`、`defeatView`；`battle.field.located`、`battle.origin.ext.located_event`、戰鬥結束那份報告的 `data.tethered`、單位的標籤 `lace:white`。
- 不可以做的事：不替 `pinned`、`polluted` 寫專屬的程式（0016 G5 照舊：種類只是標籤）；不寫事件的內容；不 import `features/netcombat`、`features/netrun`；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. **被定位**：那一場的 `battle.field.located` 是 true 時，選事件的順序改成：天使急救 → `origin.ext.located_event` → 贏的那一方勢力的預設（**跳過**個別敵人寫的 `defeat`）→ 通用的。
2. **白蕾絲不算贏的人**：算「誰贏了」時帶 `lace:white` 標籤的單位不列；只剩牠們站著時用場地的勢力。
3. 等待中的戰敗多兩個欄位給畫面與事件用：`net`（這一場是內海的）、`tethered`（被扣線）；`defeatView` 一起給。事件的條件要用的話，把兩者登記成條件 `defeat_net`、`defeat_tethered`（事件的選項可以寫「被扣線時才出現」）。
4. 其餘照舊：三選一、版本、存檔規則的改寫、接受之後發 `activity.end`（`kind: 'defeat'`）。內海的戰敗事件一樣可以寫 `fails_commission: false`（`polluted` 的預設）。

## 驗收條件（`engine/tests/features/M3-defeat-net.test.ts`；測試自帶四件假的戰敗事件：`pinned`、`polluted`（不算失敗）、勢力甲的預設、被定位用的一件；內海的戰鬥用 `TEST_NET_COMBAT` 與 `BATTLE_SETUPS.net`）

- 輸給資料寫 `defeat: 'pinned'` 的粉蕾絲：選到 `pinned` 那一件。
- 同一場但 `battle.field.located` 是 true：選到勢力甲的預設；`origin.ext.located_event` 有寫時選到它。
- 場上站著一隻白蕾絲與一隻黑蕾絲：贏的人只有黑蕾絲，選到 `polluted`；接受之後 `activity.end` 的 `result.fails_commission` 是 false。
- 結束的報告帶 `data.tethered`：等待中的戰敗 `tethered` 是 true，寫了 `defeat_tethered` 條件的選項看得到；沒有被扣線時看不到。
- 三選一照舊：重來這一場回到開打前；接受之後不再擋別的事。
- 現有的戰敗測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-netcombat-out（`battle.field.located`、`data.tethered`）。

## 完成時回報

改了哪些檔、測試結果、CYBERSPACE 6.7 節三種顏色的下場裡要靠內容才做得到的（預期：惡意韌體、現實的保全知道位置之後的事件）。
