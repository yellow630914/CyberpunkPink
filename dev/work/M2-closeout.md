# M2-closeout

- 交給：cpp-architect 角色（核心與功能一起改；全是照使用者列的十項小修）
- 目標：關掉 M2（核心與功能）留下的小缺口：戰敗的放行照階段、戰敗裡的開戰、回到快照之後的接續報告、街區地圖不要求遭遇點、導演不把「車上」當別的活動、world 的出口與區的欄位、roster 的 `in_tagalong`、預設值對設計書、俘虜審問的 `scout_reveal`、規則表可以被後載入的包取代。
- 規格出處：COMBAT_SYSTEM 8.4、M1 審查 E1（dev/reviews/2026-11-22-M1a.md）；dev/adr/0016 第一、二節與實作補記；EVENTS 3.1；ENEMIES 第 13 節與 6.1；COMMISSION_TEMPLATES（報酬的表、遭遇的寫法）；DOWNTIME 5.1；NPC_SYSTEM 6.4、10；DISTRICTS 1.2。決定與取捨：dev/adr/0017。
- 可以改的路徑：`engine/src/core/{action/activity.ts,content/,grid/model.ts,battle/rules.ts}`、`engine/src/shell/game.ts`、`engine/src/features/{defeat,director,world,roster,fixer,bills,npcs,enemies,…}/`（規則表種類加 `overridable`）、`engine/data/rules/{commission_rules,bill_rules,npc_interact_rules}.json`、`engine/data/index.ts` 的說明、`ui/src/data/demo/`、測試。
- 不可以做的事：不動 ui 其他檔案（`M2-ui-battle-after` 做的）；沒做的 ui 接線列在回報。
- 驗收測試：`engine/tests/core/M2-closeout-core.test.ts`、`engine/tests/features/M2-closeout.test.ts`、`M2-roster.test.ts` 的 `in_tagalong`、`M2-enemy-encounter.test.ts` 最後一組；ui 的 `tests/after`、`tests/world`、`tests/skills` 與 `src/data/demo/demo.test.ts` 照新的做法。
- 完成時回報：改了哪些檔、有改到的既有測試、要使用者定的事（見最後）。

## 十項

