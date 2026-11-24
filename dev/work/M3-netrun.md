# M3-netrun

- 交給：cpp-feature（sonnet）
- 目標：新功能 `netrun`：網內地圖上的一趟行程。同一份實作登記兩種活動：`face.net`（委託副本開的那一段）與 `netrun`（自己潛進去的一趟）。這一張做本體：開生成的地圖、探索回合、追蹤度的量表與門檻、遭遇節點與開戰、閘門、休息點、登出、結束與交回；其餘的節點在 M3-netrun-nodes。
- 規格出處：CYBERSPACE 8.1 節（「一張隨機地圖由什麼決定」「生成的順序」「節點」表的入口、鏈路、遭遇、閘門、休息點；「每一層的密度」的一般子網那一列；休息點與「探索不算脫離戰鬥」兩條）、8.3 節「追蹤度在生成的子網裡」、6.8 節、6.10 節；NETRUNNING 第 3、4、5 節；COMMISSIONS 2.3 節（內海那一列）；UI 第 5 節；dev/adr/0018 第五～七、九、十節與 N2、N5、N6、N13、N15、N22、N24、N26；dev/adr/0016 第一、二節（活動、`launch`、`activity.end`）。
- 可以改的路徑：`engine/src/features/netrun/`（新）、`engine/src/features/index.ts`、`engine/src/features/explore/index.ts` 與 `walk.ts`、`uses.ts`（**只加一個判斷**：網內的地圖上不作用）、`engine/tests/features/M3-netrun.test.ts`。
- 可以用的介面：`k.activity.define`／`allow`、`endActivity`／`attachActivityEnd`、報告的 `launch`／`triggers`／`rewind`；核心的 `openMap`（收整筆定義）、`generateSheet`／`seedRand`、`isNetMapKind`、`NET_LEGEND`、`k.grid.onEnter`／`passRule`／`usesOf`、`map.sheet`／`map.ext`／`map.at`／`map.close` 變更、`gridHere`；`k.meters.define`／`meterOf`／`meter` 變更；來源 `enemy_pick`（內海）；核心的檢定（`rollCheck`）；`k.stats`（`net_trace_start`，有人定義才讀）；`k.battle.onEnd`；掛鉤 `activity.end`、`report.after`；角色的 `load`、`afterglow` 變更；`actor.conditions`（`net_burn`）。
- 不可以做的事：不 import `features/commission`、`features/netcombat`、`features/enemies`、`features/deck`、`features/explore`（改 explore 的那一個判斷不算 import）；不讀 `state.ext.commission`（副本的事只從 `setup` 與 `origin` 來）；不決定戰敗事件；檔案庫、控制節點、人、陷阱、巡邏、安全點、六種目標留給下一張（這一張的目標只有「通過閘門」與「走完最後一層」）；共同的規定見 dev/work/M3-plan.md。

## 新的格式與鍵

- 活動 `face.net`、`netrun`（都是 order 50，`owner: 'netrun'`）。放行的 doing（驗收條件守著這張清單）：`commit:netrun.`、`grid.`、`commit:grid.`、`battle.`、`commit:battle.`、`chain:battle_end`、`battle.retry`、`event.start`、`commit:event.`、`commit:defeat.`、`chain:free_action`。另外替委託副本登記：`k.activity.allow('commission', 'face.net.start', …)`、`allow('commission', 'commit:netrun.', …)`。
- `setup`（兩種活動共用；`face.net` 的照 0018 第九節由副本給）：`region`（預設 `subnet`；可以是 `net_region` 的 id，或整筆區的規則——別的功能自己帶規則來開一趟時用）、`grade`、`faction?`、`layers?: string[]`（幾層、每層的名字；`face.net` 只有一層，名字是資料的 `layer`）、`encounter?`（位階的組合；`face.net` 用）、`lace?`、`seed?`、`trace?`、`fx?`、`stealth?`、`decisive?`、`where?`、`objective?`（這一張只收下）。
- 狀態 `state.ext.netrun`：`{ id, kind, origin, region, grade, faction?, map, layers: 圖的 id[], layer: 第幾層, round, goal: { kind: 'pass' | 'clear' | …, done? }, setup, loot: [], peak, located?: 還剩幾個探索回合 }`。
- 地圖實例的 `ext.net`（這個功能寫）：`{ region, grade, faction?, dc, graph: { 圖的 id: 節點的圖 }, foes: { 標記 id: { foes: UnitRef[], faction?, gate?: true } }, rested: 圖的 id[], t30?, t60? }`。
- 量表 `trace`：`{ keyed: 'map', min: -30, max: 100, start: 0, cap: { down: 20, up: 20 } }`，`accepts`：只在有這個功能的活動進行中時收。
- 內容種類 `net_region`（`overridable`）：`{ name, map_kind, size, carve, sight, pressure: 'trace' | 'none', safe?（true：這一區開的戰鬥帶場地效果 safe，倒下不加沉溺）, cover, dc: [五級], layer: { foe, patrol, archive, trap, rest, safe, control, person }（各是 [最少, 最多]）, commission?: 同一組鍵（委託的階段用，蓋掉 layer） }`；功能內建 `subnet` 的預設（照 CYBERSPACE 8.1 的密度表與 N2、N26）。內容種類 `netrun_rule`（探索的數字：消退、三個門檻、定位的回合數……）。
- 報告：`netrun.enter`、`.use`（節點上做的事，`outcome.result` 寫做了哪一件）、`.descend`、`.pressure`、`.located`、`.logout`、`.end`。
- 掛點（`declare module` 補型別）：`netrun.round`（`{ state, run }` → 變更）、`netrun.close`（`{ state, run, outcome }` → 變更與給玩家看的句子）。
- 匯出：`netrunView(k, state)`（給畫面：區、層與第幾層、追蹤度與門檻、探索回合、目標與做到哪、站的這一格與**相鄰的**遭遇節點各能做什麼與做不了的原因、能不能登出與原因、定位的倒數）、`useNode(k, state, id, at?)`、`logout(k, state)`、`descend(k, state)`、`nodeUses(…)`。

