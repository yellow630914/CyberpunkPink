# M3-hack-net

- 交給：cpp-feature（sonnet）
- 目標：`features/hack` 的 M3 部分：快駭程式在內海戰鬥照用並加追蹤度；現實的快駭被發現時加那個勢力的敵對值（dev/adr/0015 留下的 E9）；敵方潛網者的主控階數讀資料。
- 規格出處：NETRUNNING 第 2、5 節；ITEMS 11.9 節「怎麼用」的「追蹤與敵對值」與「視線」兩條；CYBERSPACE 6.3 節最後一條；dev/adr/0018 第十一節與 N21；dev/adr/0015 E5、E9；dev/work/M1b-hack.md（現有的格式）。
- 可以改的路徑：`engine/src/features/hack/`、`engine/tests/features/M3-hack-net.test.ts`。
- 可以用的介面：現有的快駭行動與 `hack.check`；`battle.field.trace`、效果 `net.trace`（有人註冊才用）；`k.battle.onEnd`；`k.effects`（`hostility`，有人註冊才給）；`battle.origin.faction`；內容 `district`（`factions` 的第一個，有這個種類才讀）；`unit.ext.net.admin`。
- 不可以做的事：不 import `features/netcombat`、`features/security`、`features/world`；戰鬥外對裝置的快駭（攝影機、視線、中繼器、跳線）不做；從「人」節點快駭是 M3-netrun-nodes 的；共同的規定見 dev/work/M3-plan.md。

## 要做的

1. 每一支快駭程式的行動 `modes` 加內海；行動點與 RAM 照程式自己的資料（支援類照舊 0 點、每回合一次）。內海裡的目標：敵方的單位（蕾絲算有橋）、敵方掛著的一台。
2. **在內海**：`battle.field.trace` 是數字時，每用一次（不論成敗）追蹤度加程式的 `trace`（資料已經收下的欄位；沒寫是 0），經效果 `net.trace`；沒有人註冊那個效果就不加。
3. **在現實**（E9）：不加追蹤度。記下「被發現」的份：檢定失敗的當場算；成功的，記在目標身上，戰鬥結束時他還在場上（沒有倒下、沒被制伏、沒逃走）才算。戰鬥結束時把這些 `trace` 加總，給那個勢力的敵對值（效果 `hostility`，內建的來源；勢力是 `origin.faction`，沒有就是所在那一區資料的第一個勢力，都沒有就不給）；結束的報告多一句給玩家看的話（不帶數字）。對自己人用的支援類不算。
4. 技能做的快駭（帶 `hack` 標籤的技能行動）照同一條：行動做完的掛點（`action.done`）看標籤，`trace` 讀技能資料的 `trace`（沒寫是 0）。
5. `treeTier`：敵人先讀 `unit.ext.net.admin`（M3-lace 放的），沒有才退回單位的等級。

## 驗收條件（`engine/tests/features/M3-hack-net.test.ts`；程式與單位用測試自帶的資料，`net.trace` 與 `hostility` 用測試的替身）

- 內海戰鬥的技能圈有裝著的快駭程式；用一次追蹤度 +程式的 `trace`；沒有 `battle.field.trace` 的場地不變。
- 現實戰鬥：用了兩次（一次失敗、一次成功打在一個最後還站著的敵人身上）、另一次成功打在最後被制伏的敵人身上：結束時敵對值加的是前兩次的 `trace`，第三次不算。
- 沒有人註冊 `hostility`、或找不到勢力：戰鬥照常結束，不丟錯。
- 帶 `hack` 標籤的技能替身照同一條算。
- 敵方單位 `ext.net.admin` 是 3、等級 5：`treeTier` 是 3。
- 現有的快駭測試原樣全過；`npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-netcombat-out（`net.trace`、`battle.field.trace` 的約定）；M3-lace 最好先做完（第 5 條的資料）。

## 完成時回報

改了哪些檔、測試結果、ITEMS 11.9 節十六支程式的 `effect` 裡現在的效果清單寫不出來的。
