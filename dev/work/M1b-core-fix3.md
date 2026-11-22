# M1b-core-fix3

- 交給：cpp-architect（核心小修第三批，sonnet；M1 第二波；清單來源是 dev/status.md 的「改造師、機師、潛網者」三條留下的缺口）
- 目標：五件小事——`action.done` 的標籤帶行動自己的 `costTags`；對自己給的 `until: own_turn_end` 從下一個自己的回合算起；公式多「上限的一半」；遮蔽等級的修正（堡壘姿態）；效果的 `who` 可以落在敵方的「一台」掛著的東西（管理員只接管一台）。
- 規格出處：dev/adr/0015 第二節（`costTags`）與補記；SKILL_TREES「堡壘姿態」「管理員」「全面翻修」「死線」「心流」「子彈時間」；COMBAT_SYSTEM 2.1 節（遮蔽）；dev/status.md 最後三條。
- 可以改的路徑：`engine/src/core/battle/`、`engine/src/core/types/battle.ts`；`engine/src/features/combat/attack.ts`（AI 打分改問有效遮蔽）；`engine/src/features/abilities/mods.ts` **只有**第 1 項的那一段繞道；測試（含醫療、機師、潛網者三份既有測試裡跟這幾項直接相關的地方）；dev/adr/0015、dev/invariants.md。
- 不可以做的事：另一個代理正在做 M1b-skill-social（`features/abilities`）。`features/abilities` 其餘的檔案不動（buff 的計時、`in_cover` 條件、`PickDecl` 都留成後續，列在 ADR 0015 補記）；不改 `engine/data/`；不 commit。

## 一、`action.done` 帶 `costTags`、拿掉繞道

`performAction` 呼叫 `actionTags(unit, def, input, run)`（要在 `def.run` 之前問：用掉道具之後快取格可能空了）。`features/abilities/mods.ts` 的 `costTagMemo`、`rememberCostTags` 與 `action.done` 裡「把記下的標籤併進去」整段拿掉。

## 二、對自己給的 `until: own_turn_end` 從下一個自己的回合算起

- 定義：一個狀態的 `until` 是 `own_turn_end`、帶著它的人自己的回合正在進行、而且是他自己給的（`by` 就是他），這個回合的結束不算，從他下一個回合的結束起算 `turns`。別人給的、不在他的回合裡給的、`source_turn_end`（含目前這個回合）、`own_turn_start` 都不變。
- 核心：`BattleState.acting`（回合進行中的單位 id；`beginTurn` 設、`advance` 在回合結束的結算之後清）、`BattleUntil` 多 `skip`、`applyStatus` 與 `tickStatuses` 照做；`run.skipsOwnTurnEnd(holder, by)` 給功能自己算計時的東西用。
- 這一批沒有套用到 buff（`features/abilities/mods.ts`，另一個代理在改）；ADR 0015 補記列了要做的幾行與跟著要拿掉的繞道（`branch.self` 的用法、槍手心流與子彈時間的 `turns`）。
- 醫療樹假資料裡超頻的狀態不再用 `branch.self`；列出還靠繞道的地方。

## 三、公式：上限的一半

名字照 `tier`、`half_tier_up`、`half_tier_down` 的樣子：`hp_max`、`half_hp_max_up`、`half_hp_max_down`，感載同理（`load_max`、`half_load_max_up`、`half_load_max_down`）。看這一筆落在的人（`ctx.unit`），沒有就看做的人。寫進 ADR 0015。

## 四、遮蔽等級的修正（堡壘姿態）

選「修正」，不選「`who: 'behind'` 加還原」：新的修正 `cover_level`（問的是站在那一格的人；加幾級，最高到掩體；多出來的級數打不破，和煙霧同一個道理）。堡壘姿態寫成 `{ kind: 'cover_level', value: 1, who: 'behind' }`（技能的修正本來就有 `who: 'behind'`）。姿態關掉、站位換掉都自己還原，不必記狀態。核心多 `run.coverOf(unit)`（有效的遮蔽等級）與 `run.isExposed(unit)`，迴避、暴露（監視）、AI 挑目標都改問它們。`features/abilities/conditions.ts` 的 `in_cover`、`other_exposed` 條件留成後續（兩行，列在 ADR）。

## 五、敵方的「一台」

核心的 `who: 'pick:<鍵>'` 本來就收掛著的東西的 id；缺的是沒選時的預設與技能的宣告。核心多 `who: 'foe_overlay'`：玩家選的（`pick.overlay`）→ 目標 → 最前面的一台。管理員寫成 `who: 'foe_overlay'`。技能 `picks` 多 `kind: 'foe_overlay'`（`features/abilities`）留成後續（列在 ADR），做了之後玩家就選得到哪一台。

## 驗收條件

- 每一項都有測試（`engine/tests/core/battle-m1b-fix3.test.ts`；功能那一側改了 `M1b-skill-pilot`、`M1b-hack`、`M1b-skill-medic` 三份既有測試）；既有測試全過，動到的列出來並說明原因。
- `npx tsc --noEmit`、`npm test`、冒煙、`test:pending`（只有 B009 可以紅）、分層檢查。

## 完成時回報

改了哪些檔、測試結果、既有測試動了哪幾處與原因、還靠繞道的地方的清單、留給 `features/abilities` 的後續。