## 要做的

1. **現實的探索不碰網內的地圖**：`features/explore` 的 `onEnter`、`usesOf`、`passRule`、`map.arrive` 開頭加 `isNetMapKind(ctx.map.kind)` 就不做。
2. **開始**（兩種活動的 `start`）：擋下的情況各一句——已經有一趟在進行、隊上每個人的衍生數值 `deck_grade` 都是 0（沒有人有甲板；沒有人定義這個數值時不看）、隊上有人帶著 `net_burn`、這一區沒有規則表。照 `net_region` 組每一層的 `spec`（委託的階段用 `commission` 那一組：一場遭遇放在閘門前、巡邏與其餘節點的數量照表；`fx.skip` 或 `fx.near_core` 時入口改放在閘門前一個節點）、用 `seedRand(seed, 層)` 生成、`openMap`（`gen`）。遭遇節點放誰：`encounter` 的每個位階一筆 `enemy_pick`（勢力、等級、位階、`seed`、`color` 照 `lace`、`layer`），`fx.half`／`fx.minus` 照現實面的算法少人、`fx.lace_down` 把位階降一級（首領變精英、精英變雜兵）。追蹤度的起點：`setup.trace` 加 `fx.trace_start` 加全隊的 `net_trace_start`。第一筆報告 `netrun.enter`。
3. **走路**：只在網內的地圖上作用。站上一個節點格算一個探索回合（N5）：每個上場的角色感載消退 2 ＋ mod(意志)（餘韻不動）、`round` +1、問 `netrun.round`、定位的倒數少 1。自己的那一趟（活動 `netrun`）進每一層的第一步帶觸發點 `enter_floor`（EVENTS 4.3 的「子網與內海」範圍）；委託的階段不帶（它屬於委託副本的範圍，EVENTS 4.4）。
4. **遭遇節點**（N6）：`passRule('net_foe')` 擋下並說明；站在它旁邊時 `netrunView` 列出「開戰」與「潛行繞過」。開戰是一份帶 `launch`（戰鬥）的報告：`mode: 'net'`、我方是 `state.party`、敵方照 `ext.net.foes`、遮蔽照區的規則、`field: { trace }`（區的壓力條是 `trace` 時）、`origin.ext` 帶發起這一趟的人給的 `commission`、`stage`、`face`、`defeat_event`、`employer`，加 `net: { run, map, node, region, dc, reinforce, locate_rounds }`（`reinforce.t30` 是一隻白蕾絲、`t60` 是一個精英，都用 `enemy_pick`，挑不到就不給）。潛行繞過：全隊各擲潛行對地圖的 DC，都過才過（`setup.stealth` 是 true 時第一次自動成功，N24）；沒過就開戰而且對方有先攻的優勢（`edge: 'foe'`）。
5. **戰鬥打完**（`k.battle.onEnd`，只認 `origin.ext.net.run` 是這一趟的）：贏了，那個節點改成地板、追蹤度從 `battle.field.trace` 寫回量表、`data.unpinned` 有人就多算一個探索回合（N22）；`data.cracked` 的 `fled` 也算過了；`jack_out`：`face.net` 交回 `retreat`，自己的那一趟交回 `left`；打輸與投降什麼都不做（戰敗的流程接手）。
6. **戰敗被接受**（聽 `activity.end`，`kind: 'defeat'`、`outcome: 'accept'`、那一場是這一趟的）：回傳把這一趟收掉的變更（清狀態、關地圖），**不發**自己的 `activity.end`（0018 第十節）。
7. **閘門**：守著它的遭遇打贏了（或繞過了）就是開的；`fx.gate_open` 也是開的。開了之後：最後一層（或 `face.net` 的那一層）而且目標是「通過」——`netrun.use` 的「通過」讓這一趟結束（`done`）；還有下一層——`descend` 把人放到下一層的入口。
8. **休息點**：每一層一次；全隊感載歸零、餘韻全消，這個回合追蹤度不漲（CYBERSPACE 8.1）。
9. **追蹤度的門檻**（探索中；每個只觸發一次）：到 30 記 `ext.net.t30`（閘門的 DC +2；多一隊巡邏在下一張）；到 60 接一份 `netrun.pressure`，帶觸發點 `pressure` 與 `setup.where`；到 90 開始倒數（規則的 3 個探索回合，`setup.fx` 或區可以改），降回 90 以下取消，到 0 接一份 `netrun.located` 結束這一趟（`located`）。
10. **登出**（`logout`）：戰鬥外隨時可以；`face.net` 交回 `retreat`（N13；`netrunView` 要給畫面一句「會回到進副本之前」），自己的那一趟交回 `left`。
11. **結束**（`netrun.end`）：問 `netrun.close`、發 `activity.end`（`kind` 是開的那一種；`result: { trace, peak, rounds, loot, located?, layer }`）、把量表的值收進 `result`、關地圖、清狀態。

