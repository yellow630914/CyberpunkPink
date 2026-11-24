# M3-netcombat-out

- 交給：cpp-feature（sonnet）
- 目標：`netcombat` 的第二張：釘住、拔線、投降、倒下與扣線的後果；戰鬥裡的追蹤度（每回合、門檻、增援、定位）。
- 規格出處：CYBERSPACE 6.3 節（釘住、拔線、投降三列）、6.7 節（全部）、6.8 節（全部）、6.10 節最後的表（放他斷線與扣線）；NETRUNNING 第 3 節（拔線）、第 5 節（門檻的表）；COMBAT_SYSTEM 第 7 節（制伏，對照用）、8.5 節（投降）；ENEMIES 第 9 節（粉蕾絲的釘線、野生粉蕾絲不扣線）；dev/adr/0018 第一節（追蹤度那一條）、第十節最後一條與 N12、N15、N17、N22、N32。
- 可以改的路徑：`engine/src/features/netcombat/`、`engine/tests/features/M3-netcombat-out.test.ts`。
- 可以用的介面：M3-netcombat 的全部；`run.setOut`、`run.finish`、`run.callIn`、`run.save`、掛點 `round.start`、`out.before`、`battle.result`、`k.battle.onEnd`；核心的 `actor.condition` 變更；`battle.field`、`battle.origin.ext.net`（開戰的人填的：`reinforce`、`locate_rounds`）；戰場的 `leave`（M3-core-battle）；`n.subdueDc`。
- 不可以做的事：不讀量表、不讀地圖（追蹤度只認 `battle.field.trace` 這個數字；沒有這個欄位就整段不做）；不決定走哪一件戰敗事件（M3-defeat-net）；不寫蕾絲的資料；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 行動：`net_pin`（tactic，2 行動點、1 RAM）、`net_jack_out`（system，1 行動點，`hold`）、`net_surrender`（system，0，`hold`）。
- 退出的方式：`pinned`（被釘住）、`jacked_out`（拔線）。
- 效果：`net.pin`（照釘住的規則對目標做一次，不花費；招牌行動用）、`net.tether`（這一場倒下的我方不能斷線：`unit.ext.net.tethered`）、`net.trace`（`{ amount }`：追蹤度加減；沒有追蹤度的場地不做）。
- `battle.field`：`trace`（數字）、`t30`／`t60`（那一個門檻的增援叫過了）、`located`（定位之後還剩幾輪）。
- 角色身上的狀況 `net_burn`（倒下之後一小時內不能再潛入）。
- `netcombat_rule` 加：`trace: { round: 3, white: 5, t1: 30, t2: 60, t3: 90, locate_rounds: 3 }`、`burn_minutes: 60`。
- `netBattleView` 加：追蹤度、三個門檻、定位的倒數、這一場是不是在委託副本裡（`origin.ext.commission`；畫面要在拔線上提醒）。

## 要做的

1. **釘住**：目標餘韻已經疊滿、還在場上，動手的人與目標都在近身（距離的算法照現實的制伏）；檢定取兩組裡加值高的一組——智識加介面，或意志加格鬥——對 `n.subdueDc`（10 ＋ 目標的等級 × 2，精英 +2、首領 +4），標籤 `pin`。成功就 `setOut(目標, 'pinned')`（`out.before` 擋得下：技能「不讓你帶走」）。`aiSlotScore` 照制伏（4 分）：打法是 `capture` 的敵人會靠過來釘人。
2. **拔線**：自己退出這一場（`jacked_out`），沒有代價。全員都是拔線時，核心照戰場的 `leave` 把結果定成 `jack_out`。
3. **投降**：照現實投降的做法（結果 `surrender`，不再受感載）。
4. **打輸的時候**：贏的那一方有人帶 `tether` 標籤（粉蕾絲、企業潛網者），我方每個人標成被扣線（結束的報告 `data.tethered`）；沒有就是放人斷線。
5. **打贏的時候**：被釘住的我方自動拆掉釘子（N22；報告的 `data.unpinned` 列出是誰，在地圖上的那一趟由 M3-netrun 多算一個探索回合）。
6. **倒下的後果**（`k.battle.onEnd`）：這一場以昏過去或被釘住退出的角色各給 `net_burn`（`burn_minutes`）。場地 `battle.field.safe` 是 true 時核心不加倒下的沉溺，這裡照樣給 `net_burn`。
7. **追蹤度**（只在 `battle.field.trace` 是數字時）：每一輪開頭（第 2 輪起）+`round` 加我方修正 `trace_round` 的合計（最少 0）；敵方在場有帶 `lace:white` 標籤的再 +`white`（不疊，N32）；夾在 −30～100。第一次到 30 把 `origin.ext.net.reinforce.t30` 的每一筆 `run.callIn('foe', …)`，60 同理；到 90 開始倒數（`origin.ext.net.locate_rounds` 或規則的 3 輪），每一輪開頭少 1，降回 90 以下取消，到 0 就 `run.finish('lose', …)` 並記一拍 `located`、`battle.field.located` 留著（M3-defeat-net 讀）。每次變動記一拍 `trace`（`data` 帶新的值與加了多少）。
8. 委託副本裡的戰鬥（`origin.ext.commission` 有值）不能脫離：這個功能沒有「脫離」這個行動，只有拔線與投降。

## 驗收條件（`engine/tests/features/M3-netcombat-out.test.ts`）

- 釘住：餘韻沒疊滿的目標灰掉並有原因；不在近身灰掉；釘死骰面成功時目標 `out` 是 `pinned`、紀錄有 `pin`；DC 對精英是 10 ＋ 等級 × 2 ＋ 2。測試掛一個 `out.before` 擋下：目標還在場上。
- `capture` 的敵人：我方第 1 格站著餘韻疊滿的人時，它換到第 1 格並釘住他（固定種子）。
- 拔線一個人：他退出、戰鬥繼續；四個人都拔線：結果 `jack_out`、沒有等著選的戰敗。三個人拔線一個人被釘住：`lose`。
- 投降：結果 `surrender`，還站著的人沒有 `net_burn`。
- 打輸而對面有 `tether`：報告的 `data.tethered` 是 true；對面沒有：沒有這個欄位。
- 打贏而我方有人被釘住：`data.unpinned` 有他，他有 `net_burn`、沒有被扣線。
- 昏過去的角色結束之後有 `net_burn`，一小時後（`time` 過 60 分鐘）核心把它拿掉。
- 追蹤度：從 20 起，每一輪 +3；第 4 輪跨過 30，`reinforce.t30` 的那一隻下一輪進場，而且只叫一次；牠帶 `lace:white`，之後每一輪 +8；測試給我方一個 `trace_round` −2 的修正時每輪 +1；到 90 之後第三輪開頭結果是 `lose`、`battle.field.located` 是 true；倒數中用 `net.trace` 降到 85，倒數取消。
- 沒有 `battle.field.trace` 的戰鬥打十輪，紀錄裡沒有任何 `trace` 那一拍。
- 四對四的戰鬥叫增援時沒有空格：留在後方，有人倒下才補上來（核心的規矩，不丟錯）。
- 打到一半（倒數中）存檔再讀，結果一樣。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-netcombat。做完才能開 M3-netadmin、M3-lace、M3-hack-net、M3-defeat-net、M3-netrun。

## 完成時回報

改了哪些檔、測試結果、CYBERSPACE 6.7、6.8 節裡沒做的（預期：惡意韌體的植入、扣線期間現實搶回身體）。