| # | 做什麼 | 改哪裡 | 測什麼 |
|---|---|---|---|
| 1 | 活動的放行可以帶條件：`k.activity.allow(kind, prefix, owner, when?)`，`when(state, doing, draft?, launch?)`；戰敗在三選一的期間（沒有事件視窗開著）不放 `chain:free_action`，事件視窗開著才放 | `core/action/activity.ts`、`features/defeat/index.ts` | `ask`、`played` 擋、事件開著放；沒有事件視窗的一局不變 |
| 2 | `fight` 結果在戰敗裡放行 `battle.start`：只放戰敗自己的事件開出來的戰鬥（`fromDefeatFlow`），玩家直接開戰仍然被擋（M1 E1）。所以 `blockOf`、`launchIn`、`Game.launch`、`Game.startBattle`、走路開戰多傳一個 `launch`；戰敗的 `event.start` 也改成只放戰敗自己開的；劫囚打完之後被取代的那一場戰敗清掉 | `core/action/activity.ts`、`shell/game.ts`、`features/defeat/` | fight 結果開得起來；直接開戰、別的 origin 被擋；打贏、打輸之後的紀錄 |
| 3 | `Game.restoreFrom` 用 `commitReportAll`：交代回到快照的那一份之後，`report.after` 接著提交的報告（例：`commission.failed`）也進 `commit` 回傳與 `notify` | `shell/game.ts` | 帶 rewind 的報告、`Game.rewind`、`rewindToKind` 三條路的回傳與通知 |
| 4 | 街區地圖不要求 2 個遭遇點：`special_map` 的 `kind` 是 `block` 或 `bridge` 就免；示意包的街區地圖改成 `kind: 'block'`、不再塞兩個 `!` | `core/grid/model.ts`、`ui/src/data/demo/world.ts` | 街區地圖沒有遭遇點合格、其他種類照舊要 2 個 |
| 5 | 導演的「另一個活動進行中」不算放行 `event.start` 的活動（車上）；戰敗等待中照樣算（`k.activity.permits`） | `features/director/flow.ts`、`core/action/activity.ts` | 車上擋住型的 transit_stop 照常跳出；戰敗中照常延後；舊的修法會讓測試紅 |
| 6 | world：站在出口標記上列「前往」（`world.go`）；`district` 多 `map_x`、`map_y`、`security`、`style`（採用示意包的名字） | `features/world/` | usesOf 的項目、district 格式檢查 |
| 7 | roster 註冊條件 `in_tagalong { who }` | `features/roster/index.ts` | 同行的是、留家的、隊上的、不在名冊上的不是 |
| 8 | 預設值對設計書：遭遇組合 4／8 點；報酬範圍照 COMMISSION_TEMPLATES 的表（小～大）；債的利息胭脂堂收現金；讀橋防護階企業主管與保全 3（旗標 `manager`、`guard`） | `features/fixer/gen.ts`、`features/bills/model.ts`、`features/npcs/interact.ts`、三個規則資料、`data/index.ts` 的出處 | 預設等於資料；數字等於設計書 |
| 9 | 俘虜的審問選項只在副本裡（`origin.ext.commission`）放 `scout_reveal`；事件結束接著開別的活動時臨時登場角色先不清（不然「帶走」的場景開不起來） | `features/enemies/capture.ts`、`features/director/run.ts`、`features/npcs/index.ts` | 真的 fixer 加真的事件視窗：一個俘虜結算得了、好幾個挑完處置開得起來；修之前紅 |
| 10 | 規則表（`overridable` 的種類）可以被後載入的包同 id 整筆取代；`loadPack` 整包不收；示意包與測試的繞法拿掉 | `core/content/registry.ts`、各規則表種類的 `defineKind`、`ui/src/data/demo/`、ui 三個測試 | 登錄表的行為、哪些種類是規則表的清單、整個遊戲核心包加後載入的包 |

## 改到的既有測試

- `tests/features/M2-commission-close.test.ts`（兩處）：回傳的最後一份從 `rewind` 改成最後兩份是 `['rewind', 'commission.failed']`（第 3 項的預期行為）。
- `tests/features/M2-commission-gen.test.ts`（一處）：沒寫的那一級用預設，III 級報酬範圍從 [3000, 5000] 改成 [2400, 7200]（第 8 項）。
- `tests/features/M2-director.test.ts`（事件視窗替身）：`allow` 從 `['event.', 'commit:event.', 'commit:test.']` 改成 `['commit:event.', 'commit:test.']`，和真的事件視窗一樣不放行 `event.start`（放行的活動導演不算「另一個活動」）。
- `tests/features/M2-world.test.ts`（一處）：站在出口 E1 上 `here.uses` 從 `[]` 改成列「前往閘門」（第 6 項）。
- `ui/tests/after/M2-ui-battle-after.test.ts`：`withCaptive` 找「擲中好幾個、先挑一個」的種子；「帶走」那一條改成挑完之後看處置的事件（第 9 項修好後才走得到），測試內容加一個最小的體位讓場景開得起來。
- `ui/tests/skills/skills.test.ts`、`ui/tests/world/M2-ui-world.test.ts`：把為了避開核心包而改掉的寫法改回去（`tuning_clinic`、`street`、`transit_rule` 的公里數表）（第 10 項）。
- 新增的測試（不算改）：`M2-roster.test.ts` 的 `in_tagalong`、`M2-enemy-encounter.test.ts` 最後一組（`FightOpts` 多選填的 `content`）。

## 要使用者定的事

- 讀橋防護階 3 的辨認方式：設計書的「企業的主管、保全」不是身分類的一種，先做成旗標 `manager`、`guard`（規則 `read.flag_tiers`）。匯入正式 NPC 時要給對的人加旗標，或改成別的辨認方式。
- 一般遭遇 4 點只湊得出四個雜兵（精英 2.5 配不出剛好 4），所以 III～V 級的一般階段不再有精英（以前是兩雜兵加一精英，4.5 點，超過預算）。
