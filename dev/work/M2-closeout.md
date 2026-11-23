# M2-closeout

- 交給：cpp-architect 角色（核心與功能一起改；全是照使用者列的八項小修）
- 目標：關掉 M2（核心與功能）留下的八個小缺口：戰敗的放行照階段、戰敗裡的開戰、回到快照之後的接續報告、街區地圖不要求遭遇點、導演不把「車上」當別的活動、world 的出口與區的欄位、roster 的 `in_tagalong`、預設值對設計書。
- 規格出處：COMBAT_SYSTEM 8.4、M1 審查 E1（dev/reviews/2026-11-22-M1a.md）；dev/adr/0016 第一、二節與實作補記；EVENTS 3.1；ENEMIES 第 13 節；COMMISSION_TEMPLATES（報酬的表、遭遇的寫法）；DOWNTIME 5.1；NPC_SYSTEM 6.4、10；DISTRICTS 1.2。
- 可以改的路徑：`engine/src/core/action/activity.ts`、`engine/src/core/grid/model.ts`、`engine/src/shell/game.ts`、`engine/src/features/{defeat,director,world,roster,fixer,bills,npcs}/`、`engine/data/rules/{commission_rules,bill_rules,npc_interact_rules}.json`、`ui/src/data/demo/world.ts`、測試。
- 不可以做的事：不動 ui 其他檔案（`M2-ui-battle-after` 在做）；不改 `engine/data/` 以外的內容資料。
- 驗收測試：`engine/tests/core/M2-closeout-core.test.ts`、`engine/tests/features/M2-closeout.test.ts`；`ui/src/data/demo/demo.test.ts` 照新的地圖寫法。
- 完成時回報：改了哪些檔、有改到的既有測試、要使用者定的事。

## 八項

| # | 做什麼 | 改哪裡 | 測什麼 |
|---|---|---|---|
| 1 | 活動的放行可以帶條件：`k.activity.allow(kind, prefix, owner, when?)`，`when(state, doing, draft?, launch?)`；戰敗在三選一的期間（沒有事件視窗開著）不放 `chain:free_action`，事件視窗開著才放 | `core/action/activity.ts`、`features/defeat/index.ts` | `ask`、`played` 擋、事件開著放；沒有事件視窗的一局不變 |
| 2 | `fight` 結果在戰敗裡放行 `battle.start`：只放「戰敗自己的事件」開出來的戰鬥（`launch.origin.by === 'director'` 且 `ext.caller === 'defeat'` 或 chain 帶出來的），玩家直接開戰仍然被擋（M1 E1）。所以 `blockOf`、`launchIn`、`Game.launch`、`Game.startBattle` 多傳一個 `launch`；戰敗的 `event.start` 也改成只放戰敗自己開的 | `core/action/activity.ts`、`shell/game.ts`、`features/defeat/index.ts` | fight 結果開得起來；直接開戰、隨便一個 origin 的 `event.start` 被擋 |
| 3 | `Game.restoreFrom` 用 `commitReportAll`：交代回到快照的那一份之後，`report.after` 接著提交的報告（例：`commission.failed`）也進 `commit` 回傳與 `notify` | `shell/game.ts` | 帶 rewind 的報告、`Game.rewind`、`rewindToKind` 三條路的回傳與通知 |
| 4 | 街區地圖不要求 2 個遭遇點：`special_map` 的 `kind` 是 `block` 或 `bridge` 就免；示意包的街區地圖改成 `kind: 'block'`、不再塞兩個 `!` | `core/grid/model.ts`、`ui/src/data/demo/world.ts` | 街區地圖沒有遭遇點合格、其他種類照舊要 2 個 |
| 5 | 導演的「另一個活動進行中」不算放行 `event.start` 的活動（車上）；戰敗等待中照樣算 | `features/director/flow.ts`、`core/action/activity.ts`（`permits`） | 車上阻擋型的 transit_stop 照常跳出；戰敗中照常延後 |
| 6 | world：站在出口標記上列「前往」（`world.go`）；`district` 多 `map_x`、`map_y`、`security`、`style`（採用示意包的名字） | `features/world/` | usesOf 的項目、district 格式檢查 |
| 7 | roster 註冊條件 `in_tagalong { who }` | `features/roster/index.ts` | 同行的是、留家的不是；abilities 的 xp 分得出來 |
| 8 | 預設值對設計書：遭遇組合 4／8 點；報酬範圍照 COMMISSION_TEMPLATES 的表（小～大）；債的利息胭脂堂收現金；讀橋防護階企業主管與保全 3（旗標 `manager`、`guard`） | `features/fixer/gen.ts`、`features/bills/model.ts`、`features/npcs/interact.ts`、三個規則資料 | 預設等於資料；數字等於設計書 |

## 改到的既有測試

寫在完成時的回報（依實際跑出來的為準）。