## 驗收條件（`engine/tests/features/M3-netrun.test.ts`；測試自帶一筆 `net_region`（小一點的密度）、兩個假蕾絲與一個白蕾絲、`TEST_NET_COMBAT`；戰鬥用 `playOut` 或 `fixDice`）

- `netrun` 進行中，交易、休息、接委託這類報告（替身的前綴）被擋並有原因；放行的只有清單上那十一項。
- 用玩具活動當成副本（`origin.by: 'commission'`、`ext` 帶 `commission` 與 `stage`）`launch` 一段 `face.net`：開了一份 `kind: 'subnet'`、有 `gen` 的地圖，人站在入口；同一個 `seed` 開兩次版面一樣；存檔再讀接著走的結果一樣。
- 走到一個節點格 `round` +1、感載照公式消退、餘韻不變；走在鏈路上不變。
- 遭遇節點走不上去、原因是完整的句子；站在旁邊 `netrunView` 列出開戰與潛行繞過；開戰那一場的 `origin.ext` 有 `commission`、`stage`、`net.run`，`field.trace` 等於量表的值；打贏之後節點是地板、量表等於戰鬥結束時的數字。
- 潛行繞過：固定骰面全過時不開戰、節點變地板；有人沒過就開戰而且敵方有先攻的優勢；`setup.stealth` 時第一次不擲。
- `encounter: ['minion', 'minion', 'elite']` 加 `fx.half`：遭遇是兩個；加 `fx.lace_down`：精英變雜兵。
- 起點：`setup.trace` 20、`fx.trace_start` −15、測試定義的 `net_trace_start` −15 → −10。
- 閘門：遭遇沒處理時「通過」灰掉並有原因；打贏之後通過，交回 `done`，`result.trace` 是離開時的值，地圖關了、狀態清了。
- 兩層的 `netrun`：`descend` 到第二層、追蹤度不歸零；第二層的閘門通過之後交回 `done`。
- 休息點：感載歸零、餘韻清空，第二次灰掉。
- 用效果把追蹤度推過 60：多一份 `netrun.pressure`，帶 `pressure` 觸發點，只發一次。推過 90：三個探索回合之後交回 `located`；倒數中降到 85 就取消。
- 探索中登出：`face.net` 交回 `retreat`，`netrun` 交回 `left`。戰鬥裡全員拔線（測試直接把每個人 `setOut` 成 `jacked_out`）：一樣。
- 打輸、接受（測試自己發 `kind: 'defeat'` 的 `activity.end`）：地圖關了、狀態清了，沒有多發 `face.net` 的 `activity.end`。
- 開不成：`enemy_pick` 挑不到那個勢力的蕾絲時整步不成立，發起的那一份報告沒有套用。
- 現實的地圖上 `netrun` 的掛點不作用；在這張網內的地圖上 `explore` 的 `uses` 是空的。
- AI 給 `trace` 效果：一趟進行中收、夾在 ±20；不在網內時整筆拿掉並提醒。
- `npm test`、`npx tsc --noEmit`、分層檢查全過。

## 依賴

M3-core-grid、M3-core-mapgen、M3-netcombat-out（`battle.field.trace` 與 `data.unpinned`、`data.cracked` 的約定）、M3-lace（內海的 `enemy_pick`）。同一個資料夾的三張排成一串（這一張、M3-netrun-nodes、M3-netrun-dig）。

## 完成時回報

改了哪些檔、測試結果、放行清單、`net_region` 的預設值各自的出處、CYBERSPACE 8.1 節裡這一張與下一張都沒涵蓋的。
