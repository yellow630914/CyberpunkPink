# M1b-core-fix2

- 交給：cpp-architect（核心小修一批，sonnet；M1 第二波第二批；清單來源是 dev/status.md 的兩條「第二批核心小修」）
- 目標：四件小事——大局的 `act_next` 看「對調之前」有沒有動過；補位發 `compacted` 掛點、不准動喔改聽它；`check.before` 的方向定一邊、快駭的檢定不再自己發它也不再抄一份防火牆；技能格式補四個小東西並把潛網者樹的近似改寫。
- 規格出處：dev/adr/0015 第二節、E7；SKILL_TREES「大局」「不准動喔」（槍手）「偷看是不行的喔」「管理員」「改寫地形」與潛網者共鳴 3、4 階；dev/work/M1b-skill-format.md 第二～四節、dev/work/M1b-hack.md。
- 可以改的路徑：`engine/src/core/battle/`、`engine/src/core/types/battle.ts`；`engine/src/features/combat/ops.ts`（`order`、`check`）；`engine/src/features/hack/ops.ts`（`hack.check`）；`engine/src/features/abilities/` 只有 `ward.ts`，以及第 4 項直接相關的 `reactions.ts`、`format.ts`、`types.ts`、`conditions.ts`、`kinds.ts`、`battle.ts`（只動共鳴的池與感載上限）；測試；dev/adr/0015、dev/invariants.md。
- 不可以做的事：不動 `features/summons`（另一個代理在做 M1b-skill-pilot）；abilities 其餘的檔案不動；檔案撞到就停下來回報；不改 `engine/data/`；不 commit。

## 一、`act_next` 看對調之前

大局：「被換到前面的人馬上行動」。現在 `run.actNext` 看的是對調之後的位置，所以「一個動過、一個沒動過」對調時，原本沒動過、被換到前面的人（對調後排在現在輪到的人前面）不會接著動。改成：`order` 效果在對調之前先問兩個人動過沒有（順位在現在輪到的人之前、或就是他）；對調之後，被換到前面的那一個如果**對調之前**還沒動過，就排到現在輪到的人後面一位（順位在前面時要把指標跟著修正）。核心給 `run.hasActed(u)` 與 `run.actNext(u, { acted })`。把 `M1b-skill-gunner-broker.test.ts` 的 `it.todo` 寫成真的測試。

## 二、`compacted` 掛點

補位（`run.compact`）每次做完，對每個往前移動的單位發一次 `compacted`：`{ run, side, unit, from, to }`（`from`、`to` 是這一次 `compact` 裡的淨移動），在狀態整理好之後才發。`features/abilities/ward.ts` 的補位改聽它，掃描的程式碼（`scan`、`occ`、每個動作做完看一遍）拿掉。

## 三、`check.before` 的方向

定一邊，寫進 ADR 0015 補記；核心 `check` 效果、`checked` 反應、`hack.check` 三處一致。`hack.check` 不再自己發 `check.before`、不再抄防火牆的算法：核心 `check` 的 `vs` 收 `{ firewall: true, elite: 2, boss: 4 }`（`elite`、`boss` 是公式，沒寫是 0），也算得出掛著的東西（對它的迴避）與控制節點（它自己的 `ext.firewall`，沒寫 10）的防火牆。`hack.check` 變成呼叫核心 `check`。

## 四、技能格式四個小東西

- `trigger.who` 多 `self_or_ally`（你或一名隊友）。
- 共鳴的 `effect` 多 `pool`（和 `meat.pool` 同格式，RAM 上限加減）與 `load_max`（感載上限加減）。
- 效果的 `who` 多 `foe_overlays`（敵方每一台掛著的東西，逐台各做一次）。
- `needs` 多 `cache_tag`（目標的快取格裡有帶這個標籤的道具）。
- 潛網者樹（`M1b-hack.test.ts` 的假資料）：偷看是不行的喔改 `self_or_ally`、共鳴 3、4 階寫出效果、改寫地形的引爆加 `needs.cache_tag`、管理員不再要先有一台敵方的東西才選得了目標。

## 驗收條件

- 每一項都有測試；既有測試全過，動到的列出來並說明原因。
- `npx tsc --noEmit`、`npm test`、冒煙、`test:pending`（只有 B009 可以紅）、分層檢查。

## 完成時回報

改了哪些檔、測試結果、既有測試動了哪幾處與原因、第 4 項改寫之後潛網者樹還寫不出來的東西（構裝槽 +1、追蹤度）。
