# M1b-core-closeout

- 交給：cpp-architect（核心一小張，sonnet；第二波收尾，沒有下游工單；清單來源是 dev/status.md 最後一條「M1b-core-closeout」）
- 目標：補完第二波留下的核心缺口——掛著的東西的傷害入口、`attack.before` 可以取消這一擊（卡彈與炸膛從行動移回掛點）、改打結算之後的掛點（立牌保證倒下）、打掛著的東西也發 `attack.before`、沉溺的加法有一個擋得下的入口——並讓 `features/combat` 補上它自己的兩件事（fx 合併的護甲倍率、道具對一個敵人用與「到下次過載」）。
- 規格出處：dev/adr/0015 第二、三節與兩份實作補記（M1b-core-effects、M1b-core-overlay）；ITEMS 5.2 節（紙鶴：到他下次過載或戰鬥結束）、COMBAT_SYSTEM 第 5 節（快感：定力擋得掉沉溺那一部分）；dev/status.md 的 M1b-core-closeout 清單。
- 可以改的路徑：`engine/src/core/battle/`、`engine/src/core/types/battle.ts`、`engine/src/core/content/kinds.ts`（`use.range`）、`engine/src/features/combat/`、`engine/tests/core/battle-m1b-closeout.test.ts`、`engine/tests/features/M1b-core-closeout.test.ts`（都新增）、dev/invariants.md、dev/adr/0015。
- 不可以做的事：**不動 `engine/src/features/abilities/`**（另一個代理同時在做 M1b-skill-format）；不改既有測試的斷言（動到的要列出來並說明）；不 import 別的功能；不 commit。

## 核心（`engine/src/core/battle/`）

1. **`run.damageOverlay(o, raw, type, by?, { pierce?, armorMult? })`**：公開的入口，回傳 `{ dealt, downed }`。共用私有的 `hpDamage`／`armorAfter`（不另外抄一份）；感載類的傷害對它無效（記一拍）；耐久歸零呼叫 `dropOverlay`。`features/combat/ops.ts` 的 `damageOverlay` 改成呼叫它，抄來的算法刪掉。
2. **`AttackOpts.cancel`**（一句給玩家看的話）：`attack.before` 的處理函式設了，核心就結束這一擊——不擲任何骰、不發 `attack.after`、記一拍（那一句話）、結果 `aborted: true` 且帶 `cancelled`；彈匣照扣（扣在 `attack.before` 之前，行動點是行動自己扣的，兩者都和現在一樣）；後面的 `attack.before` 處理函式不再跑。記完那一拍之後發新掛點 `attack.cancel`（後果放這裡：炸膛傷到自己）。`AttackOpts.cancelData` 可以多帶幾個欄位進那一拍的資料。
   - `features/combat/fx.ts` 的 `fireGate`（卡彈與炸膛）移進 `attack.before` 的處理函式（排在最前面，和以前「先於反應」一樣），`attack.ts` 的呼叫全部拿掉。技能效果清單裡的 `{ op: 'attack' }` 也就會卡彈。
3. **改打結算之後的掛點 `attack.redirected`**：`{ run, attacker, target（原本的目標）, overlay（吃下這一擊的那一台）, weapon, opts, result }`。選它而不是讓改打也發 `attack.after`：`attack.after` 的處理函式（武器的命中效果、反應）都假設 `target` 是被打中的人，改打時那是錯的。`features/combat/throw.ts`：立牌吃下一擊之後保證倒下（不管打中、打空或是感載類的傷害）。
4. **`attackOverlay` 也發 `attack.before`**（`target` 是替身；彈匣先扣、之後才發；不看 `opts.redirect`）。`shoot` 打掛著的東西時不再自己 `applyFx`（掛點做了）。
5. **`damage()` 的「傷害類型自己帶的沉溺」**改走新的 `run.gainSink(unit, amount, { by?, type? })`：先發 `sink.before`（`{ run, unit, amount, type, by, out: { block? } }`，處理函式設 `out.block` 就不加），回傳實際加了多少；`AttackOpts.noSink`／`damage` 的 `noSink` 是呼叫的人說「這一點由我的效果決定」（略過掛點）。`fx.ts` 的 `takeBackSink` 刪掉：帶檢定的 `sink` 效果在 `on_hit` 裡時，fx 與投擲物把這一擊標成 `noSink`。`ops.ts` 的 `load`（快感）也改走 `gainSink`。
6. **`next_overload`**：`STATUS_UNTILS` 多一個 `next_overload`；`BattleUntil` 多 `{ at: 'overload' }`；`overload()` 一發生就拿掉那個人帶著的這種狀態（照一般的結束記一拍）。

## 功能（`engine/src/features/combat/`）

7. **fx 合併**：`armor_mult` 相乘（兩邊都有才乘，只有一邊就是那一邊）；其餘照舊。
8. **道具 `use.target: 'foe'`**：對一個敵人用（在場上、沒退出）。物品資料的 `use.range: [近, 遠]`（核心的 `ItemEntry` 與載入檢查補這個欄位；沒寫就不限距離）：超出距離的敵人在 `targets` 灰掉、寫出一句原因，硬用也擋下。花費照 `use.ap`（`ap_other` 只給隊友）。紙鶴的資料只用 `status` 效果寫得出來：`{ op: 'status', status: 'marked', until: 'next_overload' }`。

## 驗收條件

- `engine/tests/core/battle-m1b-closeout.test.ts`：`damageOverlay` 的護甲、穿甲、倍率、感載類無效、擊落；`cancel` 不擲骰、不發 `attack.after`、記一拍、彈匣照扣、後面的處理函式不跑、發 `attack.cancel`；`attack.redirected` 帶對的東西、彈匣只扣一次；`attackOverlay` 發 `attack.before`（`target` 是替身）、設 `cancel` 也能取消；`gainSink` 與 `sink.before` 擋下、`noSink`；`next_overload` 在過載時拿掉、不在別的時候拿掉、存讀檔往返。
- `engine/tests/features/M1b-core-closeout.test.ts`：技能效果清單的 `{ op: 'attack' }` 會卡彈（彈匣照扣、行動點照扣）；炸膛的順序是「炸膛」那一拍在前、自己的傷害在後；打掛著的東西的射擊吃得到特殊彈（原本的測試要照樣過）；立牌被打空也倒下；`armor_mult` 相乘；`am_honey` 的定力擋仍然成立且沒有先加再扣；紙鶴從快取格用在一個敵人身上、超出距離被擋、標記在目標過載時結束。
- 既有測試照樣全過（動到的列出來並說明）；`npx tsc --noEmit`、`npm test`、冒煙、`test:pending`（只有 B009 可以紅）、分層檢查。

## 完成時回報

改了哪些檔、測試結果、既有測試有沒有動、功能層需要跟進的地方（`features/abilities` 的反應處理函式現在會對「掛著的東西」發 `attack.before`，要自己看 `run.isStandIn(target)`）。
